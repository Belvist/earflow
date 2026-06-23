/**
 * useMediaQuery Hook
 * Хук для отслеживания медиа-запросов
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Хук для отслеживания медиа-запросов
 * @param {string} query - CSS медиа-запрос (например, '(min-width: 768px)')
 * @returns {boolean} - соответствует ли текущий экран запросу
 * 
 * @example
 * const isDesktop = useMediaQuery('(min-width: 768px)');
 * const isMobile = useMediaQuery('(max-width: 767px)');
 * const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
 */
const useMediaQuery = (query) => {
    /**
     * Получает начальное значение
     */
    const getMatches = useCallback(() => {
        // SSR проверка
        if (typeof window === 'undefined') {
            return false;
        }
        return window.matchMedia(query).matches;
    }, [query]);

    const [matches, setMatches] = useState(getMatches);

    useEffect(() => {
        // SSR проверка
        if (typeof window === 'undefined') {
            return;
        }

        const mediaQuery = window.matchMedia(query);

        /**
         * Обработчик изменения медиа-запроса
         */
        const handleChange = (event) => {
            setMatches(event.matches);
        };

        // Устанавливаем начальное значение
        setMatches(mediaQuery.matches);

        // Подписываемся на изменения
        // Используем addEventListener для современных браузеров
        if (mediaQuery.addEventListener) {
            mediaQuery.addEventListener('change', handleChange);
        } else {
            // Fallback для старых браузеров
            mediaQuery.addListener(handleChange);
        }

        // Отписываемся при размонтировании
        return () => {
            if (mediaQuery.removeEventListener) {
                mediaQuery.removeEventListener('change', handleChange);
            } else {
                // Fallback для старых браузеров
                mediaQuery.removeListener(handleChange);
            }
        };
    }, [query, getMatches]);

    return matches;
};

export default useMediaQuery;
