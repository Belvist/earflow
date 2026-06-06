/**
 * useFileUpload Hook
 * 
 * Управление очередью загрузки файлов.
 * Обеспечивает безопасную загрузку с retry логикой.
 * 
 * @module MusicUploader/hooks/useFileUpload
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { CONFIG, UploadStatus, ErrorType, ERROR_MESSAGES } from '../constants';
import { validateFile, quickValidate } from '../validators';
import { generateFileId, createAbortControllerWithTimeout } from '../utils';
import apiClient from '../../../api/client';

/**
 * @typedef {Object} QueueItem
 * @property {string} id - Уникальный ID
 * @property {File} file - Файл
 * @property {string} name - Имя файла
 * @property {number} size - Размер
 * @property {UploadStatus} status - Статус
 * @property {number} progress - Прогресс (0-100)
 * @property {string|null} error - Сообщение об ошибке
 * @property {Date|null} uploadedAt - Время загрузки
 * @property {number} retryCount - Количество попыток
 */

/**
 * Хук для управления загрузкой файлов
 * 
 * @param {Object} options
 * @param {number} options.maxFiles - Максимальное количество файлов
 * @param {Function} options.onUploadSuccess - Callback при успехе
 * @param {Function} options.onUploadError - Callback при ошибке
 * @param {number} options.maxRetries - Максимальное количество повторов
 * @returns {Object}
 */
export function useFileUpload({
    maxFiles = CONFIG.MAX_FILES_AT_ONCE,
    onUploadSuccess,
    onUploadError,
    maxRetries = 2,
} = {}) {
    const [queue, setQueue] = useState([]);
    const [isUploading, setIsUploading] = useState(false);

    // Refs для управления жизненным циклом
    const abortControllerRef = useRef(null);
    const isMountedRef = useRef(true);

    // Cleanup при размонтировании
    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            abortControllerRef.current?.abort();
        };
    }, []);

    /**
     * Безопасное обновление состояния
     */
    const safeSetQueue = useCallback((updater) => {
        if (isMountedRef.current) {
            setQueue(updater);
        }
    }, []);

    /**
     * Добавляет файлы в очередь
     */
    const addFiles = useCallback(async (files) => {
        if (!files || files.length === 0) return;

        const fileArray = Array.from(files);

        // Проверяем лимит
        setQueue(prev => {
            const availableSlots = maxFiles - prev.length;
            if (availableSlots <= 0) {
                return prev;
            }

            const filesToAdd = fileArray.slice(0, availableSlots);
            const newItems = filesToAdd.map(file => {
                const validation = quickValidate(file);

                return {
                    id: generateFileId(),
                    file,
                    name: file.name,
                    size: file.size,
                    status: validation.valid ? UploadStatus.PENDING : UploadStatus.ERROR,
                    progress: 0,
                    error: validation.errorType
                        ? ERROR_MESSAGES[validation.errorType]
                        : null,
                    uploadedAt: null,
                    retryCount: 0,
                };
            });

            return [...prev, ...newItems];
        });
    }, [maxFiles]);

    /**
     * Удаляет файл из очереди
     */
    const removeFile = useCallback((fileId) => {
        safeSetQueue(prev => prev.filter(f => f.id !== fileId));
    }, [safeSetQueue]);

    /**
     * Очищает всю очередь
     */
    const clearQueue = useCallback(() => {
        abortControllerRef.current?.abort();
        setIsUploading(false);
        safeSetQueue([]);
    }, [safeSetQueue]);

    /**
     * Очищает завершённые загрузки
     */
    const clearCompleted = useCallback(() => {
        safeSetQueue(prev => prev.filter(f =>
            f.status !== UploadStatus.SUCCESS &&
            f.status !== UploadStatus.ERROR
        ));
    }, [safeSetQueue]);

    /**
     * Повторяет загрузку файла
     */
    const retryFile = useCallback((fileId) => {
        safeSetQueue(prev => prev.map(f =>
            f.id === fileId
                ? {
                    ...f,
                    status: UploadStatus.PENDING,
                    progress: 0,
                    error: null,
                    retryCount: f.retryCount + 1,
                }
                : f
        ));
    }, [safeSetQueue]);

    /**
     * Загружает один файл
     */
    const uploadSingleFile = useCallback(async (item, signal) => {
        const { id, file } = item;

        // Полная валидация перед загрузкой
        const validation = await validateFile(file);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.errorMessage || ERROR_MESSAGES[validation.errorType],
            };
        }

        // Обновляем статус
        safeSetQueue(prev => prev.map(f =>
            f.id === id
                ? { ...f, status: UploadStatus.UPLOADING, progress: 0 }
                : f
        ));

        try {
            const result = await apiClient.uploadSong(
                file,
                (progress) => {
                    if (!signal?.aborted) {
                        safeSetQueue(prev => prev.map(f =>
                            f.id === id
                                ? { ...f, progress: Math.min(progress, 99) }
                                : f
                        ));
                    }
                }
            );

            return { success: true, result };

        } catch (error) {
            // Определяем тип ошибки
            let errorType = ErrorType.UNKNOWN;

            if (signal?.aborted) {
                errorType = ErrorType.CANCELLED;
            } else if (error.message?.includes('network') || error.name === 'TypeError') {
                errorType = ErrorType.NETWORK_ERROR;
            } else if (error.response?.status >= 500) {
                errorType = ErrorType.SERVER_ERROR;
            }

            return {
                success: false,
                error: error.message || ERROR_MESSAGES[errorType],
                errorType,
                canRetry: errorType === ErrorType.NETWORK_ERROR ||
                    errorType === ErrorType.SERVER_ERROR,
            };
        }
    }, [safeSetQueue]);

    /**
     * Запускает загрузку всей очереди
     */
    const startUpload = useCallback(async () => {
        const pendingFiles = queue.filter(f => f.status === UploadStatus.PENDING);
        if (pendingFiles.length === 0) return;

        setIsUploading(true);

        const { controller, signal, clear } = createAbortControllerWithTimeout(
            CONFIG.UPLOAD_TIMEOUT_MS * pendingFiles.length
        );
        abortControllerRef.current = controller;

        for (const item of pendingFiles) {
            if (signal.aborted || !isMountedRef.current) break;

            let retryCount = Number(item.retryCount) || 0;
            let result = await uploadSingleFile(item, signal);

            while (
                !result.success &&
                !signal.aborted &&
                isMountedRef.current &&
                result.canRetry === true &&
                retryCount < maxRetries
            ) {
                const nextRetryCount = retryCount + 1;

                safeSetQueue(prev => prev.map(f =>
                    f.id === item.id
                        ? { ...f, status: UploadStatus.PENDING, progress: 0, error: null, retryCount: nextRetryCount }
                        : f
                ));

                retryCount = nextRetryCount;
                result = await uploadSingleFile({ ...item, retryCount: nextRetryCount }, signal);
            }

            if (result.success) {
                safeSetQueue(prev => prev.map(f =>
                    f.id === item.id
                        ? {
                            ...f,
                            status: UploadStatus.SUCCESS,
                            progress: 100,
                            uploadedAt: new Date(),
                        }
                        : f
                ));
                onUploadSuccess?.(result.result, item);
            } else {
                safeSetQueue(prev => prev.map(f =>
                    f.id === item.id
                        ? {
                            ...f,
                            status: UploadStatus.ERROR,
                            error: result.error,
                        }
                        : f
                ));
                onUploadError?.(new Error(result.error), item);
            }
        }

        clear();
        setIsUploading(false);
    }, [queue, uploadSingleFile, onUploadSuccess, onUploadError, safeSetQueue, maxRetries]);

    /**
     * Останавливает загрузку
     */
    const stopUpload = useCallback(() => {
        abortControllerRef.current?.abort();
        setIsUploading(false);

        safeSetQueue(prev => prev.map(f =>
            f.status === UploadStatus.UPLOADING
                ? {
                    ...f,
                    status: UploadStatus.CANCELLED,
                    error: ERROR_MESSAGES[ErrorType.CANCELLED],
                }
                : f
        ));
    }, [safeSetQueue]);

    /**
     * Статистика очереди
     */
    const queueStats = {
        total: queue.length,
        pending: queue.filter(f => f.status === UploadStatus.PENDING).length,
        uploading: queue.filter(f => f.status === UploadStatus.UPLOADING).length,
        success: queue.filter(f => f.status === UploadStatus.SUCCESS).length,
        error: queue.filter(f => f.status === UploadStatus.ERROR).length,
        totalSize: queue.reduce((sum, f) => sum + (f.size || 0), 0),
    };

    return {
        queue,
        queueStats,
        isUploading,
        addFiles,
        removeFile,
        clearQueue,
        clearCompleted,
        retryFile,
        startUpload,
        stopUpload,
    };
}

export default useFileUpload;
