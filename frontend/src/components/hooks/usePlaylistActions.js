import { useState, useCallback } from 'react';
import React from 'react';
import apiClient from '../../api/client';
import { applyPlaylistTrackCountDelta, makeDebouncedRefetch, getPlaylistTrackCount, notifyPlaylistChanged } from '../../utils/playlistLiveUpdate';

const EMPTY = [];

export function usePlaylistActions({ currentTrack } = {}) {
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [playlists, setPlaylists] = useState(EMPTY);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [createPlaylistLoading, setCreatePlaylistLoading] = useState(false);
  const [pendingTrackForCreate, setPendingTrackForCreate] = useState(null);

  const loadUserPlaylists = useCallback(async () => {
    setPlaylistsLoading(true);
    try {
      const r = await apiClient.getPlaylists();
      setPlaylists(Array.isArray(r) ? r : []);
    } catch {
      setPlaylists([]);
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  const debouncedRefetchPlaylists = React.useMemo(
    () => makeDebouncedRefetch(loadUserPlaylists, 650),
    [loadUserPlaylists]
  );

  const openAddToPlaylist = useCallback(async () => {
    setShowAddToPlaylist(true);
    if (!Array.isArray(playlists) || playlists.length === 0) {
      await loadUserPlaylists();
    }
  }, [playlists, loadUserPlaylists]);

  const closeAddToPlaylist = useCallback(() => {
    setShowAddToPlaylist(false);
  }, []);

  const handleAddToPlaylist = useCallback(async (playlistId, songId, track) => {
    await apiClient.addTrackToPlaylist(playlistId, songId);
    notifyPlaylistChanged({
      playlistId,
      delta: 1,
      cover_path: track?.cover_path || null,
      trackId: track?.id || null,
      updated_at: new Date().toISOString(),
    });
    setPlaylists((prev) => {
      const before = Array.isArray(prev) ? prev.find((p) => p && p.id === playlistId) : null;
      const beforeCount = getPlaylistTrackCount(before);
      const next = applyPlaylistTrackCountDelta(prev, playlistId, 1);

      if (beforeCount === 0 && track && track.cover_path) {
        const nowIso = new Date().toISOString();
        return (Array.isArray(next) ? next : []).map((p) => {
          if (!p || p.id !== playlistId) return p;
          return {
            ...p,
            cover_path: p.cover_path || track.cover_path,
            preview_covers: Array.isArray(p.preview_covers) && p.preview_covers.length > 0
              ? p.preview_covers
              : [{ id: track.id, cover_path: track.cover_path }],
            updated_at: p.updated_at || nowIso,
          };
        });
      }

      return next;
    });
    debouncedRefetchPlaylists();
  }, [debouncedRefetchPlaylists]);

  const handleCreateNewFromMenu = useCallback((track) => {
    setShowAddToPlaylist(false);
    setPendingTrackForCreate(track || null);
    setShowCreatePlaylist(true);
  }, []);

  const handleCreatePlaylistSubmit = useCallback(async (payload) => {
    setCreatePlaylistLoading(true);
    try {
      const created = await apiClient.createPlaylist(payload);
      if (created) {
        setPlaylists((prev) => [created, ...(Array.isArray(prev) ? prev : [])]);
        const t = pendingTrackForCreate || currentTrack;
        if (t && t.id) {
          await apiClient.addTrackToPlaylist(created.id, t.id);
          setPlaylists((prev) => applyPlaylistTrackCountDelta(prev, created.id, 1));
          debouncedRefetchPlaylists();
        }
      }
    } finally {
      setCreatePlaylistLoading(false);
      setPendingTrackForCreate(null);
    }
  }, [pendingTrackForCreate, currentTrack, debouncedRefetchPlaylists]);

  const closeCreatePlaylist = useCallback(() => {
    setShowCreatePlaylist(false);
    setPendingTrackForCreate(null);
  }, []);

  return {
    showAddToPlaylist,
    playlists,
    playlistsLoading,
    showCreatePlaylist,
    createPlaylistLoading,
    openAddToPlaylist,
    closeAddToPlaylist,
    handleAddToPlaylist,
    handleCreateNewFromMenu,
    handleCreatePlaylistSubmit,
    closeCreatePlaylist,
  };
}
