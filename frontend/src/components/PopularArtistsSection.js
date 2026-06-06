import React, { useMemo, useRef } from "react";
import { useHorizontalScrollMiniZoneGuard } from "../gestures/useMiniPlayerNativeTouchGuard";
import useRailWheelScroll from "../hooks/useRailWheelScroll";
import styled from "styled-components";
import { useNavigate } from "react-router-dom";
import apiClient from "../api/client";
import CachedCoverImage from "./CachedCoverImage";
import { buildArtistPath, resolveArtistPath } from "../utils/artistRoute";
import usePopularArtists from "../hooks/usePopularArtists";

const Section = styled.section`
  padding: ${(p) => (p.$homeDesktopAlign ? '18px 0 28px' : '22px 16px 8px')};

  @media (min-width: 768px) {
    padding: ${(p) => (p.$homeDesktopAlign ? '18px 0 28px' : '24px 24px 10px')};
  }
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
`;

const Title = styled.h2`
  font-size: 13.5px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  color: white;
  letter-spacing: 0;
  margin: 0;

  @media (min-width: 480px) {
    font-size: 14px;
  }

  @media (min-width: 1024px) {
    font-size: 15px;
  }
`;

const SeeAll = styled.button`
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.85);
  font-family: "Unbounded", sans-serif;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const Scroll = styled.div`
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding-bottom: 6px;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x pan-y;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;

  &::-webkit-scrollbar {
    height: 0;
  }

  @media (min-width: 768px) {
    gap: 18px;
  }
`;

const Card = styled.button`
  width: 108px;
  flex-shrink: 0;
  position: relative;
  cursor: pointer;
  overflow: visible;
  background: transparent;
  transition: opacity 0.2s ease;
  border: none;
  text-align: center;
  color: #fff;
  font-family: "Unbounded", sans-serif;
  padding: 0;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    opacity: 0.9;
  }

  &:active {
    transform: scale(0.98);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.34);
    outline-offset: 5px;
    border-radius: 999px;
  }

  @media (min-width: 768px) {
    width: 124px;
  }
`;

const Cover = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.34);

  img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.25s ease;
  }

  ${Card}:hover & img {
    transform: scale(1.045);
  }
`;

const Info = styled.div`
  padding: 8px 2px 0;
  min-width: 0;
  text-align: center;
`;

const Name = styled.div`
  font-size: 10px;
  font-weight: 500;
  color: #fff;
  line-height: 1.25;
  min-height: 25px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: center;

  @media (min-width: 768px) {
    font-size: 11px;
    min-height: 28px;
  }
`;

function getArtistPath(item) {
  const pid = item && item.artistPublicId ? String(item.artistPublicId) : "";
  const name = item && item.artistName ? String(item.artistName) : "";
  if (pid) {
    const path = buildArtistPath({ artistPublicId: pid, artistName: name });
    if (path) return path;
  }
  return "";
}

export default function PopularArtistsSection({
  limit = 12,
  autoLoad = true,
  homeDesktopAlign = false,
} = {}) {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  useRailWheelScroll(scrollRef);
  useHorizontalScrollMiniZoneGuard(scrollRef);
  const { items } = usePopularArtists({ limit, autoLoad });

  const visible = useMemo(
    () => (Array.isArray(items) ? items.slice(0, Math.max(1, limit)) : []),
    [items, limit],
  );

  if (!visible.length) return null;

  return (
    <Section $homeDesktopAlign={homeDesktopAlign}>
      <HeaderRow>
        <Title>Популярные артисты</Title>
        <SeeAll type="button" onClick={() => navigate("/artists/popular")}>
          Смотреть все
        </SeeAll>
      </HeaderRow>

      <Scroll ref={scrollRef}>
        {visible.map((a) => {
          const cover = a && a.coverUrl ? String(a.coverUrl) : null;
          const path = getArtistPath(a);
          const name = a && a.artistName ? String(a.artistName) : "";
          const pid = a && a.artistPublicId ? String(a.artistPublicId) : "";
          return (
            <Card
              key={`${a.artistPublicId || a.artistName}`}
              type="button"
              onClick={() => {
                if (pid && path) {
                  navigate(path);
                  return;
                }
                if (!name) return;
                void resolveArtistPath(apiClient, name)
                  .then((resolved) => {
                    if (resolved) {
                      navigate(resolved);
                      return;
                    }
                    if (path) navigate(path);
                  })
                  .catch(() => {
                    if (path) navigate(path);
                  });
              }}
            >
              <Cover>
                <CachedCoverImage
                  src={cover}
                  fallbackSrc="/logo192.svg"
                  alt=""
                />
              </Cover>
              <Info>
                <Name title={a.artistName}>{a.artistName}</Name>
              </Info>
            </Card>
          );
        })}
      </Scroll>
    </Section>
  );
}
