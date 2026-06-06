import React, { useMemo, useState } from "react";
import styled from "styled-components";
import { FaDownload, FaCog, FaStop } from "react-icons/fa";
import { asIcon } from "../utils/tsxIcons";
import { useOffline } from "./OfflineContext";
import OfflineManagerModal from "./OfflineManagerModal";

const DownloadIcon = asIcon(FaDownload);
const CogIcon = asIcon(FaCog);
const StopIcon = asIcon(FaStop);

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  max-width: 100%;
`;

const ActionButton = styled.button<{
  $variant?: "primary" | "ghost" | "danger";
  $iconOnly?: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  padding: ${({ $iconOnly }) => ($iconOnly ? "0" : "8px 14px")};
  width: ${({ $iconOnly }) => ($iconOnly ? "34px" : "auto")};
  min-width: ${({ $iconOnly }) => ($iconOnly ? "34px" : "0")};
  border-radius: 24px;
  border: 1px solid
    ${({ $variant }) =>
      $variant === "primary"
        ? "transparent"
        : $variant === "danger"
          ? "rgba(239, 68, 68, 0.4)"
          : "rgba(255, 255, 255, 0.12)"};
  background: ${({ $variant }) =>
    $variant === "primary"
      ? "#ffffff"
      : $variant === "danger"
        ? "rgba(239, 68, 68, 0.12)"
        : "rgba(255, 255, 255, 0.04)"};
  color: ${({ $variant }) =>
    $variant === "primary"
      ? "#050505"
      : $variant === "danger"
        ? "#ef4444"
        : "var(--color-text, rgba(255, 255, 255, 0.85))"};
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: "Unbounded", sans-serif;
  white-space: nowrap;

  &:hover:not(:disabled) {
    filter: brightness(1.05);
    filter: brightness(1.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  svg {
    font-size: 12px;
  }
`;

const ProgressText = styled.span`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  margin-left: 2px;
`;

interface LikedTrackInput {
  id: string | number;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  cover_path?: string;
}

interface LikedOfflineButtonProps {
  tracks: LikedTrackInput[];
  coverUrlBuilder?: (_track: LikedTrackInput) => string;
}

/**
 * Кнопка в шапке страницы «Любимое»: скачать все лайки офлайн / управлять кешем.
 * При клике на «Сохранить офлайн» формирует очередь из всех треков, которых ещё нет в кеше.
 */
const LikedOfflineButton: React.FC<LikedOfflineButtonProps> = ({
  tracks,
  coverUrlBuilder,
}) => {
  const offline = useOffline();
  const [managerOpen, setManagerOpen] = useState(false);

  const pendingCount = useMemo(() => {
    return tracks.reduce((acc, t) => {
      const id = String(t.id);
      if (!id) return acc;
      if (offline.offlineIds.has(id)) return acc;
      return acc + 1;
    }, 0);
  }, [tracks, offline.offlineIds]);

  const isBusy = Boolean(offline.active) || offline.queue.length > 0;

  const handleDownloadAll = () => {
    const inputs = tracks
      .filter((t) => t && t.id)
      .filter((t) => !offline.offlineIds.has(String(t.id)))
      .map((t) => ({
        id: String(t.id),
        title: String(t.title || "Без названия"),
        artist: String(t.artist || "Неизвестный исполнитель"),
        album: t.album ? String(t.album) : undefined,
        durationSec: Number(t.duration) || 0,
        coverUrl: coverUrlBuilder ? coverUrlBuilder(t) : undefined,
        streamUrl: "",
      }));

    if (inputs.length === 0) return;
    void offline.ensurePersistent();
    offline.enqueue(inputs);
  };

  const activePct =
    offline.active && offline.active.total > 0
      ? Math.min(
          99,
          Math.floor((offline.active.loaded / offline.active.total) * 100),
        )
      : 0;

  return (
    <>
      <Container>
        {isBusy ? (
          <>
            <ActionButton $variant="ghost" disabled>
              <DownloadIcon />
              Скачивание
              <ProgressText>{activePct}%</ProgressText>
            </ActionButton>
            <ActionButton
              $variant="danger"
              onClick={() => offline.clearQueue()}
            >
              <StopIcon />
              Остановить
            </ActionButton>
          </>
        ) : pendingCount > 0 ? (
          <ActionButton $variant="primary" onClick={handleDownloadAll}>
            <DownloadIcon />
            Сохранить офлайн
            <ProgressText style={{ color: "rgba(0,0,0,0.55)" }}>
              ({pendingCount})
            </ProgressText>
          </ActionButton>
        ) : (
          tracks.length > 0 && (
            <ActionButton $variant="ghost" disabled>
              Все скачаны
            </ActionButton>
          )
        )}

        <ActionButton
          $variant="ghost"
          $iconOnly
          onClick={() => setManagerOpen(true)}
          title="Управление офлайн-треками"
          aria-label="Управление офлайн-треками"
        >
          <CogIcon />
        </ActionButton>
      </Container>

      <OfflineManagerModal
        isOpen={managerOpen}
        onClose={() => setManagerOpen(false)}
      />
    </>
  );
};

export default LikedOfflineButton;
