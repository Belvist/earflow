/**
 * Service Worker Registration
 * Регистрация и управление Service Worker для:
 * - Фонового воспроизведения музыки
 * - Кэширования аудио и статических ресурсов
 * - Офлайн-работы интерфейса
 */

import { API_BASE_URL } from './api/runtimeConfig';

const isLocalhost = Boolean(
    window.location.hostname === 'localhost' ||
    window.location.hostname === '[::1]' ||
    window.location.hostname.match(/^127(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/)
);

/**
 * Регистрация Service Worker
 * @param {Object} config - Конфигурация с коллбэками
 */
export function register(config) {
    if ('serviceWorker' in navigator) {
        // Service Worker поддерживается
        const publicUrl = new URL(process.env.PUBLIC_URL || '', window.location.href);

        if (publicUrl.origin !== window.location.origin) {
            // PUBLIC_URL на другом домене - SW не будет работать
            return;
        }

        window.addEventListener('load', () => {
            const swUrl = `${process.env.PUBLIC_URL || ''}/sw.js`;

            if (isLocalhost) {
                // На localhost проверяем что SW существует
                checkValidServiceWorker(swUrl, config);

                navigator.serviceWorker.ready.then(() => {
                });
            } else {
                // На продакшене регистрируем напрямую
                registerValidSW(swUrl, config);
            }
        });
    } else {
    }
}

/**
 * Регистрация валидного Service Worker
 */
function registerValidSW(swUrl, config) {
    navigator.serviceWorker
        .register(swUrl)
        .then((registration) => {
            setInterval(() => {
                registration.update();
            }, 5 * 60 * 1000);

            let refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (refreshing) return;
                refreshing = true;
            });

            const checkAppVersion = async () => {
                try {
                    const url = new URL('/api/version', API_BASE_URL).toString();

                    const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
                    if (response.ok) {
                        const data = await response.json();
                        const currentVersion = localStorage.getItem('app_version');
                        if (currentVersion && data.version !== currentVersion) {
                            localStorage.setItem('app_version', data.version);
                            if (registration.waiting) {
                                registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                            } else {
                                registration.unregister().then(() => {
                                });
                            }
                        } else if (!currentVersion) {
                            localStorage.setItem('app_version', data.version);
                        }
                    }
                } catch {
                }
            };

            setInterval(checkAppVersion, 15 * 60 * 1000);
            checkAppVersion();

            registration.onupdatefound = () => {
                const installingWorker = registration.installing;
                if (installingWorker == null) {
                    return;
                }

                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // Новый контент доступен, показываем уведомление
                            if (config && config.onUpdate) {
                                config.onUpdate(registration);
                            }
                            if (registration.waiting) {
                                try {
                                    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
                                } catch (e) {
                                    void e;
                                }
                            }
                        } else {
                            // Контент закэширован для офлайна
                            if (config && config.onSuccess) {
                                config.onSuccess(registration);
                            }
                        }
                    }
                };
            };
        })
        .catch((error) => {
            void error;
        });
}

/**
 * Проверка валидности Service Worker (для localhost)
 */
function checkValidServiceWorker(swUrl, config) {
    fetch(swUrl, {
        headers: { 'Service-Worker': 'script' },
    })
        .then((response) => {
            const contentType = response.headers.get('content-type');

            if (response.status === 404 || (contentType != null && contentType.indexOf('javascript') === -1)) {
                // SW не найден - удаляем старый и перезагружаем
                navigator.serviceWorker.ready.then((registration) => {
                    registration.unregister().then(() => {
                    });
                });
            } else {
                // SW найден - регистрируем
                registerValidSW(swUrl, config);
            }
        })
        .catch(() => {
        });
}

/**
 * Отмена регистрации Service Worker
 */
export function unregister() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
            .then((registration) => {
                registration.unregister();
            })
            .catch((error) => {
                void error;
            });
    }
}

/**
 * Отправка сообщения Service Worker
 * @param {Object} message - Сообщение для SW
 */
export function sendMessage(message) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage(message);
    }
}

/**
 * Предзагрузка аудио-файла в кэш
 * @param {string} audioUrl - URL аудио-файла
 */
export function precacheAudio(audioUrl) {
    sendMessage({
        type: 'CACHE_AUDIO',
        data: { url: audioUrl }
    });
}

/**
 * Очистка аудио-кэша
 */
export function clearAudioCache() {
    sendMessage({ type: 'CLEAR_AUDIO_CACHE' });
}

/**
 * Получение размера кэша
 * @returns {Promise<number>} - Размер в байтах
 */
export function getCacheSize() {
    return new Promise((resolve) => {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
            resolve(0);
            return;
        }

        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = (event) => {
            if (event.data.type === 'CACHE_SIZE') {
                resolve(event.data.size || 0);
            }
        };

        navigator.serviceWorker.controller.postMessage(
            { type: 'GET_CACHE_SIZE' },
            [messageChannel.port2]
        );

        // Таймаут на случай если SW не ответит
        setTimeout(() => resolve(0), 3000);
    });
}

const serviceWorkerAPI = { register, unregister, sendMessage, precacheAudio, clearAudioCache, getCacheSize };
export default serviceWorkerAPI;
