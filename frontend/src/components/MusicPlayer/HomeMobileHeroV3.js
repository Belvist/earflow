import React, { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaPlay, FaPause } from 'react-icons/fa';
import { usePlayer } from '../../context/PlayerContext';
import apiClient from '../../api/client';
import ArtistLinks from '../ArtistLinks';
import HeroWaveformSeek from './HeroWaveformSeek';
import { resolveArtistPath } from '../../utils/artistRoute';
import { navigateToAlbumFromTrack } from '../../utils/albumRoute';
import { buildHomeHeroTags } from '../../utils/homeHeroTags';
import {
  HeroSection,
  BgTransform,
  BgCover,
  BgPlaceholder,
  BgDim,
  SwipeSurface,
  Content,
  MetaRow,
  TextBlock,
  HeroTitleLink,
  HeroArtistWrap,
  HeroTagsWrap,
  TagRow,
  Tag,
  PlayButton,
  WaveformWrap,
} from './HomeMobileHeroV3.styles';

export default function HomeMobileHeroV3({
  currentTrack,
  coverUrl,
  coverLayerRef,
  coverGestureHandlers,
  canSwipeCover,
  shouldShowReason = false,
  onCoverOpen,
}) {
  const player = usePlayer();
  const navigate = useNavigate();
  const coverSrc = coverUrl || (currentTrack ? apiClient.getCoverUrl(currentTrack) : null);
  const isPlaying = Boolean(player?.isPlaying);

  const artistLine = useMemo(() => {
    const raw = currentTrack?.artist;
    if (!raw) return '';
    return String(raw).replace(/\s+/g, ' ').trim();
  }, [currentTrack?.artist]);

  const tags = useMemo(
    () => buildHomeHeroTags(currentTrack, shouldShowReason),
    [currentTrack, shouldShowReason],
  );

  const handleArtistNavigate = useCallback((name) => {
    if (!name) return;
    void resolveArtistPath(apiClient, name)
      .then((path) => {
        if (path) navigate(path);
      })
      .catch(() => { });
  }, [navigate]);

  const handleTitleNavigate = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    void navigateToAlbumFromTrack(navigate, apiClient, currentTrack);
  }, [navigate, currentTrack]);

  const title = currentTrack?.title ? String(currentTrack.title) : '';

  return (
    <HeroSection data-testid="home-mobile-hero-v3" aria-label="Трек дня">
      <BgTransform ref={coverLayerRef}>
        {coverSrc ? (
          <BgCover src={coverSrc} alt="" aria-hidden="true" />
        ) : (
          <BgPlaceholder aria-hidden="true" />
        )}
        <BgDim aria-hidden="true" />
      </BgTransform>

      <SwipeSurface
        $swipeable={canSwipeCover}
        data-testid="home-cover-top"
        data-home-hero="mobile-v3"
        aria-label={onCoverOpen ? 'Сменить трек или открыть плеер' : undefined}
        onPointerDown={coverGestureHandlers?.onPointerDown}
        onPointerMove={coverGestureHandlers?.onPointerMove}
        onPointerUp={coverGestureHandlers?.onPointerUp}
        onPointerCancel={coverGestureHandlers?.onPointerCancel}
      />

      <Content>
        <MetaRow>
          <TextBlock>
            {title ? (
              <HeroTitleLink
                type="button"
                data-testid="home-track-title"
                data-player-no-drag
                aria-label={`Альбом: ${title}`}
                onClick={handleTitleNavigate}
              >
                {title}
              </HeroTitleLink>
            ) : null}
            {artistLine ? (
              <HeroArtistWrap data-player-no-drag>
                <ArtistLinks value={artistLine} onNavigate={handleArtistNavigate} />
              </HeroArtistWrap>
            ) : null}
            <HeroTagsWrap>
              <TagRow>
                {tags.map((label) => (
                  <Tag key={label}>{label}</Tag>
                ))}
              </TagRow>
            </HeroTagsWrap>
          </TextBlock>
          <PlayButton
            type="button"
            data-player-no-drag
            aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
            onClick={(e) => {
              e.stopPropagation();
              player?.togglePlayPause?.();
            }}
          >
            {isPlaying ? <FaPause size={16} /> : <FaPlay size={16} style={{ marginLeft: 2 }} />}
          </PlayButton>
        </MetaRow>
      </Content>

      <WaveformWrap data-player-no-drag>
        <HeroWaveformSeek track={currentTrack} isPlaying={isPlaying} fullWidth />
      </WaveformWrap>
    </HeroSection>
  );
}
