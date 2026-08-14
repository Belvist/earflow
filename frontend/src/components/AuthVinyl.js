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
  background-color: #ececef;
  background-image:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 46%),
    repeating-radial-gradient(circle at center, #e0e0e3 0px, #ededf0 1px, #e0e0e3 2px);
  box-shadow:
    0 30px 70px rgba(0, 0, 0, 0.45),
    0 0 0 1px rgba(0, 0, 0, 0.06),
    inset 0 0 40px rgba(0, 0, 0, 0.1);
  animation: ${spin} 6s linear infinite;
  will-change: transform;
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
  border: 2px solid rgba(0, 0, 0, 0.2);
  background: #161616;
  box-shadow: inset 0 0 24px rgba(0, 0, 0, 0.6);
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
      </Disc>
    </VinylWrap>
  );
};

export default AuthVinyl;
