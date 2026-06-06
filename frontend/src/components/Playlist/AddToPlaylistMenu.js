/**
 * AddToPlaylistMenu - Меню добавления трека в плейлист
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaPlus, FaMusic, FaCheck, FaSpinner } from 'react-icons/fa';
import { getPlaylistTrackCount } from '../../utils/playlistLiveUpdate';

const Overlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 12000;
  
  @media (min-width: 768px) {
    align-items: center;
  }
`;

const Menu = styled(motion.div)`
  background: #1a1a1a;
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 400px;
  max-height: 70vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: 'Unbounded', sans-serif;
  
  @media (min-width: 768px) {
    border-radius: 16px;
    max-height: 60vh;
  }
`;

const Header = styled.div`
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const Title = styled.h3`
  font-size: 16px;
  font-weight: 600;
  color: white;
  margin: 0 0 4px 0;
  font-family: 'Unbounded', sans-serif;
`;

const Subtitle = styled.p`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.5);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Unbounded', sans-serif;
`;

const List = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  
  &::-webkit-scrollbar {
    width: 4px;
  }
  
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
`;

const PlaylistItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: ${props => props.$added ? 'rgba(255, 255, 255, 0.05)' : 'transparent'};
  border: none;
  color: white;
  text-align: left;
  cursor: ${props => props.$added ? 'default' : 'pointer'};
  transition: background 0.2s;
  font-family: 'Unbounded', sans-serif;
  
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PlaylistCover = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 18px;
  overflow: hidden;
  flex-shrink: 0;
  
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const PlaylistInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const PlaylistName = styled.div`
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: 'Unbounded', sans-serif;
`;

const PlaylistMeta = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Unbounded', sans-serif;
`;

const StatusIcon = styled.div`
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${props => props.$success ? '#4ade80' : 'rgba(255, 255, 255, 0.5)'};
  
  svg {
    font-size: 14px;
  }
`;

const CreateNewButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: transparent;
  border: none;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: white;
  text-align: left;
  cursor: pointer;
  transition: background 0.2s;
  font-family: 'Unbounded', sans-serif;
  
  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }
`;

const CreateIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 18px;
`;

const EmptyState = styled.div`
  padding: 40px 20px;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
`;

const SpinnerIcon = styled(FaSpinner)`
  animation: spin 1s linear infinite;
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

const AddToPlaylistMenu = ({
  isOpen,
  onClose,
  track,
  playlists = [],
  loading = false,
  onAddToPlaylist,
  onCreateNew
}) => {
  const [addingTo, setAddingTo] = useState(null);
  const [addedTo, setAddedTo] = useState(new Set());
  const menuRef = useRef(null);

  // Сброс при закрытии
  useEffect(() => {
    if (!isOpen) {
      setAddingTo(null);
      setAddedTo(new Set());
    }
  }, [isOpen]);

  const handleAdd = useCallback(async (playlist) => {
    if (!track || !track.id || addedTo.has(playlist.id) || addingTo === playlist.id) return;

    setAddingTo(playlist.id);
    try {
      await onAddToPlaylist?.(playlist.id, track.id, track);
      setAddedTo(prev => {
        const next = new Set(prev);
        next.add(playlist.id);
        return next;
      });
    } catch (err) {
      void err;
    } finally {
      setAddingTo(null);
    }
  }, [onAddToPlaylist, track, addedTo, addingTo]);

  const handleCreateNewFromMenu = useCallback(() => {
    if (!track) return;
    onCreateNew?.(track);
  }, [onCreateNew, track]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <Overlay
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleOverlayClick}
        >
          <Menu
            ref={menuRef}
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          >
            <Header>
              <Title>Добавить в плейлист</Title>
              {track && (
                <Subtitle>{track.artist} — {track.title}</Subtitle>
              )}
            </Header>

            <List>
              {loading ? (
                <EmptyState>
                  <SpinnerIcon size={24} />
                </EmptyState>
              ) : playlists.length === 0 ? (
                <EmptyState>
                  У вас пока нет плейлистов
                </EmptyState>
              ) : (
                playlists.map((playlist) => {
                  const isAdded = addedTo.has(playlist.id);
                  const isAdding = addingTo === playlist.id;
                  const coverUrl = playlist.cover_path || playlist.preview_covers?.[0]?.cover_path;

                  return (
                    <PlaylistItem
                      key={playlist.id}
                      onClick={() => handleAdd(playlist)}
                      disabled={isAdding}
                      $added={isAdded}
                    >
                      <PlaylistCover>
                        {coverUrl ? (
                          <img
                            src={coverUrl}
                            alt=""
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <FaMusic />
                        )}
                      </PlaylistCover>

                      <PlaylistInfo>
                        <PlaylistName>{playlist.name}</PlaylistName>
                        <PlaylistMeta>
                          {getPlaylistTrackCount(playlist)} треков
                        </PlaylistMeta>
                      </PlaylistInfo>

                      <StatusIcon $success={isAdded}>
                        {isAdding ? (
                          <SpinnerIcon />
                        ) : isAdded ? (
                          <FaCheck />
                        ) : null}
                      </StatusIcon>
                    </PlaylistItem>
                  );
                })
              )}
            </List>

            <CreateNewButton onClick={handleCreateNewFromMenu}>
              <CreateIcon>
                <FaPlus />
              </CreateIcon>
              <PlaylistInfo>
                <PlaylistName>Новый плейлист</PlaylistName>
                <PlaylistMeta>Создать и добавить трек</PlaylistMeta>
              </PlaylistInfo>
            </CreateNewButton>
          </Menu>
        </Overlay>
      )}
    </AnimatePresence>
  );
};

export default AddToPlaylistMenu;
