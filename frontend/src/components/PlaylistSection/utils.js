/**
 * PlaylistSection Utilities
 * Вспомогательные функции для работы с плейлистами
 */

import { buildPlaylistShareUrlFromPlaylist } from '../../utils/playlistUrls';

/**
 * Типы плейлистов
 */
export const PLAYLIST_TYPES = {
    ARTIST_MIX: 'artist_mix',
    GENRE_MIX: 'genre_mix',
    MOOD_MIX: 'mood_mix',
    DISCOVERY: 'discovery',
    FAVORITES: 'favorites',
    RECENT: 'recent'
};

/**
 * Генерирует полную ссылку для шаринга плейлиста
 * @param {object} playlist - объект плейлиста
 * @returns {string} - полный URL
 */
export const generateShareUrl = (playlist) => {
    return buildPlaylistShareUrlFromPlaylist(playlist) || '';
};

/**
 * Нормализует имя артиста - извлекает основного исполнителя
 * @param {string} artist - строка с артистом
 * @returns {string} - нормализованное имя
 */
export const normalizeArtistName = (artist) => {
    if (!artist || typeof artist !== 'string') return '';

    // Разделители: feat., ft., &, x, ;, ,
    const mainArtist = artist.split(/[;,&]|\sfeat\.?|\sft\.?|\sx\s/i)[0];
    return mainArtist?.trim() || '';
};

/**
 * Группирует треки по артистам
 * @param {Array} songs - массив треков
 * @returns {Object} - объект с группировкой по артистам
 */
export const groupByArtist = (songs) => {
    if (!Array.isArray(songs)) return {};

    return songs.reduce((groups, song) => {
        if (!song?.artist) return groups;

        const mainArtist = normalizeArtistName(song.artist);
        if (!mainArtist) return groups;

        if (!groups[mainArtist]) {
            groups[mainArtist] = [];
        }
        groups[mainArtist].push(song);

        return groups;
    }, {});
};

/**
 * Группирует треки по жанрам
 * @param {Array} songs - массив треков
 * @returns {Object} - объект с группировкой по жанрам
 */
export const groupByGenre = (songs) => {
    if (!Array.isArray(songs)) return {};

    return songs.reduce((groups, song) => {
        if (!song?.genre) return groups;

        const genre = song.genre.trim().toLowerCase();
        if (!genre) return groups;

        if (!groups[genre]) {
            groups[genre] = [];
        }
        groups[genre].push(song);

        return groups;
    }, {});
};

/**
 * Перемешивает массив (Fisher-Yates shuffle)
 * @param {Array} array - исходный массив
 * @returns {Array} - перемешанный массив (новая копия)
 */
export const shuffleArray = (array) => {
    if (!Array.isArray(array)) return [];

    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

/**
 * Форматирует количество треков
 * @param {number} count - количество
 * @returns {string} - отформатированная строка
 */
export const formatTrackCount = (count) => {
    if (typeof count !== 'number' || count < 0) return '0 треков';

    const lastDigit = count % 10;
    const lastTwoDigits = count % 100;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 19) {
        return `${count} треков`;
    }

    if (lastDigit === 1) {
        return `${count} трек`;
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return `${count} трека`;
    }

    return `${count} треков`;
};
