import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { createPortal } from 'react-dom';
import { FaEllipsisV, FaLink, FaShareAlt } from 'react-icons/fa';
import { HiOutlineRadio } from 'react-icons/hi2';
import apiClient from '../../api/client';
import { usePlayer } from '../../context/PlayerContext';
import { buildTrackShareUrl, resolveTrackShareUrl } from '../../utils/trackRoute';

const Trigger = styled.span`
  flex-shrink: 0;
  margin-left: 8px;
  width: 30px;
  height: 34px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  padding: 0;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  &:active {
    background: rgba(255, 255, 255, 0.12);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.65);
    outline-offset: 1px;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  @media (min-width: 641px) {
    width: 34px;
    font-size: 14px;
  }
`;

const Menu = styled.div`
  position: fixed;
  min-width: 210px;
  max-width: calc(100vw - 16px);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(18, 18, 18, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  z-index: 10060;
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  svg {
    flex-shrink: 0;
    opacity: 0.85;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (min-width: 641px) {
    font-size: 13px;
  }
`;

const MENU_WIDTH = 210;
const PAD = 8;

export default function TrackRowMenu({ track, extraItems }) {
  const player = usePlayer();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const [radioLoading, setRadioLoading] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const toggle = useCallback((e) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
      setPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(PAD, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - PAD));
    const approxHeight = 3 * 48 + 22;
    const below = rect.bottom + approxHeight + PAD;
    const top = below < window.innerHeight ? rect.bottom + PAD : Math.max(PAD, rect.top - approxHeight - PAD);
    setPos({ left, top });
    setOpen(true);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      const target = e.target;
      if (menuRef.current && menuRef.current.contains(target)) return;
      if (triggerRef.current && triggerRef.current.contains(target)) return;
      setOpen(false);
      setPos(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setPos(null);
      }
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setPos(null);
  }, []);

  const startRadio = useCallback(async () => {
    const artist = (track?.artist || '').trim();
    if (!artist || radioLoading) return;
    close();
    setRadioLoading(true);
    try {
      const exclude = track?.id ? String(track.id) : '';
      const radio = await apiClient.getArtistRadio(artist, {
        limit: 30,
        userId: player.userId ?? null,
        exclude,
      });
      if (!Array.isArray(radio) || radio.length === 0) return;
      player.playFromList(radio, radio[0].id, `${artist} Radio`);
    } catch {
    } finally {
      setRadioLoading(false);
    }
  }, [track, radioLoading, player, close]);

  const shareTrack = useCallback(async () => {
    if (shareLoading) return;
    setShareLoading(true);
    let url = buildTrackShareUrl(track);
    if (!url) url = await resolveTrackShareUrl(apiClient, track);
    setShareLoading(false);
    if (!url) return;
    const title = track?.title || 'Трек';
    close();
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `${title}${track?.artist ? ` — ${track.artist}` : ''}`, url });
      } catch {
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Скопируйте ссылку:', url);
    }
  }, [track, close, shareLoading]);

  const copyTrackLink = useCallback(async () => {
    if (shareLoading) return;
    setShareLoading(true);
    let url = buildTrackShareUrl(track);
    if (!url) url = await resolveTrackShareUrl(apiClient, track);
    setShareLoading(false);
    if (!url) return;
    close();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Скопируйте ссылку:', url);
    }
  }, [track, close, shareLoading]);

  const shareDisabled = shareLoading || !track;

  const handleTriggerKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(e);
    }
  }, [toggle]);

  return (
    <>
      <Trigger
        ref={triggerRef}
        role="button"
        tabIndex={-1}
        aria-label="Действия с треком"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
      >
        <FaEllipsisV />
      </Trigger>
      {open && pos ? createPortal(
        <Menu ref={menuRef} role="menu" style={{ left: pos.left, top: pos.top }}>
          <MenuItem type="button" role="menuitem" disabled={radioLoading || !(track?.artist)} onClick={startRadio}>
            <HiOutlineRadio size={16} />
            {radioLoading ? 'Загрузка…' : 'Радио по треку'}
          </MenuItem>
          <MenuItem type="button" role="menuitem" onClick={shareTrack} disabled={shareDisabled}>
            <FaShareAlt size={13} />
            Поделиться треком
          </MenuItem>
          <MenuItem type="button" role="menuitem" onClick={copyTrackLink} disabled={shareDisabled}>
            <FaLink size={13} />
            Скопировать ссылку
          </MenuItem>
          {Array.isArray(extraItems) ? extraItems.map((item) => (
            <MenuItem key={item.label} type="button" role="menuitem" onClick={() => { close(); void item.onClick(); }}>
              {item.icon}
              {item.label}
            </MenuItem>
          )) : null}
        </Menu>,
        document.body
      ) : null}
    </>
  );
}