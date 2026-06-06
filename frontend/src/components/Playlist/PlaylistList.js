/**
 * PlaylistList - Список плейлистов с возможностью создания
 */

import React, { useState, useCallback, memo } from 'react';
import styled from 'styled-components';
import { FaPlus, FaSpinner } from 'react-icons/fa';
import PlaylistCard from './PlaylistCard';
import CreatePlaylistModal from './CreatePlaylistModal';

const Container = styled.div`
  width: 100%;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
`;

const Title = styled.h2`
  font-size: 15px;
  font-weight: 700;
  color: white;
  margin: 0;
  
  @media (min-width: 768px) {
    font-size: 16px;
  }
`;

const CreateButton = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }
  
  svg {
    font-size: 12px;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  
  @media (min-width: 480px) {
    grid-template-columns: repeat(3, 1fr);
  }
  
  @media (min-width: 768px) {
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
  }
  
  @media (min-width: 1024px) {
    grid-template-columns: repeat(5, 1fr);
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
`;

const EmptyIcon = styled.div`
  font-size: 32px;
  margin-bottom: 16px;
  opacity: 0.3;
`;

const EmptyText = styled.p`
  font-size: 14px;
  margin: 0 0 16px 0;
  max-width: 300px;
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.5);
  
  svg {
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;

const PlaylistList = memo(({
    playlists = [],
    loading = false,
    onPlayPlaylist,
    onSelectPlaylist,
    onCreatePlaylist,
    showCreateButton = true
}) => {
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);

    const handleCreate = useCallback(async (data) => {
        if (!onCreatePlaylist) return;

        setCreating(true);
        try {
            await onCreatePlaylist(data.name, data.description, data.is_public);
            setShowCreateModal(false);
        } finally {
            setCreating(false);
        }
    }, [onCreatePlaylist]);

    if (loading && playlists.length === 0) {
        return (
            <Container>
                <Header>
                    <Title>Мои плейлисты</Title>
                </Header>
                <LoadingContainer>
                    <FaSpinner size={24} />
                </LoadingContainer>
            </Container>
        );
    }

    return (
        <Container>
            <Header>
                <Title>Мои плейлисты</Title>
                {showCreateButton && (
                    <CreateButton onClick={() => setShowCreateModal(true)}>
                        <FaPlus />
                        Создать
                    </CreateButton>
                )}
            </Header>

            {playlists.length === 0 ? (
                <EmptyState>
                    <EmptyIcon>🎵</EmptyIcon>
                    <EmptyText>
                        У вас пока нет плейлистов. Создайте первый, чтобы собрать любимые треки!
                    </EmptyText>
                    {showCreateButton && (
                        <CreateButton onClick={() => setShowCreateModal(true)}>
                            <FaPlus />
                            Создать плейлист
                        </CreateButton>
                    )}
                </EmptyState>
            ) : (
                <Grid>
                    {playlists.map((playlist) => (
                        <PlaylistCard
                            key={playlist.id}
                            playlist={playlist}
                            onPlay={onPlayPlaylist}
                            onClick={onSelectPlaylist}
                        />
                    ))}
                </Grid>
            )}

            <CreatePlaylistModal
                isOpen={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onSubmit={handleCreate}
                loading={creating}
            />
        </Container>
    );
});

PlaylistList.displayName = 'PlaylistList';

export default PlaylistList;
