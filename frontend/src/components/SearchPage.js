import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styled, { keyframes } from "styled-components";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  FaChevronLeft,
  FaChevronRight,
  FaSearch,
  FaPlay,
  FaMusic,
  FaTimes,
} from "react-icons/fa";
import apiClient from "../api/client";
import { asHttpStatus, isAbortError } from "../api/errors";
import { usePlayerDispatch, usePlayerState } from "../context/PlayerContext";
import useAuth from "../hooks/useAuth";
import {
  buildIndex,
  rerank,
  search as localSearch,
} from "../search/searchCore";

const shimmerAnim = keyframes`
  0% { background-position: -400px 0; }
  100% { background-position: 400px 0; }
`;

const Page = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 14px 12px 28px;

  @media (min-width: 768px) {
    padding: 28px 24px 36px;
  }
`;

const SearchWrapper = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 16px;
  border: 1.5px solid
    ${(p) => (p.$focused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)")};
  background: rgba(255, 255, 255, 0.07);
  box-shadow: ${(p) =>
    p.$focused
      ? "0 0 0 4px rgba(255,255,255,0.05), 0 4px 24px rgba(0,0,0,0.4)"
      : "0 2px 12px rgba(0,0,0,0.25)"};
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  @media (min-width: 768px) {
    padding: 16px 22px;
    border-radius: 24px;
    gap: 12px;
  }
`;

const SearchIconWrap = styled.div`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(p) =>
    p.$focused ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.5)"};
  transition: color 0.18s ease;
`;

const SearchInput = styled.input`
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.96);
  font-size: 16px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  min-width: 0;

  &::placeholder {
    color: rgba(255, 255, 255, 0.38);
    font-weight: 500;
  }

  @media (min-width: 768px) {
    font-size: 16px;
  }
`;

const ClearButton = styled.button`
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s ease,
    opacity 0.15s ease;
  opacity: ${(p) => (p.$visible ? "1" : "0")};
  pointer-events: ${(p) => (p.$visible ? "auto" : "none")};

  &:hover {
    background: rgba(255, 255, 255, 0.16);
    color: rgba(255, 255, 255, 0.95);
  }
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  min-height: 18px;
`;

const StatusText = styled.div`
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
  font-family: "Unbounded", sans-serif;
  font-weight: 500;
  letter-spacing: 0.02em;
`;

const LoadingDots = styled.span`
  display: inline-flex;
  gap: 3px;
  align-items: center;

  & span {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.45);
    animation: dotPulse 1.2s ease-in-out infinite;
  }
  & span:nth-child(2) {
    animation-delay: 0.2s;
  }
  & span:nth-child(3) {
    animation-delay: 0.4s;
  }

  @keyframes dotPulse {
    0%,
    80%,
    100% {
      transform: scale(0.7);
      opacity: 0.5;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }
`;

const ErrorBox = styled.div`
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 16px;
  background: rgba(255, 60, 60, 0.09);
  border: 1px solid rgba(255, 60, 60, 0.22);
  color: rgba(255, 255, 255, 0.88);
  font-size: 13px;
  font-family: "Unbounded", sans-serif;
  font-weight: 500;
  line-height: 1.5;
`;

const Section = styled.section`
  margin-top: 28px;

  @media (min-width: 768px) {
    margin-top: 32px;
  }
`;

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  font-family: "Unbounded", sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.5);

  @media (min-width: 768px) {
    font-size: 12px;
  }
`;

const SectionActions = styled.div`
  display: none;

  @media (min-width: 768px) {
    display: flex;
    gap: 6px;
  }
`;

const IconButton = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.95);
  }

  &:active {
    transform: scale(0.96);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }
`;

const ArtistsScroller = styled.div`
  display: flex;
  gap: 12px;
  overflow-x: auto;
  padding: 2px 2px 8px;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const ArtistTile = styled.button`
  flex: 0 0 auto;
  width: 88px;
  border: none;
  background: transparent;
  color: white;
  border-radius: 12px;
  padding: 6px 2px;
  cursor: pointer;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  text-align: center;
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.85;
  }

  &:active {
    transform: scale(0.97);
    opacity: 0.75;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 4px;
    border-radius: 12px;
  }

  @media (min-width: 768px) {
    width: 108px;
    padding: 8px 4px;
  }
`;

const ArtistAvatar = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12),
    rgba(255, 255, 255, 0.05)
  );
  border: 1.5px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);

  @media (min-width: 768px) {
    width: 76px;
    height: 76px;
  }
`;

const AvatarImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const AvatarFallback = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 900;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.75);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.15) 0%,
    rgba(255, 255, 255, 0.05) 100%
  );
  letter-spacing: -0.5px;
`;

const ArtistName = styled.div`
  width: 100%;
  font-size: 12px;
  font-weight: 800;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ArtistSub = styled.div`
  width: 100%;
  font-size: 11px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.48);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const AlbumsGrid = styled.div`
  display: flex;
  flex-direction: row;
  gap: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: 2px 2px 12px;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 768px) {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
    gap: 16px;
    overflow: visible;
    scroll-snap-type: none;
    padding: 0;
  }
`;

const AlbumCard = styled.button`
  flex: 0 0 auto;
  width: 124px;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 9px;
  border: 1px solid transparent;
  background: transparent;
  color: white;
  border-radius: 12px;
  padding: 6px;
  cursor: pointer;
  text-align: left;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(255, 255, 255, 0.08);
  }

  &:active {
    transform: scale(0.97);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }

  @media (min-width: 768px) {
    flex: unset;
    width: auto;
    scroll-snap-align: none;
    padding: 8px;
  }
`;

const AlbumCover = styled.div`
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 10px;
  overflow: hidden;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.1),
    rgba(255, 255, 255, 0.04)
  );
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
`;

const AlbumCoverImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

const AlbumCoverFallback = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 900;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.65);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.04) 100%
  );
`;

const AlbumMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const AlbumTitle = styled.div`
  font-size: 12px;
  font-weight: 800;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.92);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.25;
`;

const AlbumArtist = styled.div`
  font-size: 11px;
  font-weight: 600;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.48);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TracksList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TrackItem = styled.button`
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 12px;
  align-items: center;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: white;
  border-radius: 14px;
  padding: 8px 10px;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(255, 255, 255, 0.1);
  }

  &:hover .track-play-overlay {
    opacity: 1;
  }

  &:active {
    transform: scale(0.995);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }
`;

const TrackCoverWrap = styled.div`
  position: relative;
  width: 42px;
  aspect-ratio: 4 / 5;
  height: auto;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  align-self: center;
`;

const TrackCoverImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
`;

const TrackCoverFallback = styled.div`
  width: 100%;
  height: 100%;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.7);
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.12) 0%,
    rgba(255, 255, 255, 0.04) 100%
  );
`;

const TrackPlayOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.15s ease;
  color: white;
`;

const TrackMeta = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const TrackTitle = styled.div`
  font-size: 12px;
  font-weight: 500;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.94);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const TrackArtist = styled.div`
  font-size: 10.5px;
  font-weight: 400;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.52);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SectionFooter = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: center;
`;

const MoreButton = styled.button`
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.8);
  border-radius: 999px;
  padding: 10px 20px;
  font-size: 11px;
  font-family: "Unbounded", sans-serif;
  font-weight: 700;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.22);
    color: rgba(255, 255, 255, 0.95);
  }

  &:active {
    transform: scale(0.98);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }
`;

const SkeletonBase = styled.div`
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 0%,
    rgba(255, 255, 255, 0.1) 40%,
    rgba(255, 255, 255, 0.05) 80%
  );
  background-size: 400px 100%;
  animation: ${shimmerAnim} 1.6s ease-in-out infinite;
  border-radius: 10px;
`;

const SkeletonTrackRow = styled.div`
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 12px;
  align-items: center;
  padding: 8px 10px;
`;

const SkeletonArtistTile = styled.div`
  flex: 0 0 auto;
  width: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  padding: 8px 6px;
`;

const EmptyStateWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 56px 24px 32px;
  gap: 16px;
  text-align: center;
`;

const EmptyIcon = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 4px;
`;

const EmptyTitle = styled.div`
  font-size: 16px;
  font-weight: 800;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.8);
`;

const EmptyHint = styled.div`
  font-size: 12px;
  font-weight: 500;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.6;
  max-width: 280px;
`;

const InitialStateWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px 32px;
  gap: 14px;
  text-align: center;
`;

const InitialIcon = styled.div`
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.22);
`;

const InitialTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.55);
`;

const InitialHint = styled.div`
  font-size: 11px;
  font-weight: 500;
  font-family: "Unbounded", sans-serif;
  color: rgba(255, 255, 255, 0.3);
  line-height: 1.6;
  max-width: 260px;
`;

const QueryChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  max-width: 440px;
  margin-top: 8px;
`;

const QueryChip = styled.button`
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  padding: 9px 12px;
  font-size: 10px;
  font-weight: 700;
  font-family: "Unbounded", sans-serif;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.22);
    color: rgba(255, 255, 255, 0.92);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.3);
    outline-offset: 2px;
  }
`;

function SkeletonLoading() {
  return (
    <>
      <Section>
        <SectionHeader>
          <SkeletonBase style={{ width: 80, height: 12, borderRadius: 6 }} />
        </SectionHeader>
        <ArtistsScroller>
          {[0, 1, 2, 4].map((i) => (
            <SkeletonArtistTile key={i}>
              <SkeletonBase
                style={{ width: 80, height: 80, borderRadius: "50%" }}
              />
              <SkeletonBase
                style={{ width: "90%", height: 10, borderRadius: 5 }}
              />
              <SkeletonBase
                style={{ width: "60%", height: 9, borderRadius: 5 }}
              />
            </SkeletonArtistTile>
          ))}
        </ArtistsScroller>
      </Section>
      <Section>
        <SectionHeader>
          <SkeletonBase style={{ width: 60, height: 12, borderRadius: 6 }} />
        </SectionHeader>
        <TracksList>
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonTrackRow key={i}>
              <SkeletonBase
                style={{
                  width: 42,
                  aspectRatio: "4 / 5",
                  height: "auto",
                  borderRadius: 8,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <SkeletonBase
                  style={{
                    width: `${60 + (i % 3) * 15}%`,
                    height: 11,
                    borderRadius: 5,
                  }}
                />
                <SkeletonBase
                  style={{
                    width: `${35 + (i % 2) * 20}%`,
                    height: 9,
                    borderRadius: 5,
                  }}
                />
              </div>
            </SkeletonTrackRow>
          ))}
        </TracksList>
      </Section>
    </>
  );
}

const CURATED_SEARCH_QUERIES = Object.freeze([
  "новинки",
  "поп",
  "хип-хоп",
  "электроника",
  "рок",
  "инди",
]);
const normalizeQuery = (raw) => {
  const s = typeof raw === "string" ? raw.normalize("NFC").trim() : "";
  if (!s) return "";
  return s.replace(/\s+/g, " ").slice(0, 120);
};

const normalizeResultMatchText = (raw) =>
  normalizeQuery(raw).toLowerCase().replace(/ё/g, "е");

const scoreResultMatch = (query, values) => {
  const q = normalizeResultMatchText(query);
  if (!q) return 0;

  const qTokens = q.split(/[\s\-_]+/g).filter(Boolean);
  let best = 0;

  for (const raw of Array.isArray(values) ? values : []) {
    const v = normalizeResultMatchText(raw);
    if (!v) continue;

    if (v === q) {
      best = Math.max(best, 1000);
    } else if (v.startsWith(q)) {
      best = Math.max(best, 700);
    } else if (v.includes(q)) {
      best = Math.max(best, 360);
    }

    const tokens = v.split(/[\s\-_]+/g).filter(Boolean);
    if (tokens.some((token) => token.startsWith(q))) {
      best = Math.max(best, 520);
    }
    if (
      qTokens.length > 0 &&
      qTokens.every((qt) =>
        tokens.some((token) => token.startsWith(qt) || token.includes(qt)),
      )
    ) {
      best = Math.max(best, 420);
    }
  }

  return best;
};

const initialsFromText = (value) => {
  const s = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (!s) return "";
  const parts = s.split(/\s+/g).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const primaryArtistFromText = (raw) => {
  if (typeof raw !== "string") return "";
  let s = raw.normalize("NFC");
  s = s.replace(/\((?:\s*(?:feat\.?|ft\.?|featuring|with)\b[^)]*)\)/gi, " ");
  s = s.replace(/\[(?:\s*(?:feat\.?|ft\.?|featuring|with)\b[^\]]*)\]/gi, " ");
  s = s.replace(/\b(?:feat\.?|ft\.?|featuring|with)\b[\s\S]*$/i, " ");
  s = s.replace(/(?:\s*[;,&]\s*|\s+(?:x|×|and)\s+|\s+\/\s+)[\s\S]*$/i, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.slice(0, 120);
};

const deriveArtistsFromTracks = (tracks, limit = 10, query = "") => {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const byName = new Map();
  for (const t of tracks) {
    const rawArtist = t && typeof t.artist === "string" ? t.artist : "";
    const name = primaryArtistFromText(rawArtist);
    if (!name) continue;

    const key = name.toLowerCase();
    const cur = byName.get(key);
    const coverPath =
      t && typeof t.cover_path === "string" && t.cover_path.trim()
        ? t.cover_path.trim()
        : null;
    const matchScore = scoreResultMatch(query, [
      name,
      rawArtist,
      t?.title,
      t?.album,
    ]);

    if (!cur) {
      byName.set(key, {
        artistName: name,
        artistPublicId: null,
        isVerified: false,
        trackCount: 1,
        totalPlays: null,
        heroCoverPath: coverPath,
        _matchScore: matchScore,
      });
      continue;
    }

    cur.trackCount =
      (typeof cur.trackCount === "number" ? cur.trackCount : 0) + 1;
    cur._matchScore = Math.max(cur._matchScore || 0, matchScore);
    if (!cur.heroCoverPath && coverPath) {
      cur.heroCoverPath = coverPath;
    }
  }

  const out = Array.from(byName.values());
  const hasQueryMatches =
    normalizeQuery(query) && out.some((a) => (a._matchScore || 0) > 0);
  const ranked = hasQueryMatches
    ? out.filter((a) => (a._matchScore || 0) > 0)
    : out;
  ranked.sort((a, b) => {
    const scoreDelta = (b._matchScore || 0) - (a._matchScore || 0);
    if (scoreDelta) return scoreDelta;
    return (b.trackCount || 0) - (a.trackCount || 0);
  });
  return ranked
    .slice(0, Math.max(1, limit))
    .map(({ _matchScore, ...artist }) => artist);
};

const deriveAlbumsFromTracks = (tracks, limit = 10, query = "") => {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const byKey = new Map();
  for (const t of tracks) {
    const rawArtist = t && typeof t.artist === "string" ? t.artist : "";
    const artist = primaryArtistFromText(rawArtist);
    const album = t && typeof t.album === "string" ? t.album.trim() : "";
    if (!artist || !album) continue;

    const key = `${artist.toLowerCase()}\n${album.toLowerCase()}`;
    const cur = byKey.get(key);
    const coverPath =
      t && typeof t.cover_path === "string" && t.cover_path.trim()
        ? t.cover_path.trim()
        : null;
    const matchScore = scoreResultMatch(query, [
      album,
      artist,
      rawArtist,
      t?.title,
    ]);

    if (!cur) {
      byKey.set(key, {
        albumName: album,
        albumPublicId: null,
        artistName: artist,
        artistPublicId: null,
        trackCount: 1,
        totalPlays: null,
        year: t && Number.isFinite(Number(t.year)) ? Number(t.year) : null,
        heroCoverPath: coverPath,
        _matchScore: matchScore,
      });
      continue;
    }

    cur.trackCount =
      (typeof cur.trackCount === "number" ? cur.trackCount : 0) + 1;
    cur._matchScore = Math.max(cur._matchScore || 0, matchScore);
    if (!cur.heroCoverPath && coverPath) {
      cur.heroCoverPath = coverPath;
    }
  }

  const out = Array.from(byKey.values());
  const hasQueryMatches =
    normalizeQuery(query) && out.some((a) => (a._matchScore || 0) > 0);
  const ranked = hasQueryMatches
    ? out.filter((a) => (a._matchScore || 0) > 0)
    : out;
  ranked.sort((a, b) => {
    const scoreDelta = (b._matchScore || 0) - (a._matchScore || 0);
    if (scoreDelta) return scoreDelta;
    return (b.trackCount || 0) - (a.trackCount || 0);
  });
  return ranked
    .slice(0, Math.max(1, limit))
    .map(({ _matchScore, ...album }) => album);
};

const pluralTracks = (n) => {
  if (n === 1) return "трек";
  if (n >= 2 && n <= 4) return "трека";
  return "треков";
};

const deriveErrorText = (err) => {
  const st = asHttpStatus(err);
  const code =
    err && typeof err === "object"
      ? String(err?.details?.code || err?.code || "")
      : "";

  if (st === 429) {
    return "Слишком много запросов. Попробуй чуть позже.";
  }
  if (st === 400 || code === "INVALID_QUERY") {
    return "Запрос содержит недопустимые символы или слишком длинный.";
  }
  if (st === 504 || code === "TIMEOUT") {
    return "Поиск не успел ответить. Попробуй снова.";
  }
  if (st === 503 || code === "SEARCH_UNAVAILABLE") {
    return "Поиск временно недоступен.";
  }
  return "Ошибка поиска.";
};

const hasAnySearchResults = (res) => {
  if (!res || typeof res !== "object") return false;
  return (
    (Array.isArray(res.tracks) && res.tracks.length > 0) ||
    (Array.isArray(res.artists) && res.artists.length > 0) ||
    (Array.isArray(res.albums) && res.albums.length > 0)
  );
};

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerDispatch = usePlayerDispatch();
  const playerState = usePlayerState();
  const { isAuthenticated } = useAuth();

  const [input, setInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [tracksExpanded, setTracksExpanded] = useState(false);
  const [focused, setFocused] = useState(false);

  const abortRef = useRef(null);
  const debounceRef = useRef(null);
  const cacheRef = useRef(new Map());
  const SEARCH_CACHE_MAX = 30;
  const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
  const artistsScrollRef = useRef(null);
  const albumsScrollRef = useRef(null);
  const lastWrittenUrlQRef = useRef("");
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;
  const inputRef = useRef(null);
  const lastSearchRecoRefreshAtRef = useRef(0);
  const recommendationManager = playerState?.recommendations || null;
  const hasRecommendationManager = Boolean(recommendationManager);
  const canUseLiveRecommendations = Boolean(
    isAuthenticated && hasRecommendationManager,
  );
  const recommendationHookTracks = recommendationManager?.tracks;
  const recommendationSessionId =
    typeof recommendationManager?.sessionId === "string"
      ? recommendationManager.sessionId
      : "";
  const recommendationHydrationDone = recommendationManager?.hydrationDone;
  const recommendationLoading = recommendationManager?.loading === true;
  const initializeRecommendations = recommendationManager?.initializeSession;
  const refreshRecommendations = recommendationManager?.refreshRecommendations;

  const libraryTracks = useMemo(() => {
    const raw = Array.isArray(playerState?.libraryTracks)
      ? playerState.libraryTracks
      : [];
    return raw.filter((track) => track && typeof track === "object");
  }, [playerState?.libraryTracks]);

  const localLibraryIndex = useMemo(() => {
    try {
      return buildIndex(libraryTracks);
    } catch {
      return [];
    }
  }, [libraryTracks]);

  const liveRecommendations = useMemo(() => {
    const fromHook = Array.isArray(recommendationHookTracks)
      ? recommendationHookTracks
      : [];
    if (fromHook.length > 0) return fromHook;
    return Array.isArray(playerState?.recommendationTracks)
      ? playerState.recommendationTracks
      : [];
  }, [playerState?.recommendationTracks, recommendationHookTracks]);

  const tracks = useMemo(() => {
    const raw = data && Array.isArray(data.tracks) ? data.tracks : [];
    if (raw.length > 0) {
      return activeQuery ? rerank(raw, activeQuery) : raw;
    }
    if (!activeQuery || localLibraryIndex.length === 0) {
      return raw;
    }
    return localSearch(localLibraryIndex, activeQuery, 40);
  }, [data, activeQuery, localLibraryIndex]);
  const artists = useMemo(
    () => (data && Array.isArray(data.artists) ? data.artists : []),
    [data],
  );
  const albums = useMemo(
    () => (data && Array.isArray(data.albums) ? data.albums : []),
    [data],
  );
  const recommendations = useMemo(() => {
    const inline =
      data && Array.isArray(data.recommendations) ? data.recommendations : [];
    if (inline.length > 0) return inline;
    if (liveRecommendations.length > 0) return liveRecommendations;
    return [];
  }, [data, liveRecommendations]);

  const effectiveArtists = useMemo(() => {
    if (artists.length > 0) return artists;
    return deriveArtistsFromTracks(tracks, 10, activeQuery);
  }, [artists, tracks, activeQuery]);

  const effectiveAlbums = useMemo(() => {
    if (albums.length > 0) return albums;
    return deriveAlbumsFromTracks(tracks, 10, activeQuery);
  }, [albums, tracks, activeQuery]);

  useEffect(() => {
    const urlQ = normalizeQuery(searchParams.get("q") || "");
    if (urlQ === normalizeQuery(lastWrittenUrlQRef.current || "")) {
      return;
    }
    setInput(urlQ);
  }, [searchParams]);

  const runSearch = useCallback(
    async (q) => {
      const query = normalizeQuery(q);
      setActiveQuery(query);

      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch { }
        abortRef.current = null;
      }

      if (!query) {
        setLoading(false);
        setError(null);
        setData(null);
        return;
      }

      const cache = cacheRef.current;
      const cached = cache.get(query);
      const now = Date.now();
      const isFresh =
        cached &&
        typeof cached === "object" &&
        cached.data &&
        now - cached.at < SEARCH_CACHE_TTL_MS;

      if (isFresh && hasAnySearchResults(cached.data)) {
        setData(cached.data);
        setError(null);
        setLoading(false);
        return;
      }

      if (
        cached &&
        typeof cached === "object" &&
        cached.data &&
        hasAnySearchResults(cached.data)
      ) {
        setData(cached.data);
        setError(null);
      }

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setLoading(true);
      setError(null);

      try {
        let res = await apiClient.searchV1({
          q: query,
          limit: 40,
          offset: 0,
          signal: ctrl.signal,
          timeoutMs: 6000,
        });

        if (!res || typeof res !== "object") {
          setData(null);
          return;
        }

        if (hasAnySearchResults(res)) {
          cache.delete(query);
          cache.set(query, { at: Date.now(), data: res });

          if (cache.size > SEARCH_CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
        } else {
          cache.delete(query);
        }

        setData(res);
        setError(null);
      } catch (e) {
        if (isAbortError(e)) {
          return;
        }
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    [SEARCH_CACHE_MAX, SEARCH_CACHE_TTL_MS],
  );

  const scrollArtistsBy = useCallback((dir) => {
    const el = artistsScrollRef.current;
    if (!el) return;
    const step = Math.max(280, Math.floor(el.clientWidth * 0.8));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  const scrollAlbumsBy = useCallback((dir) => {
    const el = albumsScrollRef.current;
    if (!el) return;
    const step = Math.max(280, Math.floor(el.clientWidth * 0.8));
    el.scrollBy({ left: dir * step, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const q = normalizeQuery(input);

    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    debounceRef.current = window.setTimeout(() => {
      const sp = searchParamsRef.current;
      const curUrlQ = normalizeQuery(sp.get("q") || "");
      if (q !== curUrlQ) {
        lastWrittenUrlQRef.current = q;
        const next = new URLSearchParams(sp);
        if (q) {
          next.set("q", q);
        } else {
          next.delete("q");
        }
        setSearchParams(next, { replace: true });
      }
      runSearch(q);
    }, 180);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [input, runSearch, setSearchParams]);

  useEffect(() => {
    setTracksExpanded(false);
  }, [activeQuery]);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      if (abortRef.current) {
        try {
          abortRef.current.abort();
        } catch { }
        abortRef.current = null;
      }
      cache.clear();
    };
  }, []);

  useEffect(() => {
    if (activeQuery) return;
    if (
      canUseLiveRecommendations &&
      (recommendationHydrationDone === false || recommendationLoading)
    ) {
      return;
    }

    if (
      canUseLiveRecommendations &&
      recommendationHydrationDone !== false &&
      !recommendationLoading
    ) {
      if (
        !recommendationSessionId &&
        typeof initializeRecommendations === "function"
      ) {
        void initializeRecommendations({}, { limit: 40 });
        return;
      }

      if (
        recommendationSessionId &&
        typeof refreshRecommendations === "function"
      ) {
        const now = Date.now();
        const refreshEveryMs =
          liveRecommendations.length > 0 ? 5 * 60 * 1000 : 30000;
        if (now - lastSearchRecoRefreshAtRef.current >= refreshEveryMs) {
          lastSearchRecoRefreshAtRef.current = now;
          void refreshRecommendations(false, {
            preserveExisting: true,
            reason: "search_page_visible",
          });
        }
        return;
      }
    }

    if (canUseLiveRecommendations) return;
  }, [
    activeQuery,
    canUseLiveRecommendations,
    initializeRecommendations,
    liveRecommendations.length,
    recommendationHydrationDone,
    recommendationLoading,
    recommendationSessionId,
    refreshRecommendations,
  ]);

  const onPlayTrack = useCallback(
    (trackId) => {
      const id = trackId != null ? String(trackId) : "";
      if (!id || !tracks.length) return;
      playerDispatch.playFromList(
        tracks,
        id,
        activeQuery ? `Search: ${activeQuery}` : "Search",
      );
    },
    [activeQuery, playerDispatch, tracks],
  );

  const onPlayRecommendation = useCallback(
    (trackId) => {
      const id = trackId != null ? String(trackId) : "";
      if (!id || !recommendations.length) return;
      playerDispatch.playFromList(
        recommendations,
        id,
        "Search recommendations",
      );
    },
    [playerDispatch, recommendations],
  );

  const onArtistOpen = useCallback(
    (artist) => {
      const raw = artist && typeof artist === "object" ? artist : null;
      const pid =
        raw && typeof raw.artistPublicId === "string"
          ? raw.artistPublicId.trim()
          : "";
      const name =
        raw && typeof raw.artistName === "string" ? raw.artistName.trim() : "";
      const token = pid || name;
      if (!token) return;
      navigate(`/artist/${encodeURIComponent(token)}`);
    },
    [navigate],
  );

  const onAlbumOpen = useCallback(
    (album) => {
      const raw = album && typeof album === "object" ? album : null;
      const pid =
        raw && typeof raw.albumPublicId === "string"
          ? raw.albumPublicId.trim()
          : "";
      const artist =
        raw && typeof raw.artistName === "string" ? raw.artistName.trim() : "";
      const name =
        raw && typeof raw.albumName === "string" ? raw.albumName.trim() : "";

      if (pid) {
        navigate(`/album/${encodeURIComponent(pid)}`);
        return;
      }

      if (artist && name) {
        navigate(
          `/album/${encodeURIComponent(artist)}/${encodeURIComponent(name)}`,
        );
      }
    },
    [navigate],
  );

  const showEmpty =
    !loading &&
    !error &&
    activeQuery &&
    tracks.length === 0 &&
    effectiveArtists.length === 0 &&
    effectiveAlbums.length === 0;
  const showInitial = !loading && !error && !activeQuery && !data;
  const showRecommendations =
    !loading && !error && recommendations.length > 0 && !activeQuery;

  const TRACKS_INITIAL_LIMIT = 10;
  const visibleTracks = useMemo(() => {
    if (tracksExpanded) return tracks;
    return tracks.slice(0, TRACKS_INITIAL_LIMIT);
  }, [tracks, tracksExpanded]);

  const onQuickSearch = useCallback((query) => {
    const q = normalizeQuery(query);
    if (!q) return;
    setInput(q);
    inputRef.current?.focus();
  }, []);

  const trackResultsSection =
    tracks.length > 0 ? (
      <Section>
        <SectionHeader>
          <SectionTitle>Треки</SectionTitle>
        </SectionHeader>
        <TracksList>
          {visibleTracks.map((t) => {
            const id = t && t.id != null ? String(t.id) : "";
            const title = t && typeof t.title === "string" ? t.title : "";
            const artist = t && typeof t.artist === "string" ? t.artist : "";
            const coverUrl = apiClient.getCoverUrl(t);
            const initials = initialsFromText(title || artist);
            return (
              <TrackItem
                key={`t:${id || title}`}
                type="button"
                onClick={() => onPlayTrack(id)}
              >
                <TrackCoverWrap>
                  {coverUrl ? (
                    <TrackCoverImg
                      src={coverUrl}
                      alt={title || "Cover"}
                      loading="lazy"
                    />
                  ) : (
                    <TrackCoverFallback aria-hidden="true">
                      {initials}
                    </TrackCoverFallback>
                  )}
                  <TrackPlayOverlay
                    className="track-play-overlay"
                    aria-hidden="true"
                  >
                    <FaPlay size={14} />
                  </TrackPlayOverlay>
                </TrackCoverWrap>
                <TrackMeta>
                  <TrackTitle>{title || "Без названия"}</TrackTitle>
                  <TrackArtist>
                    {artist || "Неизвестный исполнитель"}
                  </TrackArtist>
                </TrackMeta>
              </TrackItem>
            );
          })}
        </TracksList>

        {tracks.length > TRACKS_INITIAL_LIMIT ? (
          <SectionFooter>
            <MoreButton
              type="button"
              onClick={() => setTracksExpanded((v) => !v)}
            >
              {tracksExpanded
                ? "Свернуть"
                : `Ещё ${tracks.length - visibleTracks.length} треков`}
            </MoreButton>
          </SectionFooter>
        ) : null}
      </Section>
    ) : null;

  return (
    <Page>
      <SearchWrapper
        $focused={focused}
        onClick={() => inputRef.current?.focus()}
      >
        <SearchIconWrap $focused={focused} aria-hidden="true">
          <FaSearch size={16} />
        </SearchIconWrap>
        <SearchInput
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(String(e.target.value || "").slice(0, 120))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Поиск треков, артистов, альбомов"
          inputMode="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          enterKeyHint="search"
          spellCheck={false}
        />
        <ClearButton
          type="button"
          $visible={!!input}
          aria-label="Очистить поиск"
          onMouseDown={(e) => {
            e.preventDefault();
            setInput("");
            inputRef.current?.focus();
          }}
        >
          <FaTimes size={11} />
        </ClearButton>
      </SearchWrapper>

      <StatusRow>
        {loading ? (
          <LoadingDots aria-label="Поиск...">
            <span />
            <span />
            <span />
          </LoadingDots>
        ) : activeQuery ? (
          <StatusText>
            {tracks.length + effectiveArtists.length + effectiveAlbums.length >
              0
              ? `По запросу «${activeQuery}»`
              : null}
          </StatusText>
        ) : null}
      </StatusRow>

      {error ? <ErrorBox>{deriveErrorText(error)}</ErrorBox> : null}

      {loading && !data ? <SkeletonLoading /> : null}

      {!loading && showInitial ? (
        <InitialStateWrap>
          <InitialIcon aria-hidden="true">
            <FaSearch size={22} />
          </InitialIcon>
          <InitialTitle>Найди свою музыку</InitialTitle>
          <InitialHint>
            Введи название трека, имя артиста или название альбома
          </InitialHint>
          <QueryChips>
            {CURATED_SEARCH_QUERIES.map((query) => (
              <QueryChip
                key={query}
                type="button"
                onClick={() => onQuickSearch(query)}
              >
                {query}
              </QueryChip>
            ))}
          </QueryChips>
        </InitialStateWrap>
      ) : null}

      {!loading && showEmpty ? (
        <EmptyStateWrap>
          <EmptyIcon aria-hidden="true">
            <FaMusic size={28} />
          </EmptyIcon>
          <EmptyTitle>Ничего не найдено</EmptyTitle>
          <EmptyHint>{`По запросу «${activeQuery}» ничего не нашлось. Попробуй другие слова или проверь написание.`}</EmptyHint>
        </EmptyStateWrap>
      ) : null}

      {showRecommendations ? (
        <Section>
          <SectionHeader>
            <SectionTitle>Рекомендации</SectionTitle>
          </SectionHeader>
          <TracksList>
            {recommendations.map((t) => {
              const id = t && t.id != null ? String(t.id) : "";
              const title = t && typeof t.title === "string" ? t.title : "";
              const artist = t && typeof t.artist === "string" ? t.artist : "";
              const coverUrl = apiClient.getCoverUrl(t);
              const initials = initialsFromText(title || artist);
              return (
                <TrackItem
                  key={`rec:${id || title}`}
                  type="button"
                  onClick={() => onPlayRecommendation(id)}
                >
                  <TrackCoverWrap>
                    {coverUrl ? (
                      <TrackCoverImg
                        src={coverUrl}
                        alt={title || "Cover"}
                        loading="lazy"
                      />
                    ) : (
                      <TrackCoverFallback aria-hidden="true">
                        {initials}
                      </TrackCoverFallback>
                    )}
                    <TrackPlayOverlay
                      className="track-play-overlay"
                      aria-hidden="true"
                    >
                      <FaPlay size={14} />
                    </TrackPlayOverlay>
                  </TrackCoverWrap>
                  <TrackMeta>
                    <TrackTitle>{title || "Без названия"}</TrackTitle>
                    <TrackArtist>
                      {artist || "Неизвестный исполнитель"}
                    </TrackArtist>
                  </TrackMeta>
                </TrackItem>
              );
            })}
          </TracksList>
        </Section>
      ) : null}

      {trackResultsSection}

      {effectiveArtists.length > 0 ? (
        <Section>
          <SectionHeader>
            <SectionTitle>Артисты</SectionTitle>
            <SectionActions>
              <IconButton
                type="button"
                aria-label="Прокрутить влево"
                onClick={() => scrollArtistsBy(-1)}
              >
                <FaChevronLeft size={12} />
              </IconButton>
              <IconButton
                type="button"
                aria-label="Прокрутить вправо"
                onClick={() => scrollArtistsBy(1)}
              >
                <FaChevronRight size={12} />
              </IconButton>
            </SectionActions>
          </SectionHeader>
          <ArtistsScroller ref={artistsScrollRef}>
            {effectiveArtists.map((a) => {
              const name =
                a && typeof a.artistName === "string" ? a.artistName : "";
              const key =
                a &&
                  typeof a.artistPublicId === "string" &&
                  a.artistPublicId.trim()
                  ? a.artistPublicId.trim()
                  : name;
              const coverUrl = apiClient.getCoverUrl({
                cover_path: a && a.heroCoverPath ? a.heroCoverPath : null,
              });
              const initials = initialsFromText(name);
              const sub = (() => {
                const c =
                  a && typeof a.trackCount === "number" ? a.trackCount : 0;
                if (!c) return "Артист";
                return `${c} ${pluralTracks(c)}`;
              })();
              return (
                <ArtistTile
                  key={`a:${key}`}
                  type="button"
                  onClick={() => onArtistOpen(a)}
                >
                  <ArtistAvatar>
                    {coverUrl ? (
                      <AvatarImg
                        src={coverUrl}
                        alt={name || "Artist"}
                        loading="lazy"
                      />
                    ) : (
                      <AvatarFallback aria-hidden="true">
                        {initials}
                      </AvatarFallback>
                    )}
                  </ArtistAvatar>
                  <ArtistName>{name || "Артист"}</ArtistName>
                  <ArtistSub>{sub}</ArtistSub>
                </ArtistTile>
              );
            })}
          </ArtistsScroller>
        </Section>
      ) : null}

      {effectiveAlbums.length > 0 ? (
        <Section>
          <SectionHeader>
            <SectionTitle>Альбомы</SectionTitle>
            <SectionActions>
              <IconButton
                type="button"
                aria-label="Прокрутить влево"
                onClick={() => scrollAlbumsBy(-1)}
              >
                <FaChevronLeft size={12} />
              </IconButton>
              <IconButton
                type="button"
                aria-label="Прокрутить вправо"
                onClick={() => scrollAlbumsBy(1)}
              >
                <FaChevronRight size={12} />
              </IconButton>
            </SectionActions>
          </SectionHeader>
          <AlbumsGrid ref={albumsScrollRef}>
            {effectiveAlbums.map((a) => {
              const albumName =
                a && typeof a.albumName === "string" ? a.albumName : "";
              const artistName =
                a && typeof a.artistName === "string" ? a.artistName : "";
              const coverUrl = apiClient.getCoverUrl({
                cover_path: a && a.heroCoverPath ? a.heroCoverPath : null,
              });
              const initials = initialsFromText(albumName || artistName);
              return (
                <AlbumCard
                  key={`al:${artistName}:${albumName}`}
                  type="button"
                  onClick={() => onAlbumOpen(a)}
                >
                  <AlbumCover>
                    {coverUrl ? (
                      <AlbumCoverImg
                        src={coverUrl}
                        alt={albumName || "Album"}
                        loading="lazy"
                      />
                    ) : (
                      <AlbumCoverFallback aria-hidden="true">
                        {initials}
                      </AlbumCoverFallback>
                    )}
                  </AlbumCover>
                  <AlbumMeta>
                    <AlbumTitle>{albumName || "Альбом"}</AlbumTitle>
                    <AlbumArtist>{artistName || "Исполнитель"}</AlbumArtist>
                  </AlbumMeta>
                </AlbumCard>
              );
            })}
          </AlbumsGrid>
        </Section>
      ) : null}
    </Page>
  );
}
