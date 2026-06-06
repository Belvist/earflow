import React, { useState, useEffect, useCallback } from "react";
import styled from "styled-components";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import apiClient from "../api/client";
import { usePlayer } from "../context/PlayerContext";
import {
  FaArrowLeft,
  FaPlay,
  FaBolt,
  FaPeace,
  FaSmile,
  FaCloudRain,
  FaMoon,
  FaHeart,
  FaCrosshairs,
} from "react-icons/fa";

const MOOD_ICONS = {
  energetic: FaBolt,
  calm: FaPeace,
  happy: FaSmile,
  melancholic: FaCloudRain,
  dark: FaMoon,
  romantic: FaHeart,
  focus: FaCrosshairs,
  neutral: FaCrosshairs,
};

const MOOD_COLORS = {
  energetic: "#ff6b35",
  calm: "#4ecdc4",
  happy: "#ffe66d",
  melancholic: "#6c5ce7",
  dark: "#2d3436",
  romantic: "#fd79a8",
  focus: "#00b894",
  neutral: "#636e72",
};

const BROWSE_MOODS = [
  "energetic",
  "calm",
  "happy",
  "melancholic",
  "dark",
  "romantic",
  "focus",
  "neutral",
];

const MOOD_LABELS = {
  energetic: "Энергичный",
  calm: "Спокойный",
  happy: "Весёлый",
  melancholic: "Меланхоличный",
  dark: "Тёмный",
  romantic: "Романтичный",
  focus: "Фокус",
  neutral: "Нейтральный",
};

const PageContainer = styled.div`
  min-height: 100vh;
  background: rgb(20, 20, 20);
  color: var(--color-text, #fff);
  padding: 16px 12px 140px;
  max-width: 960px;
  margin: 0 auto;

  @media (min-width: 768px) {
    padding: 24px 16px;
  }
`;

const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  color: var(--color-text-secondary, #b3b3b3);
  cursor: pointer;
  font-size: 14px;
  margin-bottom: 24px;

  &:hover {
    color: var(--color-text, #fff);
  }
`;

const PageTitle = styled.h1`
  font-size: 20px;
  font-weight: 800;
  font-family: "Unbounded", sans-serif;
  margin-bottom: 6px;

  @media (min-width: 768px) {
    font-size: 28px;
    margin-bottom: 8px;
  }
`;

const PageSubtitle = styled.p`
  color: var(--color-text-secondary, #b3b3b3);
  font-size: 12px;
  margin-bottom: 20px;

  @media (min-width: 768px) {
    font-size: 15px;
    margin-bottom: 32px;
  }
`;

const RadarSection = styled.div`
  margin-bottom: 32px;
`;

const RadarGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
`;

const MoodCard = styled(motion.div)`
  background: var(--color-surface, #181818);
  border: 2px solid ${({ $color }) => $color || "var(--color-border, #282828)"};
  border-radius: 14px;
  padding: 14px 12px;
  cursor: pointer;
  text-align: center;
  position: relative;

  @media (min-width: 768px) {
    border-radius: 16px;
    padding: 20px 16px;
  }
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    inset: 0;
    background: ${({ $color }) => $color || "transparent"};
    opacity: ${({ $intensity }) => Math.min(($intensity || 0) * 0.15, 0.3)};
    transition: opacity 0.3s;
  }

  &:hover {
    filter: brightness(1.05);
  }
`;

const MoodIcon = styled.div`
  font-size: 22px;
  margin-bottom: 6px;
  color: ${({ $color }) => $color || "var(--color-text, #fff)"};

  @media (min-width: 768px) {
    font-size: 28px;
    margin-bottom: 8px;
  }
`;

const MoodLabel = styled.div`
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 4px;

  @media (min-width: 768px) {
    font-size: 14px;
  }
`;

const MoodConfidence = styled.div`
  font-size: 12px;
  color: var(--color-text-secondary, #b3b3b3);
`;

const TasteMixSection = styled.div`
  margin-bottom: 32px;
`;

const SectionTitle = styled.h2`
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;

  @media (min-width: 768px) {
    font-size: 18px;
    margin-bottom: 16px;
  }
`;

const TasteBar = styled.div`
  display: flex;
  height: 32px;
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 16px;
`;

const TasteSegment = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  min-width: ${({ $minWidth }) => $minWidth || "40px"};
  transition: flex 0.3s;
  cursor: pointer;

  &:hover {
    filter: brightness(1.2);
  }
`;

const TasteLegend = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
`;

const LegendItem = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-secondary, #b3b3b3);
`;

const LegendDot = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
`;

const TrackListSection = styled.div`
  margin-top: 24px;
`;

const TrackItem = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--color-surface-hover, #282828);
  }
`;

const TrackCover = styled.img`
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
`;

const TrackCoverPlaceholder = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: var(--color-surface-hover, #282828);
`;

const TrackInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const TrackTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;

  @media (min-width: 768px) {
    font-size: 14px;
  }
  text-overflow: ellipsis;
`;

const TrackArtist = styled.div`
  font-size: 11px;
  color: var(--color-text-secondary, #b3b3b3);
  white-space: nowrap;
  overflow: hidden;

  @media (min-width: 768px) {
    font-size: 12px;
  }
  text-overflow: ellipsis;
`;

const PlayIcon = styled.div`
  color: var(--color-primary, #1db954);
  font-size: 16px;
  flex-shrink: 0;
`;

const EmptyHint = styled.p`
  margin: 0 0 16px;
  color: var(--color-text-secondary, #b3b3b3);
  font-size: 13px;
  line-height: 1.55;
  max-width: 52ch;
`;

const MoodRadarPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const player = usePlayer();
  const [moods, setMoods] = useState({});
  const [tasteMix, setTasteMix] = useState([]);
  const [selectedMood, setSelectedMood] = useState(null);
  const [moodTracks, setMoodTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tracksLoading, setTracksLoading] = useState(false);

  const handleMoodClick = useCallback(async (mood) => {
    setSelectedMood(mood);
    setMoodTracks([]);
    setTracksLoading(true);
    try {
      const data = await apiClient.getMoodTracks(mood, 20);
      setMoodTracks(data.tracks || []);
    } catch {
      setMoodTracks([]);
    } finally {
      setTracksLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .getMoodRadar()
      .then((data) => {
        if (cancelled) return;
        setMoods(data.moods || {});
        setTasteMix(data.tasteMix || []);
        setLoadError(false);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const moodFromUrl = String(searchParams.get("mood") || "").trim().toLowerCase();
    if (!moodFromUrl || !BROWSE_MOODS.includes(moodFromUrl) || loading) return;
    void handleMoodClick(moodFromUrl);
  }, [searchParams, loading, handleMoodClick]);

  const handleTrackPlay = useCallback(
    (track) => {
      player.onTrackSelect?.(track);
    },
    [player],
  );

  if (loading)
    return (
      <PageContainer>
        <PageTitle>Загрузка...</PageTitle>
      </PageContainer>
    );

  const moodEntries = Object.entries(moods);
  const displayMoods = moodEntries.length > 0
    ? moodEntries
    : BROWSE_MOODS.map((mood) => [mood, { confidence: 0.5, trackCount: 0, browse: true }]);

  const totalConfidence = moodEntries.reduce(
    (s, [, m]) => s + (m.confidence || 0),
    0,
  );

  return (
    <PageContainer>
      <BackButton onClick={() => navigate(-1)}>
        <FaArrowLeft /> Назад
      </BackButton>
      <PageTitle>Mood Radar</PageTitle>
      <PageSubtitle>Ваш музыкальный профиль настроений</PageSubtitle>

      {loadError ? (
        <EmptyHint>
          Не удалось загрузить профиль. Ниже можно выбрать настроение и послушать подборку.
        </EmptyHint>
      ) : null}

      {moodEntries.length === 0 && !loadError ? (
        <EmptyHint>
          Пока мало данных из ваших лайков — выберите настроение, чтобы открыть подборку треков.
        </EmptyHint>
      ) : null}

      <RadarSection>
        <SectionTitle>Радар настроений</SectionTitle>
        <RadarGrid>
          {displayMoods.map(([mood, data]) => {
            const Icon = MOOD_ICONS[mood] || FaCrosshairs;
            const color = MOOD_COLORS[mood] || "#636e72";
            const isBrowse = Boolean(data.browse);
            return (
              <MoodCard
                key={mood}
                $color={color}
                $intensity={data.confidence}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleMoodClick(mood)}
              >
                <MoodIcon $color={color}>
                  <Icon />
                </MoodIcon>
                <MoodLabel>{MOOD_LABELS[mood] || mood}</MoodLabel>
                <MoodConfidence>
                  {isBrowse
                    ? "Подборка"
                    : `${Math.round((data.confidence || 0) * 100)}% · ${data.trackCount} треков`}
                </MoodConfidence>
              </MoodCard>
            );
          })}
        </RadarGrid>
      </RadarSection>

      {tasteMix.length > 0 && (
        <TasteMixSection>
          <SectionTitle>Taste Mix</SectionTitle>
          <TasteBar>
            {tasteMix.map((item) => {
              const pct =
                totalConfidence > 0
                  ? (item.confidence / totalConfidence) * 100
                  : 0;
              const color = MOOD_COLORS[item.mood] || "#636e72";
              return (
                <TasteSegment
                  key={item.mood}
                  style={{ flex: pct || 1 }}
                  $minWidth={pct < 8 ? "40px" : undefined}
                  $color={color}
                  onClick={() => handleMoodClick(item.mood)}
                >
                  {pct >= 12 ? MOOD_LABELS[item.mood] || item.mood : ""}
                </TasteSegment>
              );
            })}
          </TasteBar>
          <TasteLegend>
            {tasteMix.map((item) => {
              const color = MOOD_COLORS[item.mood] || "#636e72";
              const pct =
                totalConfidence > 0
                  ? Math.round((item.confidence / totalConfidence) * 100)
                  : 0;
              return (
                <LegendItem key={item.mood}>
                  <LegendDot $color={color} />
                  {MOOD_LABELS[item.mood] || item.mood} ({pct}%)
                </LegendItem>
              );
            })}
          </TasteLegend>
        </TasteMixSection>
      )}

      <AnimatePresence>
        {selectedMood && (
          <TrackListSection>
            <SectionTitle>
              {MOOD_LABELS[selectedMood] || selectedMood} треки
            </SectionTitle>
            {tracksLoading ? (
              <EmptyHint>Загрузка треков…</EmptyHint>
            ) : null}
            {!tracksLoading && moodTracks.length === 0 ? (
              <EmptyHint>Для этого настроения пока нет треков. Попробуйте другое.</EmptyHint>
            ) : null}
            {moodTracks.map((track, i) => {
              const coverUrl = track.cover_path
                ? apiClient.getCoverUrl(track, true)
                : null;
              return (
                <TrackItem
                  key={track.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => handleTrackPlay(track)}
                >
                  {coverUrl ? (
                    <TrackCover src={coverUrl} alt={track.title} />
                  ) : (
                    <TrackCoverPlaceholder />
                  )}
                  <TrackInfo>
                    <TrackTitle>{track.title || "Без названия"}</TrackTitle>
                    <TrackArtist>{track.artist || "Неизвестный"}</TrackArtist>
                  </TrackInfo>
                  <PlayIcon>
                    <FaPlay />
                  </PlayIcon>
                </TrackItem>
              );
            })}
          </TrackListSection>
        )}
      </AnimatePresence>
    </PageContainer>
  );
};

export default MoodRadarPage;
