import React, { useState } from 'react';
import styled from 'styled-components';
import apiClient from '../api/client';
import { motion } from 'framer-motion';
import { FaPlay, FaPause, FaHeart, FaPlus, FaTrash } from 'react-icons/fa';

const PlaylistContainer = styled(motion.div)`
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  border-radius: 20px;
  padding: 20px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
`;

const PlaylistHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
`;

const PlaylistTitle = styled.h3`
  font-size: 18px;
  font-weight: 500;
  text-transform: uppercase;
`;

const PlaylistActions = styled.div`
  display: flex;
  gap: 10px;
`;

const ActionButton = styled(motion.button)`
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: white;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  transition: all 0.3s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

const TrackList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TrackItem = styled(motion.div)`
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 12px;
  display: flex;
  align-items: center;
  gap: 15px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid rgba(255, 255, 255, 0.1);
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  
  &.active {
    background: rgba(197, 197, 197, 0.2);
    border-color: #c5c5c5;
  }
`;

const TrackIndex = styled.div`
  width: 30px;
  text-align: center;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
`;

const TrackCover = styled.img`
  width: 50px;
  height: 50px;
  border-radius: 8px;
  object-fit: cover;
`;

const TrackInfo = styled.div`
  flex: 1;
`;

const TrackName = styled.div`
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
`;

const TrackArtist = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
`;

const TrackDuration = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  margin-right: 10px;
`;

const TrackControls = styled.div`
  display: flex;
  gap: 8px;
`;

const TrackButton = styled.button`
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  
  &:hover {
    transform: scale(1.1);
  }
  
  &.liked {
    color: #ff4458;
  }
`;

const EmptyPlaylist = styled.div`
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.5);
`;

const Playlist = ({ title = "Мой плейлист", tracks = [], onTrackSelect, currentTrackId, isPlaying }) => {
  const [playlistTracks, setPlaylistTracks] = useState(tracks);

  const handleTrackClick = (track) => {
    if (onTrackSelect) {
      onTrackSelect(track);
    }
  };

  const handleLikeToggle = (trackId, e) => {
    e.stopPropagation();
    setPlaylistTracks(prev =>
      prev.map(track =>
        track.id === trackId
          ? { ...track, isLiked: !track.isLiked }
          : track
      )
    );
  };

  const handleRemoveTrack = (trackId, e) => {
    e.stopPropagation();
    setPlaylistTracks(prev => prev.filter(track => track.id !== trackId));
  };

  const handleAddTrack = () => {
    // Здесь можно добавить логику для добавления нового трека
  };

  const handleShuffle = () => {
    const shuffled = [...playlistTracks].sort(() => Math.random() - 0.5);
    setPlaylistTracks(shuffled);
  };

  return (
    <PlaylistContainer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <PlaylistHeader>
        <PlaylistTitle>{title}</PlaylistTitle>
        <PlaylistActions>
          <ActionButton
            onClick={handleShuffle}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Перемешать
          </ActionButton>
          <ActionButton
            onClick={handleAddTrack}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <FaPlus size={12} />
            Добавить
          </ActionButton>
        </PlaylistActions>
      </PlaylistHeader>

      {playlistTracks.length === 0 ? (
        <EmptyPlaylist>
          Плейлист пуст. Добавьте треки для начала прослушивания.
        </EmptyPlaylist>
      ) : (
        <TrackList>
          {playlistTracks.map((track, index) => (
            <TrackItem
              key={track.id}
              onClick={() => handleTrackClick(track)}
              className={currentTrackId === track.id ? 'active' : ''}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <TrackIndex>
                {currentTrackId === track.id && isPlaying ? (
                  <FaPlay size={12} />
                ) : (
                  index + 1
                )}
              </TrackIndex>

              <TrackCover src={apiClient.getCoverUrl(track)} alt={track.title} />

              <TrackInfo>
                <TrackName>{track.title}</TrackName>
                <TrackArtist>{track.artist}</TrackArtist>
              </TrackInfo>

              <TrackDuration>{track.duration}</TrackDuration>

              <TrackControls>
                <TrackButton
                  className={track.isLiked ? 'liked' : ''}
                  onClick={(e) => handleLikeToggle(track.id, e)}
                >
                  <FaHeart size={14} />
                </TrackButton>
                <TrackButton onClick={(e) => handleRemoveTrack(track.id, e)}>
                  <FaTrash size={14} />
                </TrackButton>
              </TrackControls>
            </TrackItem>
          ))}
        </TrackList>
      )}
    </PlaylistContainer>
  );
};

export default Playlist;
