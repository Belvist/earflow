import React from "react";
import styled from "styled-components";
import { FaPlay } from "react-icons/fa";
import apiClient from "../../api/client";
import CachedCoverImage from "../CachedCoverImage";

const Card = styled.button`
  width: 120px;
  flex-shrink: 0;
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-family: "Unbounded", sans-serif;
  color: #fff;
  text-align: left;
  -webkit-tap-highlight-color: transparent;

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 3px;
    border-radius: 12px;
  }

  @media (min-width: 521px) {
    width: 180px;
    gap: 10px;
  }

  @media (min-width: 1024px) {
    width: 200px;
  }

  @media (min-width: 1440px) {
    width: 220px;
  }
`;

const CoverWrap = styled.div`
  position: relative;
  width: 100%;
  padding-top: 125%;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  transition: transform 0.2s ease;

  ${Card}:hover & {
    filter: brightness(1.05);
  }

  @media (min-width: 1024px) {
    border-radius: 14px;
  }
`;

const Cover = styled.div`
  position: absolute;
  inset: 0;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const PlayBadge = styled.span`
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: #fff;
  color: #000;

  @media (min-width: 521px) {
    right: 10px;
    bottom: 10px;
    width: 46px;
    height: 46px;
  }
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transform: translateY(6px);
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
  pointer-events: none;

  ${Card}:hover & {
    opacity: 1;
    transform: translateY(0);
  }
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const TitleLine = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (min-width: 521px) {
    font-size: 14px;
  }
`;

const SubLine = styled.div`
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: capitalize;

  @media (min-width: 521px) {
    font-size: 12px;
  }
`;

const KIND_LABEL = {
  album: "Альбом",
  ep: "EP",
  single: "Сингл",
};

export default function ArtistReleaseCard({ release, onPlay, onOpen }) {
  if (
    !release ||
    !Array.isArray(release.tracks) ||
    release.tracks.length === 0
  ) {
    return null;
  }

  const coverUrl = release.coverPath
    ? apiClient.getCoverUrl({ cover_path: release.coverPath })
    : apiClient.getCoverUrl(release.tracks[0]);

  const handleClick = () => {
    if (typeof onOpen === "function") onOpen(release);
    else if (typeof onPlay === "function") onPlay(release);
  };

  const label = KIND_LABEL[release.kind] || "";
  const year = release.year ? String(release.year) : "";
  const sub = [label, year].filter(Boolean).join(" · ");

  return (
    <Card
      type="button"
      onClick={handleClick}
      aria-label={`Открыть ${release.name}`}
    >
      <CoverWrap>
        <Cover>
          {coverUrl ? (
            <CachedCoverImage src={coverUrl} alt="" />
          ) : (
            <div aria-hidden="true" />
          )}
        </Cover>
        <PlayBadge aria-hidden="true">
          <FaPlay size={14} />
        </PlayBadge>
      </CoverWrap>
      <Meta>
        <TitleLine title={release.name}>{release.name}</TitleLine>
        {sub && <SubLine>{sub}</SubLine>}
      </Meta>
    </Card>
  );
}
