import React, { memo } from "react";
import styled from "styled-components";
import { FaPlay, FaMusic } from "react-icons/fa";

const Card = styled.div`
  position: relative;
  cursor: pointer;
  transition: transform 0.2s ease;
  background: transparent;

  &:hover {
    filter: brightness(1.05);

    .card-overlay {
      opacity: 1;
    }

    .card-play-btn {
      opacity: 1;
    }
  }

  &:active {
    transform: translateY(0);
  }
`;

const CoverWrapper = styled.div`
  position: relative;
  width: 100%;
  padding-top: 125%;
  border-radius: 12px;
  overflow: hidden;
  background: #181818;
`;

const CoverImage = styled.img`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.4s ease;
`;

const FallbackCover = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #1a1a1a 0%, #0d0d0d 100%);
  color: rgba(255, 255, 255, 0.25);
  font-size: 28px;
`;

const Overlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(180deg, transparent 40%, rgba(0, 0, 0, 0.8) 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
`;

const PlayButton = styled.button`
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s ease, background 0.18s ease;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);

  svg {
    color: black;
    font-size: 14px;
    transform: translateX(1px);
  }
`;

const Info = styled.div`
  padding: 8px 0 0;
`;

const Title = styled.h3`
  font-size: 13px;
  font-weight: 500;
  font-family: "Unbounded", sans-serif;
  color: white;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PlaylistCard = memo(
  ({ playlist, onPlay, onClick, isPlaying: _isPlaying = false }) => {
    const { name, preview_covers = [] } = playlist;

    const handlePlay = (e) => {
      e.stopPropagation();
      onPlay?.(playlist);
    };

    const handleClick = () => {
      onClick?.(playlist);
    };

    const firstCover = preview_covers?.[0];
    const coverSrc = firstCover?.cover_path || null;

    return (
      <Card onClick={handleClick}>
        <CoverWrapper>
          {coverSrc ? (
            <CoverImage
              src={coverSrc}
              alt={name || ""}
              loading="lazy"
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
          ) : (
            <FallbackCover>
              <FaMusic />
            </FallbackCover>
          )}
          <Overlay className="card-overlay" />
          <PlayButton className="card-play-btn" onClick={handlePlay}>
            <FaPlay />
          </PlayButton>
        </CoverWrapper>

        <Info>
          <Title title={name}>{name}</Title>
        </Info>
      </Card>
    );
  },
);

PlaylistCard.displayName = "PlaylistCard";

export default PlaylistCard;
