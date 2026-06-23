import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';

const AudioPlayerContainer = styled.div`
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
  padding: 0;
  margin: -1px;
`;

const useAudioPlayer = () => {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const play = () => {
    if (audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const pause = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const setTrack = (trackUrl) => {
    if (audioRef.current) {
      audioRef.current.src = trackUrl;
      setCurrentTime(0);
      setIsPlaying(false);
    }
  };

  const seek = (time) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const setAudioVolume = (newVolume) => {
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      setVolume(newVolume);
    }
  };

  return {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    play,
    pause,
    setTrack,
    seek,
    setVolume: setAudioVolume,
  };
};

const AudioPlayer = ({ audioRef }) => {
  useEffect(() => {
    const audio = audioRef?.current;
    if (!audio) return;
    try { audio.setAttribute('playsinline', ''); } catch { }
    try { audio.setAttribute('webkit-playsinline', 'true'); } catch { }
  }, [audioRef]);

  return (
    <AudioPlayerContainer>
      <audio
        ref={audioRef}
        preload="metadata"
        crossOrigin="use-credentials"
      />
    </AudioPlayerContainer>
  );
};

export { useAudioPlayer, AudioPlayer };
