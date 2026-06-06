import React, { useState, useEffect, useCallback, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  FaCog,
  FaHeart,
  FaMusic,
  FaBan,
  FaChevronLeft,
  FaTimes,
  FaUser,
  FaVolumeUp,
  FaCheck,
  FaSignOutAlt,
  FaPlay,
  FaList,
  FaPlus,
  FaTrash,
  FaEdit,
  FaGlobe,
  FaLink,
  FaEllipsisV,
  FaNetworkWired,
  FaShieldAlt,
} from "react-icons/fa";
import apiClient from "../api/client";
import ArtistLinks from "./ArtistLinks";
import LikedOfflineButton from "../offline/LikedOfflineButton";
import OfflineTrackBadge from "../offline/OfflineTrackBadge";
import DeviceSyncSection from "./DeviceSync/DeviceSyncSection";
import { DEVICE_SYNC_ENABLED as DEVICE_SYNC_FLAG } from "../api/runtimeConfig";
import {
  getPlaylistTrackCount,
  applyPlaylistTrackCountDelta,
  subscribePlaylistChanged,
} from "../utils/playlistLiveUpdate";
import { resolveArtistPath } from "../utils/artistRoute";
import { usePlayer } from "../context/PlayerContext";
import useAuth from "../hooks/useAuth";
import MiniBarVariantPicker from "./MobilePlayerBar/MiniBarVariantPicker";
import ActiveSessionsSection from "./Settings/ActiveSessionsSection";
import { buildPlaylistShareUrlFromSlug } from "../utils/playlistUrls";

// ============ КОНСТАНТЫ ============

const MUSIC_TABS = [
  {
    id: "liked",
    label: "Понравилось",
    icon: FaHeart,
    emptyIcon: "❤️",
    emptyText: "Лайкайте треки, чтобы они появились здесь",
  },
  {
    id: "playlists",
    label: "Плейлисты",
    icon: FaList,
    emptyIcon: "📚",
    emptyText: "Создайте свой первый плейлист",
  },
  {
    id: "hidden",
    label: "Скрытые",
    icon: FaBan,
    emptyIcon: "🚫",
    emptyText: "Скрытых треков нет",
  },
];

const DEVICE_SYNC_ENABLED = DEVICE_SYNC_FLAG;

const SETTINGS_TABS = DEVICE_SYNC_ENABLED
  ? [
    { id: "profile", label: "Профиль", icon: FaUser },
    { id: "audio", label: "Звук", icon: FaVolumeUp },
    { id: "sessions", label: "Сессии", icon: FaShieldAlt },
    { id: "devices", label: "Устройства", icon: FaNetworkWired },
  ]
  : [
    { id: "profile", label: "Профиль", icon: FaUser },
    { id: "audio", label: "Звук", icon: FaVolumeUp },
    { id: "sessions", label: "Сессии", icon: FaShieldAlt },
  ];

const AUDIO_QUALITY = [
  { value: "auto", label: "Авто" },
  { value: "low", label: "Низкое" },
  { value: "medium", label: "Среднее" },
  { value: "high", label: "Высокое" },
  { value: "lossless", label: "Lossless" },
];

const formatTime = (s) => {
  if (!s || s < 60) return "0 мин";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m} мин`;
};

// ============ КОМПОНЕНТ ============

const ProfilePage = () => {
  const navigate = useNavigate();
  const player = usePlayer();
  const { user: authUser, logout, refreshUser } = useAuth();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState(null);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const avatarInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [activeTab, setActiveTab] = useState("liked");
  const [likedSongs, setLikedSongs] = useState([]);
  const [dislikedSongs, setDislikedSongs] = useState([]);

  // Плейлисты
  const [playlists, setPlaylists] = useState([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState(null);
  const [playlistForm, setPlaylistForm] = useState({
    name: "",
    description: "",
  });
  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(null);

  // Модалка настроек
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("profile");

  // Настройки
  const [settings, setSettings] = useState({
    display_name: "",
    audio_quality: "auto",
    autoplay_enabled: true,
    crossfade_seconds: 0,
    normalize_volume: false,
    listening_history_enabled: true,
    show_activity: true,
  });
  const [saved, setSaved] = useState(false);
  const [stats, setStats] = useState(null);

  const [isMobile, setIsMobile] = useState(false);

  // Модалка подтверждения выхода из аккаунта — чтобы случайный тап на «Выйти»
  // (особенно на мобильном) не выбрасывал сессию.
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutInFlight, setLogoutInFlight] = useState(false);

  // ===== ЭФФЕКТЫ =====

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePlaylistChanged((payload) => {
      const playlistId = payload?.playlistId;
      if (!playlistId) return;

      const delta = Number.isFinite(payload?.delta) ? payload.delta : 0;
      const coverPath = payload?.cover_path || payload?.coverPath || null;
      const updatedAt = payload?.updated_at || payload?.updatedAt || null;

      setPlaylists((prev) => {
        let next = prev;
        if (delta !== 0) {
          next = applyPlaylistTrackCountDelta(next, playlistId, delta);
        }

        return (Array.isArray(next) ? next : []).map((p) => {
          if (!p || p.id !== playlistId) return p;
          const previewCover = p.preview_covers?.[0]?.cover_path || null;
          const hasCover = !!(p.cover_path || previewCover);
          const isAutoCover =
            !!previewCover &&
            !!p.cover_path &&
            String(p.cover_path) === String(previewCover);

          const shouldClearAutoCover =
            isAutoCover && delta < 0 && coverPath === null;
          const shouldSetCover =
            (!hasCover && !!coverPath) || (isAutoCover && coverPath !== null);

          const nextPreview = coverPath
            ? Array.isArray(p.preview_covers) && p.preview_covers.length > 0
              ? [
                { ...p.preview_covers[0], cover_path: coverPath },
                ...p.preview_covers.slice(1),
              ]
              : [{ id: payload?.trackId, cover_path: coverPath }]
            : p.preview_covers;
          return {
            ...p,
            cover_path: shouldClearAutoCover
              ? null
              : shouldSetCover
                ? coverPath
                : p.cover_path,
            preview_covers: shouldClearAutoCover
              ? []
              : shouldSetCover
                ? nextPreview
                : p.preview_covers,
            updated_at: updatedAt || p.updated_at,
          };
        });
      });
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // Используем getProfile напрямую чтобы не обновлять глобальный user
        // и не вызывать пересоздание PlayerProvider
        const data = await apiClient.getProfile();
        setUser(data);
        // Загружаем настройки сразу для отображения display_name
        const userSettings = await apiClient.getUserSettings();
        if (userSettings) {
          setSettings((prev) => ({ ...prev, ...userSettings }));
        }
      } catch {
        setUser(authUser || { username: "Пользователь" });
      } finally {
        setLoading(false);
      }
    })();
    loadLikes();
    loadDislikes();
    loadPlaylists();
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (showSettings) {
      // Обновляем настройки при открытии модалки
      loadSettings();
      loadStats();
    }
  }, [showSettings]);

  // ===== ЗАГРУЗКА =====

  const loadLikes = async () => {
    try {
      const r = await apiClient.getLikes();
      setLikedSongs(Array.isArray(r) ? r : []);
    } catch {
      // Keep the last confirmed data on transient auth/network desync.
    }
  };

  const loadDislikes = async () => {
    try {
      const r = await apiClient.getDislikes();
      setDislikedSongs(Array.isArray(r) ? r : []);
    } catch {
      // Keep the last confirmed data on transient auth/network desync.
    }
  };

  // Загрузка плейлистов
  const loadPlaylists = useCallback(async () => {
    setPlaylistsLoading(true);
    try {
      const r = await apiClient.getPlaylists();
      setPlaylists(Array.isArray(r) ? r : []);
    } catch {
      // Keep the last confirmed data on transient auth/network desync.
    } finally {
      setPlaylistsLoading(false);
    }
  }, []);

  // Создание плейлиста
  const handleCreatePlaylist = async () => {
    if (!playlistForm.name.trim()) return;
    try {
      const newPlaylist = await apiClient.createPlaylist({
        name: playlistForm.name.trim(),
        description: playlistForm.description.trim(),
      });
      if (newPlaylist) {
        setPlaylists((prev) => [newPlaylist, ...prev]);
        setShowCreatePlaylist(false);
        setPlaylistForm({ name: "", description: "" });
      }
    } catch (err) {
      showToast("Ошибка создания плейлиста");
    }
  };

  // Обновление плейлиста
  const handleUpdatePlaylist = async () => {
    if (!editingPlaylist || !playlistForm.name.trim()) return;
    try {
      const updated = await apiClient.updatePlaylist(editingPlaylist.id, {
        name: playlistForm.name.trim(),
        description: playlistForm.description.trim(),
      });
      if (updated) {
        setPlaylists((prev) =>
          prev.map((p) => (p.id === editingPlaylist.id ? updated : p)),
        );
        setEditingPlaylist(null);
        setPlaylistForm({ name: "", description: "" });
      }
    } catch (err) {
      showToast("Ошибка обновления плейлиста");
    }
  };

  // Удаление плейлиста
  const handleDeletePlaylist = async (playlistId) => {
    if (!window.confirm("Удалить плейлист?")) return;
    try {
      await apiClient.deletePlaylist(playlistId);
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId));
      setPlaylistMenuOpen(null);
    } catch (err) {
      showToast("Ошибка удаления плейлиста");
    }
  };

  const showToast = useCallback((message) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 2000);
  }, []);

  const openAvatarPicker = useCallback(() => {
    if (avatarUploading) return;
    const el = avatarInputRef.current;
    if (!el) return;
    try {
      el.value = "";
    } catch { }
    el.click();
  }, [avatarUploading]);

  const onAvatarFileSelected = useCallback(
    async (e) => {
      const file = e?.target?.files?.[0] || null;
      if (!file) return;

      setAvatarUploading(true);
      setAvatarUploadProgress(0);
      setAvatarFailed(false);

      try {
        const result = await apiClient.uploadUserAvatar(file, (p) => {
          const n = Number(p);
          if (!Number.isFinite(n)) return;
          setAvatarUploadProgress(Math.max(0, Math.min(100, n)));
        });

        const nextUrl = result?.photoUrl || result?.photo_url || null;
        if (nextUrl) {
          setUser((prev) =>
            prev && typeof prev === "object"
              ? { ...prev, photoUrl: nextUrl, photo_url: nextUrl }
              : prev,
          );
        }

        try {
          await refreshUser?.({ bustCache: true });
        } catch { }
      } catch {
        showToast("Ошибка загрузки аватара");
      } finally {
        setAvatarUploading(false);
        setAvatarUploadProgress(0);
      }
    },
    [refreshUser, showToast],
  );

  // Копирование ссылки на плейлист
  const handleCopyPlaylistLink = async (playlist) => {
    if (!playlist) return;

    let slug = playlist.share_slug || null;
    if (!slug && playlist.id) {
      try {
        const regenerated = await apiClient.regeneratePlaylistShareLink(
          playlist.id,
        );
        if (regenerated && regenerated.share_slug) {
          slug = regenerated.share_slug;
          setPlaylists((prev) =>
            prev.map((p) =>
              p.id === playlist.id
                ? { ...p, share_slug: regenerated.share_slug }
                : p,
            ),
          );
        }
      } catch { }
    }

    if (!slug) return;
    const url = buildPlaylistShareUrlFromSlug(slug);
    try {
      await navigator.clipboard.writeText(url);
      showToast("Ссылка скопирована!");
    } catch { }
  };

  // Открытие редактирования плейлиста
  const openEditPlaylist = (playlist) => {
    setEditingPlaylist(playlist);
    setPlaylistForm({
      name: playlist.name,
      description: playlist.description || "",
    });
    setPlaylistMenuOpen(null);
  };

  const loadSettings = async () => {
    try {
      const r = await apiClient.getUserSettings();
      if (r) setSettings((prev) => ({ ...prev, ...r }));
    } catch { }
  };

  const loadStats = async () => {
    try {
      const r = await apiClient.getUserStats();
      setStats(r);
    } catch { }
  };

  // ===== ОБРАБОТЧИКИ =====

  const saveSettings = useCallback(
    async (data) => {
      setSaved(false);
      try {
        const result = await apiClient.updateUserSettings(data);
        if (result) {
          setSettings((prev) => ({ ...prev, ...result }));
          // Обновляем настройки в PlayerContext
          if (player.setUserSettings) {
            player.setUserSettings((prev) => ({
              ...prev,
              autoplay_enabled:
                result.autoplay_enabled ?? prev.autoplay_enabled,
              crossfade_seconds:
                result.crossfade_seconds ?? prev.crossfade_seconds,
              normalize_volume:
                result.normalize_volume ?? prev.normalize_volume,
              audio_quality: result.audio_quality ?? prev.audio_quality,
            }));
          }
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        showToast("Ошибка сохранения настроек");
      }
    },
    [player],
  );

  const handleSetting = useCallback(
    (k, v) => {
      setSettings((prev) => ({ ...prev, [k]: v }));
      saveSettings({ [k]: v });
    },
    [saveSettings],
  );

  const playTrack = (list, song) => {
    if (!list?.length) return;
    player.playFromList(list, song?.id || list[0].id);
  };

  const playAll = () => {
    const list = getList();
    if (list.length) player.playFromList(list, list[0].id);
  };

  const toggleLike = async (song) => {
    try {
      const liked = likedSongs.some((s) => s.id === song.id);
      if (liked) {
        await apiClient.unlikeSong(song.id);
        setLikedSongs((prev) => prev.filter((s) => s.id !== song.id));
      } else {
        await apiClient.likeSong(song.id);
        setLikedSongs((prev) => [song, ...prev]);
      }
    } catch { }
  };

  const toggleDislike = async (song) => {
    try {
      const disliked = dislikedSongs.some((s) => s.id === song.id);
      if (disliked) {
        await apiClient.undislikeSong(song.id);
        setDislikedSongs((prev) => prev.filter((s) => s.id !== song.id));
      } else {
        await apiClient.dislikeSong(song.id);
        setDislikedSongs((prev) => [song, ...prev]);
      }
    } catch { }
  };

  const handleLogout = useCallback(() => {
    if (logoutInFlight) return;
    setShowLogoutConfirm(true);
  }, [logoutInFlight]);

  const closeLogoutConfirm = useCallback(() => {
    if (logoutInFlight) return;
    setShowLogoutConfirm(false);
  }, [logoutInFlight]);

  const confirmLogout = useCallback(async () => {
    if (logoutInFlight) return;
    setLogoutInFlight(true);
    try {
      await Promise.resolve(logout());
    } catch {
      // AuthContext всё равно очищает локальную сессию.
    } finally {
      setLogoutInFlight(false);
      setShowLogoutConfirm(false);
      setShowSettings(false);
      try {
        navigate("/", { replace: true });
      } catch {
        /* ignore */
      }
    }
  }, [logout, logoutInFlight, navigate]);

  // Клавиша Escape закрывает подтверждение, Enter — подтверждает,
  // чтобы модалка работала и с клавиатуры на десктопе.
  useEffect(() => {
    if (!showLogoutConfirm) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLogoutConfirm();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void confirmLogout();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [showLogoutConfirm, closeLogoutConfirm, confirmLogout]);

  // ===== DRAG SCROLL ДЛЯ ТАБОВ с threshold =====
  const tabsRef = useRef(null);
  const isDraggingTabs = useRef(false);
  const hasMovedTabs = useRef(false);
  const startXTabs = useRef(0);
  const scrollLeftTabs = useRef(0);
  const TAB_DRAG_THRESHOLD = 5;

  const handleTabsMouseDown = useCallback((e) => {
    if (!tabsRef.current) return;
    isDraggingTabs.current = true;
    hasMovedTabs.current = false;
    startXTabs.current = e.pageX - tabsRef.current.offsetLeft;
    scrollLeftTabs.current = tabsRef.current.scrollLeft;
  }, []);

  const handleTabsMouseMove = useCallback((e) => {
    if (!isDraggingTabs.current || !tabsRef.current) return;
    const x = e.pageX - tabsRef.current.offsetLeft;
    const diff = Math.abs(x - startXTabs.current);

    if (diff > TAB_DRAG_THRESHOLD) {
      hasMovedTabs.current = true;
      e.preventDefault();
      tabsRef.current.style.cursor = "grabbing";
      const walk = (x - startXTabs.current) * 1.5;
      tabsRef.current.scrollLeft = scrollLeftTabs.current - walk;
    }
  }, []);

  const handleTabsMouseUp = useCallback(() => {
    isDraggingTabs.current = false;
    if (tabsRef.current) tabsRef.current.style.cursor = "grab";
  }, []);

  const handleTabsMouseLeave = useCallback(() => {
    isDraggingTabs.current = false;
    if (tabsRef.current) tabsRef.current.style.cursor = "grab";
  }, []);

  // ===== ДАННЫЕ =====

  const getList = () => {
    switch (activeTab) {
      case "liked":
        return likedSongs;
      case "hidden":
        return dislikedSongs;
      default:
        return [];
    }
  };

  const tabs = MUSIC_TABS;

  const list = getList();
  const tabCfg = tabs.find((t) => t.id === activeTab);

  // ===== ЛОАДЕР =====

  if (loading) {
    return (
      <Page>
        <Center>
          <Spinner />
        </Center>
      </Page>
    );
  }

  // ===== РЕНДЕР =====

  return (
    <Page>
      {/* HEADER */}
      <Header>
        <HeaderRow>
          <HeaderLeft>
            <BackBtn onClick={() => navigate("/")} aria-label="На главную">
              <FaChevronLeft />
            </BackBtn>
          </HeaderLeft>
          <HeaderTitle>Профиль</HeaderTitle>
          <GearBtn onClick={() => setShowSettings(true)}>
            <FaCog />
          </GearBtn>
        </HeaderRow>
      </Header>

      {/* ПРОФИЛЬ */}
      <ProfileCard>
        <Avatar>
          {(() => {
            if (avatarFailed) return null;
            const raw =
              user?.photoUrl ||
              user?.photo_url ||
              authUser?.photoUrl ||
              authUser?.photo_url ||
              null;
            if (!raw) return null;
            const url = String(raw);
            if (/^https?:\/\/t\.me\/i\/userpic\//i.test(url)) return null;
            return url;
          })() ? (
            <AvatarButton
              type="button"
              onClick={openAvatarPicker}
              disabled={avatarUploading}
              aria-label="Изменить аватар"
            >
              <AvatarImg
                src={String(
                  user?.photoUrl ||
                  user?.photo_url ||
                  authUser?.photoUrl ||
                  authUser?.photo_url,
                )}
                alt=""
                onError={() => setAvatarFailed(true)}
              />
            </AvatarButton>
          ) : (
            <AvatarButton
              type="button"
              onClick={openAvatarPicker}
              disabled={avatarUploading}
              aria-label="Изменить аватар"
            >
              👤
            </AvatarButton>
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={onAvatarFileSelected}
          />
        </Avatar>
        <UserName>
          {settings.display_name || user?.username || "Пользователь"}
        </UserName>
        <UserMeta>
          <MetaItem>
            <FaHeart size={12} /> {likedSongs.length}
          </MetaItem>
        </UserMeta>
      </ProfileCard>

      {/* ТАБЫ с drag-scroll */}
      <TabsRow
        ref={tabsRef}
        onMouseDown={handleTabsMouseDown}
        onMouseMove={handleTabsMouseMove}
        onMouseUp={handleTabsMouseUp}
        onMouseLeave={handleTabsMouseLeave}
      >
        {tabs.map((tab) => (
          <TabBtn
            key={tab.id}
            $active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            <tab.icon size={12} />
            <TabLabel>{tab.label}</TabLabel>
            {((tab.id === "liked" && likedSongs.length > 0) ||
              (tab.id === "playlists" && playlists.length > 0) ||
              (tab.id === "hidden" && dislikedSongs.length > 0)) && (
                <Badge $active={activeTab === tab.id}>
                  {tab.id === "liked"
                    ? likedSongs.length
                    : tab.id === "playlists"
                      ? playlists.length
                      : dislikedSongs.length}
                </Badge>
              )}
          </TabBtn>
        ))}
      </TabsRow>

      {/* КОНТЕНТ */}
      <ContentWrapper>
        <Content>
          {activeTab === "playlists" ? (
            /* === ВКЛАДКА ПЛЕЙЛИСТОВ === */
            <PlaylistsContent>
              <PlaylistsHeader>
                <ListTitle>
                  {playlists.length}{" "}
                  {playlists.length === 1 ? "плейлист" : "плейлистов"}
                </ListTitle>
                <CreatePlaylistBtn
                  onClick={() => {
                    setShowCreatePlaylist(true);
                    setPlaylistForm({ name: "", description: "" });
                  }}
                >
                  <FaPlus size={12} /> Создать
                </CreatePlaylistBtn>
              </PlaylistsHeader>

              {playlistsLoading ? (
                <Center>
                  <Spinner />
                </Center>
              ) : playlists.length === 0 ? (
                <Empty>
                  <EmptyIcon>📚</EmptyIcon>
                  <EmptyText>Создайте свой первый плейлист</EmptyText>
                  <CreatePlaylistBtn
                    onClick={() => setShowCreatePlaylist(true)}
                  >
                    <FaPlus size={12} /> Создать плейлист
                  </CreatePlaylistBtn>
                </Empty>
              ) : (
                <PlaylistsGrid>
                  {playlists.map((playlist) => (
                    <PlaylistCard key={playlist.id}>
                      <PlaylistCover
                        onClick={() => navigate(`/playlist/${playlist.id}`)}
                      >
                        {(() => {
                          const coverPath =
                            playlist.cover_path ||
                            playlist.preview_covers?.[0]?.cover_path;
                          const coverUrl = coverPath
                            ? apiClient.getCoverUrl(
                              {
                                id: playlist.id,
                                cover_path: coverPath,
                                updated_at: playlist.updated_at,
                              },
                              true,
                            )
                            : null;
                          return coverUrl ? (
                            <img src={coverUrl} alt="" />
                          ) : (
                            <PlaylistCoverPlaceholder>
                              <FaMusic size={24} />
                            </PlaylistCoverPlaceholder>
                          );
                        })()}
                        <PlaylistPlayBtn>
                          <FaPlay size={12} />
                        </PlaylistPlayBtn>
                      </PlaylistCover>
                      <PlaylistInfo>
                        <PlaylistName
                          onClick={() => navigate(`/playlist/${playlist.id}`)}
                        >
                          {playlist.name}
                        </PlaylistName>
                        <PlaylistMeta>
                          <FaGlobe size={10} />
                          <span>{getPlaylistTrackCount(playlist)} треков</span>
                        </PlaylistMeta>
                      </PlaylistInfo>
                      <PlaylistMenuBtn
                        onClick={() =>
                          setPlaylistMenuOpen(
                            playlistMenuOpen === playlist.id
                              ? null
                              : playlist.id,
                          )
                        }
                      >
                        <FaEllipsisV size={14} />
                      </PlaylistMenuBtn>

                      <AnimatePresence>
                        {playlistMenuOpen === playlist.id && (
                          <PlaylistMenu
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                          >
                            <PlaylistMenuItem
                              onClick={() => openEditPlaylist(playlist)}
                            >
                              <FaEdit size={12} /> Редактировать
                            </PlaylistMenuItem>
                            <PlaylistMenuItem
                              onClick={() => handleCopyPlaylistLink(playlist)}
                            >
                              <FaLink size={12} /> Копировать ссылку
                            </PlaylistMenuItem>
                            <PlaylistMenuItem
                              $danger
                              onClick={() => handleDeletePlaylist(playlist.id)}
                            >
                              <FaTrash size={12} /> Удалить
                            </PlaylistMenuItem>
                          </PlaylistMenu>
                        )}
                      </AnimatePresence>
                    </PlaylistCard>
                  ))}
                </PlaylistsGrid>
              )}
            </PlaylistsContent>
          ) : list.length === 0 ? (
            <Empty>
              <EmptyIcon>{tabCfg?.emptyIcon}</EmptyIcon>
              <EmptyText>{tabCfg?.emptyText}</EmptyText>
            </Empty>
          ) : (
            <>
              <ListHeader>
                <ListTitle>
                  {list.length} {list.length === 1 ? "трек" : "треков"}
                </ListTitle>
                <PlayAllBtn onClick={playAll}>
                  <FaPlay size={10} /> Играть
                </PlayAllBtn>
              </ListHeader>
              {activeTab === "liked" && (
                <OfflineActionsWrap>
                  <LikedOfflineButton
                    tracks={likedSongs}
                    coverUrlBuilder={(t) => apiClient.getCoverUrl(t) || ""}
                  />
                </OfflineActionsWrap>
              )}
              <Tracks>
                {list.map((song, i) => (
                  <Track
                    key={song.id}
                    $active={
                      String(player.currentTrack?.id ?? "") ===
                      String(song?.id ?? "")
                    }
                    onClick={() => playTrack(list, song)}
                  >
                    <TrackNum>{i + 1}</TrackNum>
                    <TrackCover>
                      <img
                        src={apiClient.getCoverUrl(song)}
                        alt=""
                        onError={(e) => (e.target.style.display = "none")}
                      />
                    </TrackCover>
                    <TrackMeta>
                      <TrackName>
                        {song.title || "Без названия"}
                        {activeTab === "liked" && (
                          <span
                            style={{ marginLeft: 8, verticalAlign: "middle" }}
                          >
                            <OfflineTrackBadge trackId={song.id} compact />
                          </span>
                        )}
                      </TrackName>
                      <TrackArtist role="link" tabIndex={0}>
                        <ArtistLinks
                          value={song.artist}
                          onNavigate={(name) => {
                            void resolveArtistPath(apiClient, name)
                              .then((path) => {
                                if (path) navigate(path);
                              })
                              .catch(() => { });
                          }}
                        />
                      </TrackArtist>
                    </TrackMeta>
                    <TrackBtn
                      type="button"
                      $kind={activeTab === "hidden" ? "hidden" : "liked"}
                      onClick={(e) => {
                        e.stopPropagation();
                        activeTab === "hidden"
                          ? toggleDislike(song)
                          : toggleLike(song);
                      }}
                      aria-label={
                        activeTab === "hidden"
                          ? "Убрать из скрытых"
                          : "Убрать из понравившихся"
                      }
                    >
                      {activeTab === "liked" && <FaHeart />}
                      {activeTab === "hidden" && <FaTimes />}
                    </TrackBtn>
                  </Track>
                ))}
              </Tracks>
            </>
          )}
        </Content>
      </ContentWrapper>

      {/* МОДАЛКА НАСТРОЕК */}
      <AnimatePresence>
        {showSettings && (
          <>
            <Overlay
              as={motion.div}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
            />
            <Modal
              as={motion.div}
              $mobile={isMobile}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              <ModalHeader>
                <ModalTitle>Настройки</ModalTitle>
                <CloseBtn onClick={() => setShowSettings(false)}>
                  <FaTimes />
                </CloseBtn>
              </ModalHeader>

              <ModalTabs>
                {SETTINGS_TABS.map((t) => (
                  <ModalTab
                    key={t.id}
                    $active={settingsTab === t.id}
                    onClick={() => setSettingsTab(t.id)}
                  >
                    <t.icon size={14} />
                    <span>{t.label}</span>
                  </ModalTab>
                ))}
              </ModalTabs>

              <ModalBody>
                {settingsTab === "profile" && (
                  <Section>
                    <Field>
                      <Label>Email</Label>
                      <Value>{user?.email || "—"}</Value>
                    </Field>
                    <Field>
                      <Label>Отображаемое имя</Label>
                      <Input
                        value={settings.display_name || ""}
                        placeholder="Введите имя"
                        onChange={(e) =>
                          setSettings((p) => ({
                            ...p,
                            display_name: e.target.value,
                          }))
                        }
                        onBlur={() =>
                          saveSettings({ display_name: settings.display_name })
                        }
                      />
                    </Field>

                    <Field>
                      <Label>Аватар</Label>
                      <UploadHintBtn
                        type="button"
                        onClick={openAvatarPicker}
                        disabled={avatarUploading}
                      >
                        {avatarUploading
                          ? `Загрузка ${Math.round(avatarUploadProgress)}%`
                          : "Изменить аватар"}
                      </UploadHintBtn>
                    </Field>

                    <SectionTitle style={{ marginTop: 24 }}>
                      Статистика
                    </SectionTitle>
                    <Stats>
                      <Stat>
                        <StatNum>{stats?.songs_uploaded || 0}</StatNum>
                        <StatLabel>Загружено</StatLabel>
                      </Stat>
                      <Stat>
                        <StatNum>{stats?.likes_count || 0}</StatNum>
                        <StatLabel>Лайков</StatLabel>
                      </Stat>
                      <Stat>
                        <StatNum>{stats?.tracks_listened || 0}</StatNum>
                        <StatLabel>Прослушано</StatLabel>
                      </Stat>
                      <Stat>
                        <StatNum>
                          {formatTime(stats?.total_listening_time)}
                        </StatNum>
                        <StatLabel>Время</StatLabel>
                      </Stat>
                    </Stats>

                    <SectionTitle style={{ marginTop: 24 }}>
                      Mini bar
                    </SectionTitle>
                    <MiniBarVariantPicker />

                    <LogoutButton onClick={handleLogout}>
                      <FaSignOutAlt /> Выйти
                    </LogoutButton>
                  </Section>
                )}

                {settingsTab === "audio" && (
                  <Section>
                    <SectionTitle>
                      Звук{" "}
                      {saved && (
                        <SavedTag>
                          <FaCheck size={10} /> Сохранено
                        </SavedTag>
                      )}
                    </SectionTitle>

                    <Row>
                      <RowInfo>
                        <RowName>Качество</RowName>
                      </RowInfo>
                      <Select
                        value={settings.audio_quality}
                        onChange={(e) =>
                          handleSetting("audio_quality", e.target.value)
                        }
                      >
                        {AUDIO_QUALITY.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Row>

                    <Row>
                      <RowInfo>
                        <RowName>Нормализация</RowName>
                        <RowDesc>Выравнивает громкость</RowDesc>
                      </RowInfo>
                      <Toggle
                        $on={settings.normalize_volume}
                        onClick={() =>
                          handleSetting(
                            "normalize_volume",
                            !settings.normalize_volume,
                          )
                        }
                      >
                        <ToggleKnob $on={settings.normalize_volume} />
                      </Toggle>
                    </Row>

                    <Row>
                      <RowInfo>
                        <RowName>Автовоспроизведение</RowName>
                        <RowDesc>Следующий трек после окончания</RowDesc>
                      </RowInfo>
                      <Toggle
                        $on={settings.autoplay_enabled}
                        onClick={() =>
                          handleSetting(
                            "autoplay_enabled",
                            !settings.autoplay_enabled,
                          )
                        }
                      >
                        <ToggleKnob $on={settings.autoplay_enabled} />
                      </Toggle>
                    </Row>

                    <Row>
                      <RowInfo>
                        <RowName>
                          Кроссфейд: {settings.crossfade_seconds}с
                        </RowName>
                        <RowDesc>Плавный переход</RowDesc>
                      </RowInfo>
                      <Range
                        type="range"
                        id="settings-crossfade"
                        name="settings-crossfade"
                        min="0"
                        max="12"
                        value={settings.crossfade_seconds}
                        onChange={(e) =>
                          handleSetting("crossfade_seconds", +e.target.value)
                        }
                      />
                    </Row>

                    <SectionTitle style={{ marginTop: 24 }}>
                      Приватность
                    </SectionTitle>

                    <Row>
                      <RowInfo>
                        <RowName>История</RowName>
                        <RowDesc>Для рекомендаций</RowDesc>
                      </RowInfo>
                      <Toggle
                        $on={settings.listening_history_enabled}
                        onClick={() =>
                          handleSetting(
                            "listening_history_enabled",
                            !settings.listening_history_enabled,
                          )
                        }
                      >
                        <ToggleKnob $on={settings.listening_history_enabled} />
                      </Toggle>
                    </Row>

                    <Row>
                      <RowInfo>
                        <RowName>Активность</RowName>
                        <RowDesc>Видят другие</RowDesc>
                      </RowInfo>
                      <Toggle
                        $on={settings.show_activity}
                        onClick={() =>
                          handleSetting(
                            "show_activity",
                            !settings.show_activity,
                          )
                        }
                      >
                        <ToggleKnob $on={settings.show_activity} />
                      </Toggle>
                    </Row>
                  </Section>
                )}

                {DEVICE_SYNC_ENABLED && settingsTab === "devices" && (
                  <Section>
                    <DeviceSyncSection />
                  </Section>
                )}

                {settingsTab === "sessions" && (
                  <Section>
                    <SectionTitle>Активные сеансы</SectionTitle>
                    <ActiveSessionsSection />
                  </Section>
                )}
              </ModalBody>
            </Modal>
          </>
        )}
      </AnimatePresence>

      {/* МОДАЛКА СОЗДАНИЯ/РЕДАКТИРОВАНИЯ ПЛЕЙЛИСТА */}
      <AnimatePresence>
        {(showCreatePlaylist || editingPlaylist) && (
          <>
            <Overlay
              as={motion.div}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShowCreatePlaylist(false);
                setEditingPlaylist(null);
              }}
            />
            <PlaylistModal
              as={motion.div}
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              <ModalHeader>
                <ModalTitle>
                  {editingPlaylist ? "Редактировать" : "Создать"} плейлист
                </ModalTitle>
                <CloseBtn
                  onClick={() => {
                    setShowCreatePlaylist(false);
                    setEditingPlaylist(null);
                    setPlaylistForm({ name: "", description: "" });
                  }}
                >
                  <FaTimes />
                </CloseBtn>
              </ModalHeader>

              <ModalBody>
                <Field>
                  <Label>Название *</Label>
                  <Input
                    value={playlistForm.name}
                    placeholder="Мой плейлист"
                    onChange={(e) =>
                      setPlaylistForm((p) => ({ ...p, name: e.target.value }))
                    }
                    autoFocus
                  />
                </Field>
                <Field>
                  <Label>Описание</Label>
                  <TextArea
                    value={playlistForm.description}
                    placeholder="Добавьте описание (необязательно)"
                    onChange={(e) =>
                      setPlaylistForm((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                    rows={3}
                  />
                </Field>
                <PlaylistModalActions>
                  <CancelBtn
                    onClick={() => {
                      setShowCreatePlaylist(false);
                      setEditingPlaylist(null);
                      setPlaylistForm({ name: "", description: "" });
                    }}
                  >
                    Отмена
                  </CancelBtn>
                  <SubmitBtn
                    onClick={
                      editingPlaylist
                        ? handleUpdatePlaylist
                        : handleCreatePlaylist
                    }
                    disabled={!playlistForm.name.trim()}
                  >
                    {editingPlaylist ? "Сохранить" : "Создать"}
                  </SubmitBtn>
                </PlaylistModalActions>
              </ModalBody>
            </PlaylistModal>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showLogoutConfirm && (
          <LogoutConfirmOverlay
            as={motion.div}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={closeLogoutConfirm}
            role="presentation"
          >
            <LogoutConfirmCard
              as={motion.div}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="logout-confirm-title"
              aria-describedby="logout-confirm-desc"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ type: "spring", damping: 26, stiffness: 280 }}
              onClick={(event) => event.stopPropagation()}
            >
              <LogoutIconCircle aria-hidden="true">
                <FaSignOutAlt />
              </LogoutIconCircle>
              <LogoutConfirmTitle id="logout-confirm-title">
                Выйти из аккаунта?
              </LogoutConfirmTitle>
              <LogoutConfirmDesc id="logout-confirm-desc">
                Сессия будет завершена на этом устройстве. Загруженные
                офлайн-треки и локальные настройки сохранятся.
              </LogoutConfirmDesc>
              <LogoutConfirmActions>
                <LogoutConfirmCancelBtn
                  type="button"
                  onClick={closeLogoutConfirm}
                  disabled={logoutInFlight}
                  autoFocus
                >
                  Остаться
                </LogoutConfirmCancelBtn>
                <LogoutConfirmPrimaryBtn
                  type="button"
                  onClick={confirmLogout}
                  disabled={logoutInFlight}
                  aria-busy={logoutInFlight ? "true" : "false"}
                >
                  {logoutInFlight ? "Выходим…" : "Выйти"}
                </LogoutConfirmPrimaryBtn>
              </LogoutConfirmActions>
            </LogoutConfirmCard>
          </LogoutConfirmOverlay>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toastMessage && (
          <Toast
            as={motion.div}
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
          >
            {toastMessage}
          </Toast>
        )}
      </AnimatePresence>
    </Page>
  );
};

// ============ СТИЛИ ============

const spin = keyframes`to { transform: rotate(360deg); }`;

const Page = styled.div`
  min-height: 0;
  background: var(--ef-surface-main, #0d0d0d);
  padding-bottom: 28px;
  font-family: "Unbounded", sans-serif;
  -webkit-overflow-scrolling: touch;

  @media (min-width: 768px) {
    padding-bottom: 36px;
  }
`;

const Center = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: calc(var(--app-vh, 1vh) * 100);
`;

const Spinner = styled.div`
  width: 36px;
  height: 36px;
  border: 3px solid rgba(255, 255, 255, 0.1);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
`;

// Header
const Header = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 1200;
  background: rgba(0, 0, 0, 0.74);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: env(safe-area-inset-top, 0px);
`;

const HeaderRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  height: 56px;
  padding: 0 16px;
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  gap: 16px;
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const BackBtn = styled.button`
  width: 42px;
  height: 42px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.13);
    border-color: rgba(255, 255, 255, 0.26);
  }

  &:active {
    transform: scale(0.97);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.62);
    outline-offset: 2px;
  }
`;

const HeaderTitle = styled.h1`
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  margin: 0;
`;

const GearBtn = styled.button`
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #fff;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
  justify-self: end;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.13);
    border-color: rgba(255, 255, 255, 0.26);
  }

  &:active {
    transform: scale(0.97);
  }
`;

// Profile Card
const ProfileCard = styled.div`
  padding: calc(64px + env(safe-area-inset-top, 0px)) 16px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  max-width: 980px;
  margin: 0 auto;

  @media (min-width: 768px) {
    padding: calc(90px + env(safe-area-inset-top, 0px)) 20px 20px;
  }
`;

const Avatar = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  overflow: hidden;
  margin-bottom: 10px;

  @media (min-width: 768px) {
    width: 90px;
    height: 90px;
    font-size: 30px;
    margin-bottom: 14px;
  }
`;

const AvatarButton = styled.button`
  width: 100%;
  height: 100%;
  border: none;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:disabled {
    cursor: default;
    opacity: 0.8;
  }
`;

const AvatarImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const UserName = styled.h2`
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 6px;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 16px;

  @media (min-width: 768px) {
    font-size: 16px;
    margin: 0 0 8px;
  }
`;

const UserMeta = styled.div`
  display: flex;
  gap: 16px;
`;

const MetaItem = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;

  @media (min-width: 768px) {
    font-size: 13px;
  }
`;

// Tabs - горизонтальный drag-scroll
const TabsRow = styled.div`
  display: flex;
  gap: 6px;
  padding: 0 12px 12px;
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;

  &::-webkit-scrollbar {
    display: none;
  }

  &:active {
    cursor: grabbing;
  }

  @media (min-width: 768px) {
    padding: 0 16px 12px;
    gap: 8px;
  }
`;

const TabBtn = styled.button`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 12px;
  background: ${(p) => (p.$active ? "#fff" : "rgba(255,255,255,0.08)")};
  border: 1px solid ${(p) => (p.$active ? "#fff" : "rgba(255,255,255,0.1)")};
  border-radius: 16px;
  color: ${(p) => (p.$active ? "#000" : "rgba(255,255,255,0.6)")};
  font-size: 11px;
  font-weight: ${(p) => (p.$active ? 600 : 500)};
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  -webkit-tap-highlight-color: transparent;
  white-space: nowrap;

  &:active {
    transform: scale(0.96);
  }

  @media (min-width: 768px) {
    gap: 5px;
    padding: 10px 14px;
    font-size: 12px;
    border-radius: 18px;
  }
`;

const TabLabel = styled.span`
  display: inline;
`;

const Badge = styled.span`
  background: ${(p) =>
    p.$active ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.15)"};
  padding: 3px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  min-width: 20px;
  text-align: center;
`;

// ContentWrapper - простой контейнер для контента
const ContentWrapper = styled.div`
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
`;

// Content
const Content = styled.div`
  padding: 0 12px;
  width: 100%;
  max-width: 980px;
  margin: 0 auto;

  @media (min-width: 768px) {
    padding: 0 20px;
  }
`;

const Empty = styled.div`
  text-align: center;
  padding: 40px 16px;

  @media (min-width: 768px) {
    padding: 60px 20px;
  }
`;

const EmptyIcon = styled.div`
  font-size: 28px;
  margin-bottom: 8px;

  @media (min-width: 768px) {
    font-size: 32px;
    margin-bottom: 12px;
  }
`;

const EmptyText = styled.p`
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  margin: 0;
`;

const ListHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const ListTitle = styled.div`
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
`;

const PlayAllBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #fff;
  padding: 8px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
`;

const OfflineActionsWrap = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  max-width: 100%;
  overflow: visible;
  flex-wrap: wrap;
  gap: 8px;
`;

const Tracks = styled.div`
  display: flex;
  flex-direction: column;
`;

const Track = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  margin: 0 -8px;
  border-radius: 10px;
  background: ${(p) => (p.$active ? "rgba(255,255,255,0.08)" : "transparent")};
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s ease;

  &:active {
    background: rgba(255, 255, 255, 0.1);
  }

  @media (min-width: 768px) {
    gap: 12px;
    padding: 10px;
    margin: 0 -10px;
    &:hover {
      background: rgba(255, 255, 255, 0.05);
    }
  }
`;

const TrackNum = styled.div`
  width: 18px;
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  flex-shrink: 0;

  @media (min-width: 768px) {
    width: 24px;
    font-size: 12px;
  }
`;

const TrackCover = styled.div`
  width: 40px;
  height: 50px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  flex-shrink: 0;
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  @media (min-width: 768px) {
    width: 48px;
    height: 60px;
    border-radius: 6px;
  }
`;

const TrackMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

const TrackName = styled.div`
  color: #fff;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;

  @media (min-width: 768px) {
    font-size: 13px;
  }
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TrackArtist = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-weight: 300;
  margin-top: 2px;
`;

const TrackBtn = styled.button`
  width: 34px;
  height: 34px;
  min-width: 34px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.03);
  border: none;
  color: ${(p) => (p.$kind === "liked" ? "#fff" : "rgba(255,255,255,0.72)")};
  font-size: 14px;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background 0.15s ease,
    transform 0.15s ease,
    color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &:active {
    transform: scale(0.94);
  }
`;

// Modal
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 10049;
`;

const Modal = styled.div`
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: ${(p) => (p.$mobile ? "100%" : "420px")};
  background: #0a0a0a;
  z-index: 10050;
  display: flex;
  flex-direction: column;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

const ModalTitle = styled.h2`
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  margin: 0;
`;

const CloseBtn = styled.button`
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: #fff;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

const ModalTabs = styled.div`
  display: flex;
  gap: 4px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

const ModalTab = styled.button`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 9px;
  border: none;
  border-radius: 8px;
  background: ${(p) => (p.$active ? "rgba(255,255,255,0.1)" : "transparent")};
  color: ${(p) => (p.$active ? "#fff" : "rgba(255,255,255,0.5)")};
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  span {
    display: none;
  }
  @media (min-width: 360px) {
    span {
      display: inline;
    }
  }
`;

const ModalBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  padding: 16px;
  /* Keep the bottom actions (Logout, etc.) above MobileBottomNav + MiniBar. */
  padding-bottom: calc(var(--player-bar-height-safe, 0px) + 36px);

  @media (min-width: 768px) {
    padding: 20px;
    padding-bottom: 20px;
  }
`;

const Section = styled.div``;

const SectionTitle = styled.h3`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 14px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SavedTag = styled.span`
  font-size: 11px;
  color: #32d74b;
  font-weight: 400;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const Field = styled.div`
  margin-bottom: 14px;
`;

const Label = styled.label`
  display: block;
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  margin-bottom: 5px;
`;

const Value = styled.div`
  color: #fff;
  font-size: 14px;
`;

const Input = styled.input`
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 11px 12px;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.25);
  }
  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }
`;

const Stats = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 20px;

  @media (min-width: 400px) {
    grid-template-columns: repeat(4, 1fr);
  }
`;

const Stat = styled.div`
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 12px 6px;
  text-align: center;
`;

const StatNum = styled.div`
  color: #fff;
  font-size: 15px;
  font-weight: 700;
`;

const StatLabel = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  margin-top: 3px;
`;

const LogoutButton = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 13px;
  background: rgba(255, 59, 48, 0.1);
  border: 1px solid rgba(255, 59, 48, 0.2);
  border-radius: 12px;
  color: #ff3b30;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  margin-top: 16px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  &:last-child {
    border-bottom: none;
  }
`;

const RowInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const RowName = styled.div`
  color: #fff;
  font-size: 14px;
`;

const RowDesc = styled.div`
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  margin-top: 2px;
`;

const Select = styled.select`
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 7px 10px;
  color: #fff;
  font-size: 12px;
  font-family: inherit;
  option {
    background: #1a1a1a;
  }
`;

const Toggle = styled.div`
  width: 46px;
  height: 26px;
  border-radius: 13px;
  background: ${(p) => (p.$on ? "#fff" : "rgba(255,255,255,0.15)")};
  cursor: pointer;
  position: relative;
  flex-shrink: 0;
  transition: background 0.2s;
`;

const ToggleKnob = styled.div`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: ${(p) => (p.$on ? "#000" : "#fff")};
  position: absolute;
  top: 2px;
  left: ${(p) => (p.$on ? "22px" : "2px")};
  transition:
    left 0.2s,
    background 0.2s;
`;

const Range = styled.input`
  width: 90px;
  accent-color: #fff;
`;

const UploadHintBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin: 20px auto 0;
  padding: 14px 28px;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.06) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 14px;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.25s ease;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);

  svg {
    font-size: 16px;
  }

  &:hover {
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.18) 0%,
      rgba(255, 255, 255, 0.1) 100%
    );
    border-color: rgba(255, 255, 255, 0.3);
    filter: brightness(1.05);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }

  &:active {
    transform: translateY(0);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
`;

// ============ СТИЛИ ПЛЕЙЛИСТОВ ============

const PlaylistsContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const PlaylistsHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const CreatePlaylistBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 20px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.3);
  }
`;

const PlaylistsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;

  @media (min-width: 480px) {
    grid-template-columns: repeat(3, 1fr);
  }

  @media (min-width: 768px) {
    grid-template-columns: repeat(4, 1fr);
  }
`;

const PlaylistCard = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const PlaylistCover = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`;

const PlaylistCoverPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.1) 0%,
    rgba(255, 255, 255, 0.05) 100%
  );
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.3);
`;

const PlaylistPlayBtn = styled.div`
  position: absolute;
  bottom: 8px;
  right: 8px;
  width: 34px;
  height: 34px;
  background: #fff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #000;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);

  ${PlaylistCover}:hover & {
    opacity: 1;
  }
`;

const PlaylistInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const PlaylistName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

const PlaylistMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
`;

const PlaylistMenuBtn = styled.button`
  position: absolute;
  top: 12px;
  right: 12px;
  width: 28px;
  height: 28px;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 50%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;

  ${PlaylistCard}:hover & {
    opacity: 1;
  }
`;

const PlaylistMenu = styled(motion.div)`
  position: absolute;
  top: 44px;
  right: 8px;
  background: rgba(30, 30, 30, 0.98);
  border-radius: 10px;
  padding: 6px 0;
  min-width: 150px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 180px);
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  z-index: 50;
  backdrop-filter: blur(20px);
`;

const PlaylistMenuItem = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: transparent;
  border: none;
  color: ${(props) => (props.$danger ? "#ff4757" : "rgba(255, 255, 255, 0.8)")};
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s;
  text-align: left;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const PlaylistModal = styled.div`
  position: fixed;
  /* Учитываем высоту плеер-бара + safe-area */
  bottom: var(
    --player-bar-height-safe,
    calc(72px + env(safe-area-inset-bottom, 0px))
  );
  left: 0;
  right: 0;
  background: #1a1a1a;
  border-radius: 20px 20px 0 0;
  z-index: 12000;
  max-height: 70vh;
  overflow-y: auto;
  /* GPU acceleration для плавности */
  transform: translateZ(0);
  will-change: transform;

  @media (min-width: 768px) {
    /* На десктопе плеер-бар выше (90px) */
    bottom: calc(90px + env(safe-area-inset-bottom, 0px));
    max-height: 75vh;
  }
`;

const PlaylistModalActions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 20px;
`;

const CancelBtn = styled.button`
  flex: 1;
  padding: 13px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.15);
  }
`;

const SubmitBtn = styled.button`
  flex: 1;
  padding: 13px;
  background: #fff;
  border: none;
  border-radius: 12px;
  color: #000;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 0.2s;
  &:hover {
    opacity: 0.9;
  }
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const TextArea = styled.textarea`
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 12px;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 80px;

  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.3);
  }
`;

const Toast = styled.div`
  position: fixed;
  bottom: calc(160px + env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  background: rgba(40, 40, 40, 0.95);
  backdrop-filter: blur(10px);
  padding: 12px 24px;
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  z-index: 9999;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);

  @media (min-width: 768px) {
    bottom: calc(120px + env(safe-area-inset-bottom, 0px));
  }
`;

// ============ СТИЛИ ПОДТВЕРЖДЕНИЯ ВЫХОДА ============
// Визуально совпадает со стилистикой Earflow: глассморфизм, Unbounded,
// закруглённая карточка, кнопки в духе других модалок профиля.

const LogoutConfirmOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 13000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(16px + env(safe-area-inset-top, 0px))
    calc(16px + env(safe-area-inset-right, 0px))
    calc(112px + env(safe-area-inset-bottom, 0px))
    calc(16px + env(safe-area-inset-left, 0px));
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;

  @media (max-width: 480px) {
    padding: calc(14px + env(safe-area-inset-top, 0px))
      calc(12px + env(safe-area-inset-right, 0px))
      calc(118px + env(safe-area-inset-bottom, 0px))
      calc(12px + env(safe-area-inset-left, 0px));
  }
`;

const LogoutConfirmCard = styled.div`
  position: relative;
  width: min(420px, 100%);
  max-height: min(
    520px,
    calc(
      100dvh -
        152px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
    )
  );
  padding: 28px 24px 22px;
  border-radius: 24px;
  background: linear-gradient(
    135deg,
    rgba(28, 28, 28, 0.96) 0%,
    rgba(18, 18, 18, 0.98) 55%,
    rgba(12, 12, 12, 0.96) 100%
  );
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow:
    0 30px 80px rgba(0, 0, 0, 0.7),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  z-index: 13001;
  color: #fff;
  font-family: "Unbounded", sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  @media (max-width: 480px) {
    width: 100%;
    max-height: calc(
      100dvh -
        156px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
    );
    padding: 22px 18px 18px;
    border-radius: 22px;
  }

  @media (max-width: 480px) and (max-height: 620px) {
    max-height: calc(
      100dvh -
        118px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px)
    );
    padding: 18px 16px 16px;
  }
`;

const LogoutIconCircle = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(255, 59, 48, 0.16);
  border: 1px solid rgba(255, 59, 48, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ff3b30;
  font-size: 22px;
  margin-bottom: 14px;
  box-shadow: 0 6px 18px rgba(255, 59, 48, 0.18);
`;

const LogoutConfirmTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
  color: rgba(255, 255, 255, 0.95);

  @media (min-width: 768px) {
    font-size: 16px;
  }
`;

const LogoutConfirmDesc = styled.p`
  margin: 10px 0 22px;
  font-size: 13px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.6);
  max-width: 320px;

  @media (min-width: 768px) {
    font-size: 14px;
  }
`;

const LogoutConfirmActions = styled.div`
  display: flex;
  gap: 10px;
  width: 100%;
`;

const LogoutConfirmCancelBtn = styled.button`
  flex: 1;
  padding: 13px 18px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s,
    transform 0.08s;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.18);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`;

const LogoutConfirmPrimaryBtn = styled.button`
  flex: 1;
  padding: 13px 18px;
  background: linear-gradient(
    135deg,
    rgba(255, 59, 48, 0.92),
    rgba(200, 40, 32, 0.92)
  );
  border: 1px solid rgba(255, 59, 48, 0.4);
  border-radius: 12px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  box-shadow: 0 10px 22px rgba(255, 59, 48, 0.28);
  transition:
    transform 0.08s,
    box-shadow 0.2s,
    filter 0.2s;

  &:hover:not(:disabled) {
    filter: brightness(1.05);
    box-shadow: 0 14px 26px rgba(255, 59, 48, 0.34);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.75;
    cursor: progress;
    filter: grayscale(0.1);
  }
`;

export default ProfilePage;
