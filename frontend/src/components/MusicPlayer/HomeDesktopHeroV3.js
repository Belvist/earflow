import React, { useMemo } from 'react';
import { FaPlay, FaPause } from 'react-icons/fa';
import { usePlayer } from '../../context/PlayerContext';
import apiClient from '../../api/client';
import HeroWaveformSeek from './HeroWaveformSeek';
import { buildHomeHeroTags } from '../../utils/homeHeroTags';
import {
  HeroSection,
  HeroInner,
  DayLabel,
  CoverFrame,
  CoverImage,
  CoverPlaceholder,
  MetaColumn,
  HeroTitle,
  HeroArtist,
  TagRow,
  Tag,
  PlayColumn,
  PlayButton,
} from './HomeDesktopHeroV3.styles';

export default function HomeDesktopHeroV3({
  currentTrack,
  coverUrl,
  coverLayerRef,
  coverGestureHandlers,
  canSwipeCover,
  shouldShowReason,
  onCoverOpen,
}) {
  const player = usePlayer();
  const coverSrc = coverUrl || (currentTrack ? apiClient.getCoverUrl(currentTrack) : null);
  const isPlaying = Boolean(player?.isPlaying);

  const tags = useMemo(
    () => buildHomeHeroTags(currentTrack, shouldShowReason),
    [currentTrack, shouldShowReason],
  );

  const artistLine = useMemo(() => {
    const raw = currentTrack?.artist;
    if (!raw) return '';
    return String(raw).replace(/\s+/g, ' ').trim();
  }, [currentTrack?.artist]);

  return (
    <HeroSection data-testid="home-desktop-hero-v3" aria-label="Трек дня">
      <HeroInner>
        <div>
          <DayLabel>Трек дня</DayLabel>
          <CoverFrame
            ref={coverLayerRef}
            $swipeable={canSwipeCover}
            $clickable={Boolean(onCoverOpen)}
            data-testid="home-cover-top"
            data-home-hero="desktop-v3"
            role={onCoverOpen ? 'button' : undefined}
            tabIndex={onCoverOpen ? 0 : undefined}
            aria-label={onCoverOpen ? 'Открыть плеер' : undefined}
            onPointerDown={coverGestureHandlers?.onPointerDown}
            onPointerMove={coverGestureHandlers?.onPointerMove}
            onPointerUp={coverGestureHandlers?.onPointerUp}
            onPointerCancel={coverGestureHandlers?.onPointerCancel}
            onKeyDown={(e) => {
              if (!onCoverOpen) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onCoverOpen();
              }
            }}
          >
            {coverSrc ? (
              <CoverImage src={coverSrc} alt={currentTrack?.title || ''} />
            ) : (
              <CoverPlaceholder aria-hidden="true">♪</CoverPlaceholder>
            )}
          </CoverFrame>
        </div>

        <MetaColumn>
          <HeroTitle data-testid="home-track-title">{currentTrack?.title}</HeroTitle>
          {artistLine ? <HeroArtist>{artistLine}</HeroArtist> : null}
          <TagRow>
            {tags.map((label) => (
              <Tag key={label}>{label}</Tag>
            ))}
          </TagRow>
          <HeroWaveformSeek track={currentTrack} isPlaying={isPlaying} />
        </MetaColumn>

        <PlayColumn>
          <PlayButton
            type="button"
            aria-label={isPlaying ? 'Пауза' : 'Воспроизведение'}
            onClick={() => player?.togglePlayPause?.()}
          >
            {isPlaying ? <FaPause /> : <FaPlay style={{ marginLeft: 3 }} />}
          </PlayButton>
        </PlayColumn>
      </HeroInner>
    </HeroSection>
  );
}
