/**
 * PlaylistSectionDesktop Component
 * Десктопная версия секции плейлистов (768px+)
 */

import React, { useCallback, useEffect } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import { usePlaylists, useScrollNavigation, usePointerDragScroll } from './hooks';
import useRailWheelScroll from '../../hooks/useRailWheelScroll';
import { PlayIcon, GeneratedMixCover } from './components';
import { buildPlaylistPathFromIdentifier } from '../../utils/playlistUrls';
import { saveVirtualPlaylist } from '../../utils/virtualPlaylists';
import { resolvePlaylistCoverUrl } from './utils/resolvePlaylistCoverUrl';
import {
    SectionContainer,
    SectionHeader,
    HeaderLeft,
    HeaderRight,
    SectionTitle,
    NavArrow,
    ScrollContainer,
    ScrollWrapper,
    FeaturedCard,
    FeaturedInfo,
    FeaturedTitle,
    PlaylistCard,
    PlaylistCoverWrapper,
    PlaylistCover,
    PlaylistCoverPlaceholder,
    PlaylistOverlay,
    PlayButton,
    PlaylistInfo,
    PlaylistTitle,
    EmptyState,
    EmptyIcon,
    EmptyText
} from './styles/desktop.styles';

/**
 * Десктопная версия секции плейлистов
 * @param {Object} props
 * @param {string} props.title - заголовок секции
 * @param {Function} props.onPlaylistClick - обработчик клика по плейлисту
 * @param {number} props.maxItems - максимальное количество плейлистов
 */
const PlaylistSectionDesktop = ({
    title = 'Плейлисты для вас',
    onPlaylistClick,
    maxItems = 6,
    playlists: playlistsProp,
    compactTop = false,
    homeDesktopAlign = false,
}) => {
    const navigate = useNavigate();

    const {
        playlists: generatedPlaylists,
        loading: generatedLoading,
        getUniqueCovers
    } = usePlaylists({ maxItems, autoLoad: !Array.isArray(playlistsProp) });

    const playlists = Array.isArray(playlistsProp)
        ? playlistsProp.slice(0, Math.max(1, maxItems))
        : generatedPlaylists;
    const loading = Array.isArray(playlistsProp) ? false : generatedLoading;

    const {
        scrollRef,
        canScrollLeft,
        canScrollRight,
        needsScroll,
        scrollLeft,
        scrollRight,
        checkScroll
    } = useScrollNavigation({ scrollAmount: 400 });

    // Перепроверяем возможность скролла когда плейлисты загрузились
    useEffect(() => {
        if (!loading && playlists.length > 0) {
            // Даём время на рендер элементов
            const timer = setTimeout(() => {
                checkScroll();
            }, 50);
            return () => clearTimeout(timer);
        }
    }, [loading, playlists.length, checkScroll]);

    useRailWheelScroll(scrollRef);

    const {
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel,
        consumeClickIfMoved,
    } = usePointerDragScroll({ thresholdPx: 10, speed: 1.2 });

    const handlePlaylistClick = useCallback((playlist, e) => {
        if (e?.defaultPrevented) return;
        const p = playlist && typeof playlist === 'object' ? playlist : null;
        if (!p) return;

        const slug = p.share_slug ?? p.shareSlug ?? null;
        if (slug) {
            const path = buildPlaylistPathFromIdentifier(slug);
            if (path) navigate(path);
            return;
        }

        const token = p.shareToken ?? p.token ?? p.mixToken ?? null;
        if (token) {
            const path = buildPlaylistPathFromIdentifier(token);
            if (path) navigate(path);
            return;
        }

        const rawId = p.id ?? null;
        const numericId = typeof rawId === 'number'
            ? String(rawId)
            : (typeof rawId === 'string' && /^\d+$/.test(rawId.trim()) ? rawId.trim() : null);
        if (numericId) {
            const path = buildPlaylistPathFromIdentifier(numericId);
            if (path) navigate(path);
            return;
        }

        const localKey = rawId === undefined || rawId === null ? '' : String(rawId);
        if (!localKey) return;

        saveVirtualPlaylist(p);
        const path = buildPlaylistPathFromIdentifier(localKey);
        if (path) navigate(path);
    }, [navigate]);

    /**
     * Рендер Featured карточки (Открытия недели)
     */
    const renderFeaturedCard = useCallback((playlist) => {
        const tracksSource = playlist.tracks || playlist.items || playlist.songs || [];
        const covers = Array.isArray(tracksSource) && tracksSource.length > 0
            ? getUniqueCovers(tracksSource, 1)
            : [];

        return (
            <FeaturedCard
                data-testid="home-playlist-card"
                key={playlist.id}
                onClick={(e) => {
                    if (consumeClickIfMoved(e)) return;
                    handlePlaylistClick(playlist, e);
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
            >
                <PlaylistCoverWrapper>
                    <GeneratedMixCover
                        coverUrls={covers}
                        title={playlist.title}
                    />
                    <PlaylistOverlay className="playlist-overlay" />
                    <PlayButton
                        className="play-button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onPlaylistClick) {
                                onPlaylistClick(playlist);
                            }
                        }}
                        aria-label="Слушать"
                    >
                        <PlayIcon />
                    </PlayButton>
                </PlaylistCoverWrapper>
                <FeaturedInfo>
                    <FeaturedTitle>{playlist.title}</FeaturedTitle>
                </FeaturedInfo>
            </FeaturedCard>
        );
    }, [getUniqueCovers, handlePlaylistClick, onPlaylistClick, consumeClickIfMoved]);

    /**
     * Рендер обычной карточки плейлиста
     */
    const renderPlaylistCard = useCallback((playlist, index) => {
        const effectiveCoverUrl = resolvePlaylistCoverUrl(playlist);

        const explicitCovers = Array.isArray(playlist.coverTracks) && playlist.coverTracks.length > 0
            ? playlist.coverTracks
            : [];
        const tracksSource = playlist.tracks || playlist.items || playlist.songs || [];
        const derivedCovers = explicitCovers.length > 0
            ? explicitCovers.slice(0, 1)
            : (Array.isArray(tracksSource) && tracksSource.length > 0 ? getUniqueCovers(tracksSource, 1) : []);
        const hasCoverImages = derivedCovers.length > 0;
        const hasGeneratedCover = hasCoverImages;

        return (
            <PlaylistCard
                data-testid="home-playlist-card"
                key={playlist.id}
                onClick={(e) => {
                    if (consumeClickIfMoved(e)) return;
                    handlePlaylistClick(playlist, e);
                }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.3 }}
            >
                <PlaylistCoverWrapper>
                    {hasGeneratedCover ? (
                        <GeneratedMixCover
                            coverUrls={derivedCovers}
                            title={playlist.title}
                        />
                    ) : effectiveCoverUrl ? (
                        <PlaylistCover
                            src={effectiveCoverUrl}
                            alt={playlist.title}
                            loading="lazy"
                            onError={(e) => {
                                e.target.style.display = 'none';
                            }}
                        />
                    ) : null}
                    {!hasGeneratedCover && (
                        <PlaylistCoverPlaceholder
                            style={{ display: effectiveCoverUrl ? 'none' : 'flex' }}
                        />
                    )}
                    <PlaylistOverlay className="playlist-overlay" />
                    <PlayButton
                        className="play-button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (onPlaylistClick) {
                                onPlaylistClick(playlist);
                            }
                        }}
                        aria-label="Слушать"
                    >
                        <PlayIcon />
                    </PlayButton>
                </PlaylistCoverWrapper>
                <PlaylistInfo>
                    <PlaylistTitle>{playlist.title}</PlaylistTitle>
                </PlaylistInfo>
            </PlaylistCard>
        );
    }, [handlePlaylistClick, onPlaylistClick, getUniqueCovers, consumeClickIfMoved]);

    /**
     * Рендер скелетона загрузки
     */
    const renderSkeletons = useCallback(() => (
        <ScrollWrapper>
            {Array.from({ length: 6 }).map((_, i) => (
                <PlaylistCard key={`skeleton-${i}`}>
                    <PlaylistCoverWrapper>
                        <PlaylistCoverPlaceholder style={{ opacity: 0.3 }} />
                    </PlaylistCoverWrapper>
                    <PlaylistInfo>
                        <PlaylistTitle
                            style={{
                                background: 'rgba(255,255,255,0.1)',
                                height: 14,
                                borderRadius: 4
                            }}
                        >
                            &nbsp;
                        </PlaylistTitle>
                    </PlaylistInfo>
                </PlaylistCard>
            ))}
        </ScrollWrapper>
    ), []);

    // Не показываем секцию если нет плейлистов и не загружаем
    if (!loading && playlists.length === 0) {
        return null;
    }

    return (
        <>
            <SectionContainer
                $compactTop={compactTop}
                $homeDesktopAlign={homeDesktopAlign}
                data-testid="home-playlist-section"
            >
                <SectionHeader>
                    <HeaderLeft>
                        <SectionTitle>{title}</SectionTitle>
                    </HeaderLeft>
                    {needsScroll && (
                        <HeaderRight>
                            <NavArrow
                                onClick={scrollLeft}
                                disabled={!canScrollLeft}
                                aria-label="Прокрутить влево"
                            >
                                <FaChevronLeft />
                            </NavArrow>
                            <NavArrow
                                onClick={scrollRight}
                                disabled={!canScrollRight}
                                aria-label="Прокрутить вправо"
                            >
                                <FaChevronRight />
                            </NavArrow>
                        </HeaderRight>
                    )}
                </SectionHeader>

                <ScrollContainer>
                    {loading ? (
                        renderSkeletons()
                    ) : playlists.length > 0 ? (
                        <ScrollWrapper
                            data-testid="home-playlist-rail"
                            ref={scrollRef}
                            onScroll={checkScroll}
                            onPointerDown={(e) => onPointerDown(e, scrollRef.current)}
                            onPointerMove={(e) => onPointerMove(e, scrollRef.current)}
                            onPointerUp={onPointerUp}
                            onPointerCancel={onPointerCancel}
                        >
                            {playlists.map((playlist, index) =>
                                renderPlaylistCard(playlist, index)
                            )}
                        </ScrollWrapper>
                    ) : (
                        <EmptyState>
                            <EmptyIcon>📀</EmptyIcon>
                            <EmptyText>Плейлисты появятся после добавления музыки</EmptyText>
                        </EmptyState>
                    )}
                </ScrollContainer>
            </SectionContainer>
        </>
    );
};

export default PlaylistSectionDesktop;
