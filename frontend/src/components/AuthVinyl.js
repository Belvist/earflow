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
  display: none;

  @media (min-width: 1024px) {
    display: flex;
    position: absolute;
    top: 50%;
    left: max(12px, calc(50vw - 520px));
    width: clamp(220px, 20vw, 280px);
    height: clamp(220px, 20vw, 280px);
    transform: translateY(-50%);
    pointer-events: none;
    z-index: 0;
  }
`;

const Disc = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background-color: #0e0e0e;
  background-image:
    radial-gradient(circle at 32% 28%, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0) 42%),
    repeating-radial-gradient(circle at center, #101010 0px, #151515 1px, #101010 2px);
  box-shadow:
    0 40px 90px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 255, 255, 0.06),
    inset 0 0 60px rgba(0, 0, 0, 0.85);
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
  border: 2px solid rgba(255, 255, 255, 0.16);
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

const AuthVinyl = () => {
  const [covers, setCovers] = useState([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
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
