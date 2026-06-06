/**
 * PlaylistSection
 * Главный экспорт с автоматическим выбором версии
 * 
 * Архитектура:
 * - PlaylistSectionDesktop - для экранов 768px+
 * - PlaylistSectionMobile - для экранов до 768px
 * 
 * Использование:
 * import PlaylistSection from './PlaylistSection';
 * <PlaylistSection title="Плейлисты" onPlaylistClick={handleClick} />
 */

import React from 'react';
import useMediaQuery from '../../hooks/useMediaQuery';
import PlaylistSectionDesktop from './PlaylistSectionDesktop';
import PlaylistSectionMobile from './PlaylistSectionMobile';

/**
 * PlaylistSection - автоматически выбирает версию
 * @param {Object} props
 * @param {string} props.title - заголовок секции
 * @param {Function} props.onPlaylistClick - обработчик клика по плейлисту
 * @param {number} props.maxItems - максимальное количество плейлистов
 */
const PlaylistSection = (props) => {
    const isDesktop = useMediaQuery('(min-width: 768px)');

    if (isDesktop) {
        return <PlaylistSectionDesktop {...props} />;
    }

    return <PlaylistSectionMobile {...props} />;
};

// Экспорт отдельных версий для прямого использования
export { default as PlaylistSectionDesktop } from './PlaylistSectionDesktop';
export { default as PlaylistSectionMobile } from './PlaylistSectionMobile';

// Экспорт хуков
export { usePlaylists, useScrollNavigation } from './hooks';

// Экспорт утилит
export * from './utils';

// Дефолтный экспорт - автоматический выбор версии
export default PlaylistSection;
