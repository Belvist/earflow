/**
 * PlaylistModal Component
 * Модальное окно с детальной информацией о плейлисте
 */

import React, { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import apiClient from '../../../api/client';
import useBodyScrollLock from '../../../hooks/useBodyScrollLock';
import { generateShareUrl } from '../utils';
import { FaEllipsisV, FaLink } from 'react-icons/fa';
import {
    ModalOverlay,
    ModalContent,
    ModalHeader,
    ModalCover,
    ModalInfo,
    ModalTitle,
    ModalMeta,
    ModalActions,
    ModalButton,
    CloseButton,
    TrackList,
    TrackItem,
    TrackNumber,
    TrackCover,
    TrackDetails,
    TrackName,
    TrackArtist,
    Toast,
    trackItemVariants
} from '../styles/modal.styles';

/**
 * Модальное окно плейлиста
 * @param {Object} props
 * @param {Object} props.playlist - объект плейлиста
 * @param {boolean} props.isOpen - открыто ли модальное окно
 * @param {Function} props.onClose - обработчик закрытия
 * @param {Function} props.onPlayAll - обработчик воспроизведения всего плейлиста
 * @param {Function} props.onTrackClick - обработчик клика по треку
 */
const PlaylistModal = ({
    playlist,
    isOpen,
    onClose,
    onPlayAll,
    onTrackClick
}) => {
    const [showToast, setShowToast] = useState(false);
    const [toastText, setToastText] = useState('');
    const [showActions, setShowActions] = useState(false);
    const [shareLoading, setShareLoading] = useState(false);

    useBodyScrollLock(isOpen);

    const copyTextToClipboard = useCallback(async (text) => {
        const value = (text || '').toString();
        if (!value) return false;

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch {
            // ignore
        }

        try {
            const el = document.createElement('textarea');
            el.value = value;
            el.setAttribute('readonly', '');
            el.style.position = 'fixed';
            el.style.left = '-9999px';
            el.style.top = '0';
            document.body.appendChild(el);
            el.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(el);
            return Boolean(ok);
        } catch {
            return false;
        }
    }, []);

    /**
     * Копирование ссылки на плейлист
     */
    const handleCopyLink = useCallback(async () => {
        if (!playlist) return;

        if (shareLoading) return;

        let shareUrl = generateShareUrl(playlist);

        // Discover / виртуальные плейлисты: создаём share_slug на сервере
        if (!shareUrl) {
            try {
                setShareLoading(true);
                const ids = Array.isArray(playlist.tracks)
                    ? playlist.tracks.map((t) => t && t.id).filter(Boolean)
                    : [];

                if (ids.length < 1) {
                    return;
                }

                const created = await apiClient.createSharedPlaylist({
                    title: playlist.title || 'Подборка',
                    description: playlist.description || '',
                    song_ids: ids,
                });

                shareUrl = generateShareUrl(created);
            } catch (e) {
                setToastText('Не удалось создать ссылку');
                setShowToast(true);
                setTimeout(() => setShowToast(false), 2000);
                return;
            } finally {
                setShareLoading(false);
            }
        }

        if (!shareUrl) return;

        try {
            const ok = await copyTextToClipboard(shareUrl);
            if (!ok) {
                setToastText('Не удалось скопировать ссылку');
                setShowToast(true);
                setTimeout(() => setShowToast(false), 2000);
                return;
            }
            setToastText('Ссылка скопирована ✓');
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2000);
        } catch (error) {
            setToastText('Не удалось скопировать ссылку');
            setShowToast(true);
            setTimeout(() => setShowToast(false), 2000);
        }
    }, [playlist, shareLoading, copyTextToClipboard]);

    const openActions = useCallback(() => {
        setShowActions(true);
    }, []);

    const closeActions = useCallback(() => {
        setShowActions(false);
    }, []);

    /**
     * Обработка клика по треку
     */
    const handleTrackClick = useCallback((track, index) => {
        if (onTrackClick) {
            onTrackClick(track, index);
        }
    }, [onTrackClick]);

    /**
     * Воспроизведение плейлиста
     */
    const handlePlayAll = useCallback(() => {
        if (onPlayAll) {
            onPlayAll();
        }
    }, [onPlayAll]);

    /**
     * Закрытие модального окна
     */
    const handleClose = useCallback(() => {
        if (onClose) {
            onClose();
        }
        setShowActions(false);
    }, [onClose]);

    /**
     * Остановка всплытия клика
     */
    const handleContentClick = useCallback((e) => {
        e.stopPropagation();
    }, []);

    if (!playlist) return null;

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <ModalOverlay
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={handleClose}
                    >
                        <ModalContent
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={handleContentClick}
                        >
                            <CloseButton onClick={handleClose}>×</CloseButton>

                            <ModalHeader>
                                <ModalCover
                                    src={playlist.coverUrl}
                                    alt={playlist.title}
                                    onError={(e) => {
                                        e.target.src = '/placeholder-cover.png';
                                    }}
                                />
                                <ModalInfo>
                                    <ModalTitle>{playlist.title}</ModalTitle>
                                    <ModalMeta>{playlist.trackCount} треков</ModalMeta>
                                    <ModalActions>
                                        <ModalButton className="primary" onClick={handlePlayAll}>
                                            ▶ Слушать
                                        </ModalButton>
                                        <ModalButton className="secondary" onClick={openActions} aria-label="Действия">
                                            <FaEllipsisV />
                                        </ModalButton>
                                    </ModalActions>
                                    {showActions && (
                                        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                            <ModalButton className="secondary" onClick={async () => { await handleCopyLink(); closeActions(); }}>
                                                <FaLink />Ссылка
                                            </ModalButton>
                                        </div>
                                    )}
                                </ModalInfo>
                            </ModalHeader>

                            <TrackList>
                                {playlist.tracks?.map((track, index) => (
                                    <TrackItem
                                        key={track.id || index}
                                        onClick={() => handleTrackClick(track, index)}
                                        custom={index}
                                        initial="hidden"
                                        animate="visible"
                                        variants={trackItemVariants}
                                    >
                                        <TrackNumber>{index + 1}</TrackNumber>
                                        <TrackCover
                                            src={apiClient.getCoverUrl(track)}
                                            alt={track.title}
                                            onError={(e) => {
                                                e.target.style.display = 'none';
                                            }}
                                        />
                                        <TrackDetails>
                                            <TrackName>{track.title || 'Без названия'}</TrackName>
                                            <TrackArtist>
                                                {track.artist || 'Неизвестный исполнитель'}
                                            </TrackArtist>
                                        </TrackDetails>
                                    </TrackItem>
                                ))}
                            </TrackList>
                        </ModalContent>
                    </ModalOverlay>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showToast && (
                    <Toast
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 20 }}
                    >
                        {toastText || 'Готово'}
                    </Toast>
                )}
            </AnimatePresence>
        </>
    );
};

export default PlaylistModal;
