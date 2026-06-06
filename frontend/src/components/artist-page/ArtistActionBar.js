import React from 'react';
import styled from 'styled-components';
import { FaPlay, FaRandom } from 'react-icons/fa';
import ArtistShareMenu from './ArtistShareMenu';

const Bar = styled.div`
  max-width: 980px;
  margin: 0 auto;
  padding: 16px 16px 4px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const PrimaryCta = styled.button`
  height: 52px;
  min-width: 52px;
  padding: 0 24px;
  border-radius: 999px;
  border: none;
  background: #fff;
  color: #000;
  cursor: pointer;
  font-family: 'Unbounded', sans-serif;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover:not(:disabled) {
    transform: scale(1.03);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55);
  }

  &:active:not(:disabled) {
    transform: scale(0.98);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 3px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const GhostButton = styled.button`
  height: 44px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  cursor: pointer;
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const Spacer = styled.div`
  margin-left: auto;

  @media (max-width: 520px) {
    margin-left: 0;
    width: 100%;
    display: flex;
    justify-content: flex-end;
  }
`;

export default function ArtistActionBar({
    canPlay,
    onPlayAll,
    onShuffle,
    onStartRadio,
    artistName,
    shareUrl,
}) {
    return (
        <Bar>
            <PrimaryCta
                type="button"
                onClick={onPlayAll}
                disabled={!canPlay}
                aria-label="Играть все треки"
            >
                <FaPlay size={14} />
                Играть
            </PrimaryCta>

            <GhostButton
                type="button"
                onClick={onShuffle}
                disabled={!canPlay}
                aria-label="Перемешать треки"
            >
                <FaRandom size={13} />
                Перемешать
            </GhostButton>

            <Spacer>
                <ArtistShareMenu
                    artistName={artistName}
                    shareUrl={shareUrl}
                    onStartRadio={onStartRadio}
                />
            </Spacer>
        </Bar>
    );
}
