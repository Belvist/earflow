/**
 * useScrollNavigation Hook
 * Хук для управления горизонтальным скроллом с навигацией
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Хук для горизонтального скролла с кнопками навигации
 * @param {Object} options - опции
 * @param {number} options.scrollAmount - количество пикселей для скролла
 * @param {number} options.threshold - порог для определения возможности скролла
 * @returns {Object} - ref и методы управления
 */
const useScrollNavigation = ({ scrollAmount = 400, threshold = 10 } = {}) => {
    const scrollRef = useRef(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);
    const [needsScroll, setNeedsScroll] = useState(false);

    /**
     * Проверяет возможность скролла в обе стороны
     */
    const checkScroll = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;

        const { scrollLeft, scrollWidth, clientWidth } = element;

        // Проверяем нужен ли скролл вообще
        const hasOverflow = scrollWidth > clientWidth + threshold;
        setNeedsScroll(hasOverflow);

        if (hasOverflow) {
            setCanScrollLeft(scrollLeft > threshold);
            setCanScrollRight(scrollLeft + clientWidth < scrollWidth - threshold);
        } else {
            setCanScrollLeft(false);
            setCanScrollRight(false);
        }
    }, [threshold]);

    /**
     * Скролл влево
     */
    const scrollLeft = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;

        element.scrollBy({
            left: -scrollAmount,
            behavior: 'smooth'
        });
    }, [scrollAmount]);

    /**
     * Скролл вправо
     */
    const scrollRight = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;

        element.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
    }, [scrollAmount]);

    /**
     * Скролл к началу
     */
    const scrollToStart = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;

        element.scrollTo({
            left: 0,
            behavior: 'smooth'
        });
    }, []);

    /**
     * Скролл к концу
     */
    const scrollToEnd = useCallback(() => {
        const element = scrollRef.current;
        if (!element) return;

        element.scrollTo({
            left: element.scrollWidth,
            behavior: 'smooth'
        });
    }, []);

    // Проверяем при монтировании и изменении размера
    useEffect(() => {
        const timer = setTimeout(checkScroll, 100);
        return () => clearTimeout(timer);
    }, [checkScroll]);

    // Слушаем resize окна
    useEffect(() => {
        const handleResize = () => {
            requestAnimationFrame(checkScroll);
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [checkScroll]);

    return {
        scrollRef,
        canScrollLeft,
        canScrollRight,
        needsScroll,
        scrollLeft,
        scrollRight,
        scrollToStart,
        scrollToEnd,
        checkScroll
    };
};

export default useScrollNavigation;
