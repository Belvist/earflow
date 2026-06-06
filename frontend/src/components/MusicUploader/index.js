/**
 * MusicUploader Component
 * 
 * Компонент для загрузки музыкальных файлов.
 * Поддерживает drag & drop, множественную загрузку, прогресс.
 * 
 * @module MusicUploader
 */

import React, { useCallback, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { FaCloudUploadAlt, FaMusic, FaTrash, FaRedo, FaCheck, FaTimes, FaSpinner } from 'react-icons/fa';
import { useFileUpload } from './hooks/useFileUpload';
import { CONFIG, UploadStatus } from './constants';
import { formatFileSize } from './utils';
import * as S from './styles';

/**
 * MusicUploader - компонент загрузки музыки
 * 
 * @param {Object} props
 * @param {Function} props.onUploadSuccess - Callback при успешной загрузке
 * @param {Function} props.onUploadError - Callback при ошибке загрузки
 * @param {boolean} props.compact - Компактный режим для мобильных
 * @param {number} props.maxFiles - Максимальное количество файлов
 */
const MusicUploader = ({
    onUploadSuccess,
    onUploadError,
    compact = false,
    maxFiles = CONFIG.MAX_FILES_AT_ONCE,
}) => {
    const fileInputRef = useRef(null);
    const dropZoneRef = useRef(null);
    const [isDragOver, setIsDragOver] = useState(false);

    const {
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
    } = useFileUpload({
        maxFiles,
        onUploadSuccess,
        onUploadError,
    });

    // Обработка выбора файлов
    const handleFileSelect = useCallback((e) => {
        const files = e.target.files;
        if (files?.length > 0) {
            addFiles(files);
        }
        // Reset input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [addFiles]);

    // Открытие диалога выбора файлов
    const openFileDialog = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    // Drag & Drop handlers
    const handleDragEnter = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        // Проверяем, что мышь действительно покинула зону
        if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget)) {
            setIsDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        const files = e.dataTransfer?.files;
        if (files?.length > 0) {
            addFiles(files);
        }
    }, [addFiles]);

    // Получение иконки статуса
    const getStatusIcon = (status) => {
        switch (status) {
            case UploadStatus.SUCCESS:
                return <FaCheck color="#4ade80" />;
            case UploadStatus.ERROR:
            case UploadStatus.CANCELLED:
                return <FaTimes color="#f87171" />;
            case UploadStatus.UPLOADING:
                return <FaSpinner className="spin" color="#60a5fa" />;
            default:
                return <FaMusic color="#94a3b8" />;
        }
    };

    // Получение цвета прогресс-бара
    const getProgressColor = (status) => {
        switch (status) {
            case UploadStatus.SUCCESS:
                return '#4ade80';
            case UploadStatus.ERROR:
                return '#f87171';
            case UploadStatus.UPLOADING:
                return '#60a5fa';
            default:
                return '#94a3b8';
        }
    };

    return (
        <S.Container $compact={compact}>
            {/* Скрытый input для выбора файлов */}
            <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept={CONFIG.ALLOWED_EXTENSIONS.join(',')}
                multiple
                style={{ display: 'none' }}
            />

            {/* Drop Zone */}
            <S.DropZone
                ref={dropZoneRef}
                $isDragOver={isDragOver}
                $compact={compact}
                onClick={openFileDialog}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <S.DropZoneIcon $isDragOver={isDragOver}>
                    <FaCloudUploadAlt size={compact ? 32 : 48} />
                </S.DropZoneIcon>
                <S.DropZoneText>
                    {isDragOver ? 'Отпустите файлы' : 'Перетащите файлы или нажмите'}
                </S.DropZoneText>
                <S.DropZoneHint>
                    MP3, FLAC, WAV, OGG, M4A • до {Math.round(CONFIG.MAX_FILE_SIZE / 1024 / 1024)}МБ
                </S.DropZoneHint>
            </S.DropZone>

            {/* Queue */}
            {queue.length > 0 && (
                <S.Queue>
                    <S.QueueHeader>
                        <S.QueueTitle>
                            Очередь ({queueStats.total})
                            {queueStats.success > 0 && <S.QueueBadge $color="#4ade80">✓ {queueStats.success}</S.QueueBadge>}
                            {queueStats.error > 0 && <S.QueueBadge $color="#f87171">✕ {queueStats.error}</S.QueueBadge>}
                        </S.QueueTitle>
                        <S.QueueActions>
                            {queueStats.success > 0 && (
                                <S.QueueActionBtn onClick={clearCompleted} title="Очистить завершённые">
                                    <FaCheck size={12} /> Очистить готовые
                                </S.QueueActionBtn>
                            )}
                            <S.QueueActionBtn onClick={clearQueue} title="Очистить всё" $danger>
                                <FaTrash size={12} />
                            </S.QueueActionBtn>
                        </S.QueueActions>
                    </S.QueueHeader>

                    <S.QueueList>
                        {queue.map((item) => (
                            <S.QueueItem key={item.id} $status={item.status}>
                                <S.QueueItemIcon>{getStatusIcon(item.status)}</S.QueueItemIcon>
                                <S.QueueItemInfo>
                                    <S.QueueItemName>{item.name}</S.QueueItemName>
                                    <S.QueueItemMeta>
                                        {formatFileSize(item.size)}
                                        {item.error && <S.QueueItemError> • {item.error}</S.QueueItemError>}
                                    </S.QueueItemMeta>
                                    {(item.status === UploadStatus.UPLOADING || item.status === UploadStatus.PENDING) && (
                                        <S.ProgressBar>
                                            <div style={{
                                                height: '100%',
                                                width: `${item.progress}%`,
                                                background: getProgressColor(item.status),
                                                borderRadius: '2px',
                                                transition: 'width 0.2s ease',
                                            }} />
                                        </S.ProgressBar>
                                    )}
                                </S.QueueItemInfo>
                                <S.QueueItemActions>
                                    {(item.status === UploadStatus.ERROR || item.status === UploadStatus.CANCELLED) && (
                                        <S.QueueItemBtn onClick={() => retryFile(item.id)} title="Повторить">
                                            <FaRedo size={12} />
                                        </S.QueueItemBtn>
                                    )}
                                    <S.QueueItemBtn onClick={() => removeFile(item.id)} title="Удалить" $danger>
                                        <FaTimes size={12} />
                                    </S.QueueItemBtn>
                                </S.QueueItemActions>
                            </S.QueueItem>
                        ))}
                    </S.QueueList>

                    {/* Upload Button */}
                    {queueStats.pending > 0 && (
                        <S.UploadButtonRow>
                            {isUploading ? (
                                <S.UploadButton onClick={stopUpload} $cancel>
                                    <FaTimes /> Отменить
                                </S.UploadButton>
                            ) : (
                                <S.UploadButton onClick={startUpload}>
                                    <FaCloudUploadAlt /> Загрузить ({queueStats.pending})
                                </S.UploadButton>
                            )}
                        </S.UploadButtonRow>
                    )}
                </S.Queue>
            )}
        </S.Container>
    );
};

MusicUploader.propTypes = {
    onUploadSuccess: PropTypes.func,
    onUploadError: PropTypes.func,
    compact: PropTypes.bool,
    maxFiles: PropTypes.number,
};

export default MusicUploader;
