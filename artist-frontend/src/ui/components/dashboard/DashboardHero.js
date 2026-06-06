import React, { useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { FaCheckCircle, FaExternalLinkAlt, FaRegCopy, FaCheck } from 'react-icons/fa';

import { safeText, coverUrlFromPath } from './formatters';
import { buildPublicArtistUrl, isSafePublicArtistUrl } from '../../../usecases/publicLinks';

export default function DashboardHero({ portal, meta, bannerCoverPath }) {
  const artistName = useMemo(() => safeText(portal?.artistName || portal?.artist_name).trim(), [portal]);
  const artistPublicId = useMemo(() => safeText(portal?.artistPublicId || portal?.artist_public_id || portal?.publicId || portal?.public_id).trim(), [portal]);
  const publicUrl = useMemo(() => {
    const url = buildPublicArtistUrl({ artistPublicId, artistName });
    return isSafePublicArtistUrl(url) ? url : '';
  }, [artistPublicId, artistName]);

  const isVerified = portal?.isArtist === true;

  const avatarPath = safeText(portal?.artistCard?.avatarCoverPath).trim() || safeText(meta?.avatarCoverPath).trim();
  const heroPath = safeText(bannerCoverPath).trim()
    || safeText(portal?.artistCard?.bannerCoverPath).trim()
    || safeText(portal?.artistCard?.heroCoverPath).trim()
    || safeText(meta?.bannerCoverPath).trim()
    || safeText(meta?.heroCoverPath).trim();

  const avatarUrl = coverUrlFromPath(avatarPath) || coverUrlFromPath(heroPath);
  const heroUrl = coverUrlFromPath(heroPath) || avatarUrl;

  const displayUrl = useMemo(() => {
    if (!publicUrl) return '';
    try {
      const u = new URL(publicUrl);
      return `${u.host}${u.pathname}`;
    } catch {
      return publicUrl;
    }
  }, [publicUrl]);

  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    if (!publicUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicUrl);
      } else {
        const ta = document.createElement('textarea');
        ta.value = publicUrl;
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
  }, [publicUrl]);

  const onOpenPublic = useCallback(() => {
    if (!publicUrl) return;
    window.open(publicUrl, '_blank', 'noopener,noreferrer');
  }, [publicUrl]);

  return (
    <Wrap>
      <HeroBg aria-hidden="true">
        {heroUrl ? <BgImage src={heroUrl} alt="" /> : null}
        <BgOverlay />
      </HeroBg>

      <Content>
        <AvatarBox>
          {avatarUrl ? <AvatarImg src={avatarUrl} alt="" /> : <AvatarFallback aria-hidden="true" />}
        </AvatarBox>

        <Info>
          {isVerified ? (
            <VerifiedRow>
              <FaCheckCircle size={13} aria-hidden="true" />
              Подтверждённый артист
            </VerifiedRow>
          ) : null}
          <Name>{artistName || 'Артист'}</Name>

          {publicUrl ? (
            <LinkRow>
              <LinkChip title={publicUrl}>
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

const VerifiedRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);

  svg {
    color: #fff;
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
