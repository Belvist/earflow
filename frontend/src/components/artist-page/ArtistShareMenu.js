import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { FaEllipsisH, FaShareAlt, FaLink, FaCheck } from 'react-icons/fa';
import { HiOutlineRadio } from 'react-icons/hi2';

const Wrap = styled.div`
  position: relative;
`;

const TriggerButton = styled.button`
  width: 44px;
  height: 44px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 220px;
  background: rgba(22, 22, 22, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 6px;
  backdrop-filter: blur(16px);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.7);
  z-index: 40;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Item = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: -2px;
  }
`;

const CopiedHint = styled.span`
  margin-left: auto;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

function hasNativeShare() {
    try {
        return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    } catch {
        return false;
    }
}

async function copyToClipboard(text) {
    if (!text) return false;
    try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
    }
    try {
        if (typeof document !== 'undefined') {
            const el = document.createElement('textarea');
            el.value = text;
            el.setAttribute('readonly', '');
            el.style.position = 'fixed';
            el.style.opacity = '0';
            document.body.appendChild(el);
            el.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(el);
            return !!ok;
        }
    } catch {
    }
    return false;
}

export default function ArtistShareMenu({ artistName, shareUrl, onStartRadio }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const wrapRef = useRef(null);
    const copiedTimerRef = useRef(0);

    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    useEffect(() => {
        return () => {
            if (copiedTimerRef.current) {
                try { clearTimeout(copiedTimerRef.current); } catch { }
                copiedTimerRef.current = 0;
            }
        };
    }, []);

    const handleCopy = useCallback(async () => {
        const ok = await copyToClipboard(shareUrl);
        if (!ok) return;
        setCopied(true);
        if (copiedTimerRef.current) {
            try { clearTimeout(copiedTimerRef.current); } catch { }
        }
        copiedTimerRef.current = setTimeout(() => {
            setCopied(false);
            copiedTimerRef.current = 0;
        }, 1800);
    }, [shareUrl]);

    const handleNativeShare = useCallback(async () => {
        if (!hasNativeShare() || !shareUrl) return;
        try {
            await navigator.share({
                title: artistName ? `${artistName} — Earflow` : 'Earflow',
                text: artistName ? `Слушай ${artistName} на Earflow` : 'Earflow',
                url: shareUrl,
            });
            setOpen(false);
        } catch {
        }
    }, [artistName, shareUrl]);

    const handleRadio = useCallback(() => {
        setOpen(false);
        if (typeof onStartRadio === 'function') {
            try { onStartRadio(); } catch { }
        }
    }, [onStartRadio]);

    return (
        <Wrap ref={wrapRef}>
            <TriggerButton
                type="button"
                aria-label="Больше действий"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
            >
                <FaEllipsisH size={16} />
            </TriggerButton>

            {open && (
                <Menu role="menu">
                    {typeof onStartRadio === 'function' && (
                        <Item type="button" role="menuitem" onClick={handleRadio}>
                            <HiOutlineRadio size={18} />
                            Радио артиста
                        </Item>
                    )}
                    {hasNativeShare() && shareUrl && (
                        <Item type="button" role="menuitem" onClick={handleNativeShare}>
                            <FaShareAlt size={14} />
                            Поделиться
                        </Item>
                    )}
                    {shareUrl && (
                        <Item type="button" role="menuitem" onClick={handleCopy}>
                            <FaLink size={14} />
                            Скопировать ссылку
                            {copied && (
                                <CopiedHint>
                                    <FaCheck size={10} /> готово
                                </CopiedHint>
                            )}
                        </Item>
                    )}
                </Menu>
            )}
        </Wrap>
    );
}
