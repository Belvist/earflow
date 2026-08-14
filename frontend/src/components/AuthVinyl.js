import React, { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';

import apiClient from '../api/client';

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

const coverFade = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const VinylWrap = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
`;

const Disc = styled.div`
  position: relative;
  width: clamp(180px, 62%, 240px);
  aspect-ratio: 1;
  border-radius: 50%;
  background-color: #e7e7ea;
  background-image:
    radial-gradient(circle at 50% 50%, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 30%, rgba(0, 0, 0, 0.08) 47%, rgba(0, 0, 0, 0.14) 48.5%, rgba(0, 0, 0, 0.22) 49.6%, rgba(0, 0, 0, 0.06) 50%, rgba(0, 0, 0, 0) 51%),
    repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.9) 0px, rgba(255, 255, 255, 0.9) 0.6px, rgba(206, 206, 211, 0.9) 0.7px, rgba(206, 206, 211, 0.9) 1.2px);
  box-shadow:
    0 26px 60px rgba(0, 0, 0, 0.5),
    0 2px 8px rgba(0, 0, 0, 0.35),
    0 0 0 1px rgba(0, 0, 0, 0.16),
    inset 0 0 24px rgba(0, 0, 0, 0.12);
  animation: ${spin} 6s linear infinite;
  will-change: transform;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: linear-gradient(
      115deg,
      transparent 22%,
      rgba(255, 255, 255, 0.5) 34%,
      rgba(255, 255, 255, 0.14) 42%,
      rgba(0, 0, 0, 0.1) 52%,
      transparent 64%
    );
  }
`;

const CenterHole = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6%;
  height: 6%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #3a3a3d, #0a0a0b 70%);
  box-shadow:
    inset 0 1px 2px rgba(255, 255, 255, 0.25),
    0 1px 3px rgba(0, 0, 0, 0.6);
  z-index: 2;
`;

const CenterLabel = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  width: 40%;
  height: 40%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  overflow: hidden;
  border: 2px solid rgba(0, 0, 0, 0.22);
  background: #161616;
  box-shadow:
    inset 0 0 18px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
`;

const CoverImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: ${coverFade} 0.6s ease;
`;

const Monogram = styled.span`
  color: rgba(255, 255, 255, 0.5);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
`;

const isDesktop = () => {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;
  } catch {
    return false;
  }
};

const AuthVinyl = () => {
  const [covers, setCovers] = useState([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!isDesktop()) return;
    let cancelled = false;

    const load = async () => {
      try {
        const data = await apiClient.searchV1({ q: 'pop', limit: 8 });
        if (cancelled) return;
        const tracks = (data && Array.isArray(data.tracks) ? data.tracks : [])
          .map((t) => apiClient.getCoverUrl(t))
          .filter(Boolean);
        if (tracks.length) {
          setCovers(tracks.slice(0, 8));
        }
      } catch {
        // декоративный элемент: без обложек показываем монограмму
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (covers.length <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % covers.length);
    }, 6000);
    return () => window.clearInterval(id);
  }, [covers.length]);

  const cover = covers.length ? covers[index % covers.length] : null;

  return (
    <VinylWrap aria-hidden="true">
      <Disc>
        <CenterLabel>
          {cover ? <CoverImage key={index} src={cover} alt="" /> : <Monogram>Earflow</Monogram>}
        </CenterLabel>
        <CenterHole />
      </Disc>
    </VinylWrap>
  );
};

export default AuthVinyl;
