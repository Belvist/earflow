import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import apiClient from '../api/client';
import { FaPlay, FaHeart, FaPlus, FaCheck } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayer } from '../context/PlayerContext';
import useAuth from '../hooks/useAuth';
import { redirectToAuth, buildReturnToFromCurrentLocation } from '../utils/authRedirect';
import { portraitCoverBox } from '../styles/mediaCover';

const INFINITE_LOAD_MIN_INTERVAL_MS = 1500;

const RecommendationsContainer = styled.div`
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  border-radius: 24px;
  padding: 22px 24px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  min-height: 320px;

  @media (max-width: 768px) {
    border-radius: 20px;
    padding: 14px 16px;
    min-height: 260px;
  }
`;

const SectionTitle = styled.h3`
  font-size: 16px;
  font-weight: 500;
  margin-bottom: 16px;
  text-transform: uppercase;

  @media (max-width: 768px) {
    font-size: 12px;
    margin-bottom: 10px;
  }
`;

const TrackCard = styled(motion.div)`
  width: 100%;
  min-height: 64px;
  background: ${p => (p.$active ? 'rgba(255, 255, 255, 0.18)' : 'rgba(255, 255, 255, 0.11)')};
  border-radius: 16px;
  backdrop-filter: blur(24.15px);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  padding: 8px 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid ${p => (p.$active ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.1)')};
  position: relative;
  
  &:hover {
    background: rgba(255, 255, 255, 0.15);
    transform: translateX(5px);
  }

  @media (max-width: 768px) {
    min-height: 56px;
    border-radius: 14px;
    padding: 8px 10px;
    margin-bottom: 8px;

    &:hover {
      transform: none;
    }
  }
`;

const TrackImage = styled.img`
  width: 48px;
  flex-shrink: 0;
  ${portraitCoverBox}
  border-radius: 8px;
  object-fit: cover;
  margin-right: 12px;
  box-shadow: -4px 4px 3.7px -2px rgba(0, 0, 0, 0.37) inset;
  border: 1px solid rgba(255, 255, 255, 0.1);

  @media (max-width: 768px) {
    width: 40px;
    border-radius: 7px;
    margin-right: 10px;
  }
`;

const TrackInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
`;

const TrackTitle = styled.h4`
  color: white;
  font-size: 13px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: 5px;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 768px) {
    font-size: 11px;
    margin-bottom: 2px;
  }
`;

const TrackArtist = styled.p`
  color: rgba(255, 255, 255, 0.7);
  font-size: 11px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 300;
  text-transform: uppercase;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (max-width: 768px) {
    font-size: 11px;
  }
`;

const TrackControls = styled.div`
  display: flex;
  align-items: center;
  gap: 15px;

  @media (max-width: 768px) {
    gap: 10px;
  }
`;

const PlayButton = styled(motion.button)`
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.63);
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0px -4px 11.3px -1px rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(24.15px);
  
  &:hover {
    background: rgba(255, 255, 255, 0.8);
  }

  @media (max-width: 768px) {
    width: 36px;
    height: 36px;
  }
`;

const LikeButton = styled(motion.button)`
  width: 35px;
  height: 35px;
  background: rgba(255, 255, 255, 0.63);
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0px -4px 11.3px -1px rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(24.15px);
  
  &:hover {
    background: rgba(255, 255, 255, 0.8);
  }

  @media (max-width: 768px) {
    width: 32px;
    height: 32px;
  }
`;

const AddButton = styled(motion.button)`
  width: 35px;
  height: 35px;
  background: rgba(255, 255, 255, 0.63);
  border: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0px -4px 11.3px -1px rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(24.15px);
  
  &:hover {
    background: rgba(255, 255, 255, 0.8);
  }

  @media (max-width: 768px) {
    width: 32px;
    height: 32px;
  }
`;

const LoadingIndicator = styled.div`
  display: flex;
  justify-content: center;
  padding: 20px;
`;

const LoadingSpinner = styled.div`
  width: 40px;
  height: 40px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top: 3px solid #c5c5c5;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const ScrollContainer = styled.div`
  max-height: 600px;
  overflow-y: auto;
  padding-right: 10px;

  @media (max-width: 768px) {
    max-height: min(60dvh, 520px);
    padding-right: 0;
  }
  
  &::-webkit-scrollbar {
    width: 6px;
  }
  
  &::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 3px;
  }
`;

const Recommendations = ({ title = "Рекомендации", onTrackSelect }) => {
  const { recommendations, currentTrack, isPlaying, queueSource, onSwitchToRecommendations } = usePlayer();
  const { isAuthenticated } = useAuth();
  const [likedIds, setLikedIds] = useState(new Set());
  const [addedIds, setAddedIds] = useState(new Set());
  const [likingIds, setLikingIds] = useState(new Set());
  const scrollRootRef = useRef(null);
  const sentinelRef = useRef(null);
  const isIntersectingRef = useRef(false);
  const autoSwitchedRef = useRef(false);
  const infiniteLoadInFlightRef = useRef(false);
  const lastInfiniteLoadAtRef = useRef(0);
  const getInfiniteFeedRef = useRef(null);
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(false);

  const tracks = useMemo(() => recommendations?.tracks ?? [], [recommendations?.tracks]);
  const loading = recommendations?.loading ?? false;
  const hasMore = recommendations?.hasMore ?? false;

  useEffect(() => {
    getInfiniteFeedRef.current = recommendations?.getInfiniteFeed ?? null;
  }, [recommendations?.getInfiniteFeed]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
    loadingRef.current = loading;
  }, [hasMore, loading]);

  const toIdKey = useCallback((id) => {
    const s = id == null ? '' : String(id).trim();
    return s;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setLikedIds(new Set());
      return;
    }
    const loadLikes = async () => {
      try {
        const liked = await apiClient.getLikes();
        const set = new Set((Array.isArray(liked) ? liked : []).map(s => toIdKey(s?.id)).filter(Boolean));
        setLikedIds(set);
      } catch (err) {
        void err;
      }
    };
    loadLikes();
  }, [isAuthenticated, toIdKey]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (autoSwitchedRef.current) return;
    if (queueSource === 'auto') {
      autoSwitchedRef.current = true;
      return;
    }
    if (typeof onSwitchToRecommendations !== 'function') return;
    autoSwitchedRef.current = true;
    Promise.resolve(onSwitchToRecommendations()).catch(() => null);
  }, [isAuthenticated, queueSource, onSwitchToRecommendations]);

  const loadMoreTracks = useCallback(() => {
    const getInfiniteFeed = getInfiniteFeedRef.current;
    if (!hasMoreRef.current || loadingRef.current || infiniteLoadInFlightRef.current) return;
    if (typeof getInfiniteFeed !== 'function') return;

    const now = Date.now();
    if (now - lastInfiniteLoadAtRef.current < INFINITE_LOAD_MIN_INTERVAL_MS) return;

    infiniteLoadInFlightRef.current = true;
    lastInfiniteLoadAtRef.current = now;

    Promise.resolve(getInfiniteFeed(20))
      .catch(() => undefined)
      .finally(() => {
        infiniteLoadInFlightRef.current = false;
      });
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const root = scrollRootRef.current || null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersectingRef.current = entry.isIntersecting;
        if (entry.isIntersecting) {
          loadMoreTracks();
        }
      },
      { root, rootMargin: '300px 0px', threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreTracks]);

  const handleTrackPlay = (track) => {
    if (onTrackSelect) {
      onTrackSelect(track);
    }
  };

  const handleLikeTrack = async (trackId) => {
    if (!isAuthenticated) {
      redirectToAuth({ reason: 'like', returnTo: buildReturnToFromCurrentLocation(), replace: true });
      return;
    }
    const key = toIdKey(trackId);
    if (!key) return;
    // Предотвращаем повторные клики во время загрузки
    if (likingIds.has(key)) return;

    const isLiked = likedIds.has(key);

    // Оптимистично обновляем UI
    setLikedIds(prev => {
      const next = new Set(prev);
      if (isLiked) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

    setLikingIds(prev => new Set(prev).add(key));

    try {
      if (isLiked) {
        await apiClient.unlikeSong(key);
      } else {
        await apiClient.likeSong(key);
        // Записываем feedback для ML
        if (recommendations?.recordFeedback) {
          recommendations.recordFeedback(key, 'like', 0, 0);
        }
      }
    } catch (err) {
      // Откатываем при ошибке
      setLikedIds(prev => {
        const next = new Set(prev);
        if (isLiked) {
          next.add(key);
        } else {
          next.delete(key);
        }
        return next;
      });
    } finally {
      setLikingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const handleAddTrack = async (track) => {
    if (!isAuthenticated) {
      redirectToAuth({ reason: 'add', returnTo: buildReturnToFromCurrentLocation(), replace: true });
      return;
    }
    const key = toIdKey(track?.id);
    if (!key) return;
    // Предотвращаем повторное добавление
    if (addedIds.has(key)) return;

    // Отмечаем как добавленный (визуальный фидбэк)
    setAddedIds(prev => new Set(prev).add(key));

    try {
      // Добавляем в лайки (стандартное поведение "добавить в мою музыку")
      if (!likedIds.has(key)) {
        await apiClient.likeSong(key);
        setLikedIds(prev => new Set(prev).add(key));

        // Записываем feedback для ML
        if (recommendations?.recordFeedback) {
          recommendations.recordFeedback(key, 'like', 0, 0);
        }
      }

      // Сбрасываем индикатор через 2 секунды
      setTimeout(() => {
        setAddedIds(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
    } catch (err) {
      setAddedIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <RecommendationsContainer>
      <SectionTitle>{title}</SectionTitle>

      <ScrollContainer ref={scrollRootRef}>
        <AnimatePresence>
          {tracks.map((track, index) => {
            const isActive = String(currentTrack?.id ?? '') === String(track?.id ?? '');
            const isActuallyPlaying = isActive && !!isPlaying;
            const idKey = toIdKey(track?.id);

            return (
              <TrackCard
                key={track.id}
                $active={isActive}
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 50 }}
                transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.4) }}
                onClick={() => handleTrackPlay(track)}
              >
                <TrackImage
                  src={apiClient.getCoverUrl(track)}
                  alt={track.title}
                />

                <TrackInfo>
                  <TrackTitle>{track.title}</TrackTitle>
                  <TrackArtist>{track.artist}</TrackArtist>
                </TrackInfo>

                <TrackControls onClick={(e) => e.stopPropagation()}>
                  <LikeButton
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleLikeTrack(track.id)}
                    style={{ opacity: likingIds.has(idKey) ? 0.5 : 1 }}
                  >
                    <FaHeart
                      size={16}
                      color={likedIds.has(idKey) ? '#ff4444' : 'white'}
                    />
                  </LikeButton>

                  <AddButton
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleAddTrack(track)}
                    style={{
                      background: addedIds.has(idKey)
                        ? 'rgba(76, 175, 80, 0.8)'
                        : 'rgba(255, 255, 255, 0.63)'
                    }}
                  >
                    {addedIds.has(idKey)
                      ? <FaCheck size={16} color="white" />
                      : <FaPlus size={16} color="white" />
                    }
                  </AddButton>

                  <PlayButton
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => handleTrackPlay(track)}
                    style={{
                      background: isActuallyPlaying ? 'rgba(76, 175, 80, 0.85)' : 'rgba(255, 255, 255, 0.63)'
                    }}
                  >
                    <FaPlay size={20} color="black" />
                  </PlayButton>
                </TrackControls>
              </TrackCard>
            );
          })}
        </AnimatePresence>

        {loading && (
          <LoadingIndicator>
            <LoadingSpinner />
          </LoadingIndicator>
        )}

        <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />
      </ScrollContainer>
    </RecommendationsContainer>
  );
};

export default Recommendations;
