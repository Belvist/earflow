import React, { useCallback, useMemo, useState } from 'react';
import styled from 'styled-components';
import { FaCheck, FaCheckCircle, FaExclamationTriangle, FaExternalLinkAlt, FaRegCopy } from 'react-icons/fa';

import { isSafePublicArtistUrl } from '../../../usecases/publicLinks';

export default function ManageHero({
  artistName,
  publicUrl,
  avatarSrc,
  bannerSrc,
  mfaEnabled,
  hasUnsavedMedia,
  bioDirty,
}) {
  const name = useMemo(() => {
    const n = (artistName || '').toString().trim();
    return n || 'Артист';
  }, [artistName]);

  const safePublicUrl = useMemo(() => {
    const raw = (publicUrl || '').toString().trim();
    return isSafePublicArtistUrl(raw) ? raw : '';
  }, [publicUrl]);

  const displayUrl = useMemo(() => {
    const raw = safePublicUrl;
    if (!raw) return '';
    try {
      const u = new URL(raw);
      return `${u.host}${u.pathname}`;
    } catch {
      return raw;
    }
  }, [safePublicUrl]);

  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!safePublicUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(safePublicUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = safePublicUrl;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [safePublicUrl]);

  const onOpenPublic = useCallback(() => {
    if (!safePublicUrl) return;
    window.open(safePublicUrl, '_blank', 'noopener,noreferrer');
  }, [safePublicUrl]);

  const dirty = hasUnsavedMedia || bioDirty;

  return (
    <Wrap>
      <HeroBg aria-hidden="true">
        {bannerSrc ? <BgImage src={bannerSrc} alt="" /> : null}
        <BgOverlay />
      </HeroBg>

      <Content>
        <AvatarBox>
          {avatarSrc ? <AvatarImg src={avatarSrc} alt="" /> : <AvatarFallback aria-hidden="true" />}
        </AvatarBox>

        <Info>
          <EyebrowRow>
            <Eyebrow>Публичная страница</Eyebrow>
            {dirty ? (
              <DirtyChip>
                <span />
                Несохранённые изменения
              </DirtyChip>
            ) : null}
          </EyebrowRow>

          <Name>{name}</Name>

          {safePublicUrl ? (
            <LinkRow>
              <LinkChip title={safePublicUrl}>
                <LinkText>{displayUrl}</LinkText>
              </LinkChip>
              <ChipButton type="button" onClick={onOpenPublic} aria-label="Открыть публичную страницу">
                <FaExternalLinkAlt size={12} aria-hidden="true" />
                <span>Открыть</span>
              </ChipButton>
              <ChipButton type="button" onClick={onCopy} aria-label="Скопировать ссылку">
                {copied ? <FaCheck size={12} aria-hidden="true" /> : <FaRegCopy size={12} aria-hidden="true" />}
                <span>{copied ? 'Скопировано' : 'Скопировать'}</span>
              </ChipButton>
            </LinkRow>
          ) : (
            <PendingRow>Публичная ссылка появится после верификации</PendingRow>
          )}

          <StatusRow>
            {mfaEnabled ? (
              <StatusChip $tone="ok">
                <FaCheckCircle size={11} aria-hidden="true" />
                2FA активна — можно сохранять изменения
              </StatusChip>
            ) : (
              <StatusChip $tone="warn">
                <FaExclamationTriangle size={11} aria-hidden="true" />
                Включите 2FA, чтобы сохранять изменения
              </StatusChip>
            )}
          </StatusRow>
        </Info>
      </Content>
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  width: 100%;
  border-radius: 22px;
  overflow: hidden;
  background: #080808;
  border: 0;
  box-shadow: none;
`;

const HeroBg = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
`;

const BgImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: none;
  transform: scale(1.25);
  opacity: 0.08;
`;

const BgOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 22px;
  align-items: center;
  padding: 24px;

  @media (max-width: 720px) {
    grid-template-columns: 96px 1fr;
    gap: 16px;
    padding: 18px;
  }
`;

const AvatarBox = styled.div`
  width: 140px;
  height: 175px;
  border-radius: 22px;
  overflow: hidden;
  background: #181818;
  border: 0;
  box-shadow: none;

  @media (max-width: 720px) {
    width: 96px;
    height: 120px;
    border-radius: 16px;
  }
`;

const AvatarImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const AvatarFallback = styled.div`
  width: 100%;
  height: 100%;
  background: #202020;
`;

const Info = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const EyebrowRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
`;

const DirtyChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  & > span {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.10);
  }
`;

const Name = styled.h1`
  margin: 0;
  font-size: 37px;
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.03em;
  color: #fff;
  word-break: break-word;

  @media (max-width: 900px) {
    font-size: 27px;
  }

  @media (max-width: 720px) {
    font-size: 21px;
  }
`;

const LinkRow = styled.div`
  margin-top: 2px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`;

const LinkChip = styled.div`
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  border: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.8);
  min-width: 0;
`;

const LinkText = styled.span`
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (max-width: 720px) {
    max-width: 180px;
  }
`;

const ChipButton = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:active {
    transform: translateY(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.7);
    outline-offset: 2px;
  }
`;

const PendingRow = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const StatusRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
`;

const StatusChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;

  ${(p) => (p.$tone === 'ok'
    ? `
    background: rgba(255, 255, 255, 0.12);
    border: 0;
    color: rgba(255, 255, 255, 0.90);
  `
    : `
    background: rgba(255, 255, 255, 0.10);
    border: 0;
    color: rgba(255, 255, 255, 0.78);
  `)}
`;
