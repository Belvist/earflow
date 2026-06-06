import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { FaExternalLinkAlt, FaEye, FaDesktop, FaTabletAlt, FaMobileAlt } from 'react-icons/fa';

import ArtistPublicProfilePreview from '../ArtistPublicProfilePreview';
import DevicePreviewFrame from '../DevicePreviewFrame';
import { isSafePublicArtistUrl } from '../../../usecases/publicLinks';

const MODES = [
  { value: 'desktop', label: 'Desktop', Icon: FaDesktop },
  { value: 'tablet', label: 'Tablet', Icon: FaTabletAlt },
  { value: 'mobile', label: 'Mobile', Icon: FaMobileAlt },
];

export default function ManagePreviewCard({
  artistName,
  bio,
  avatarSrc,
  bannerSrc,
  heroSrc,
  publicUrl,
}) {
  const [mode, setMode] = useState('desktop');
  const safePublicUrl = useMemo(() => {
    const raw = typeof publicUrl === 'string' ? publicUrl.trim() : '';
    return isSafePublicArtistUrl(raw) ? raw : '';
  }, [publicUrl]);
  const hasLink = safePublicUrl.length > 0;

  return (
    <Card>
      <Head>
        <TitleGroup>
          <Eyebrow>
            <FaEye size={10} aria-hidden="true" />
            Предпросмотр
          </Eyebrow>
          <Title>Публичная страница</Title>
          <Sub>
            Так страница выглядит для слушателей.
            Обновляется сразу при редактировании медиа и биографии.
          </Sub>
        </TitleGroup>
        {hasLink ? (
          <OpenLink
            href={safePublicUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Открыть
            <FaExternalLinkAlt size={10} aria-hidden="true" />
          </OpenLink>
        ) : null}
      </Head>

      <ModeRow role="tablist" aria-label="Формат предпросмотра">
        {MODES.map(({ value, label, Icon }) => (
          <ModeBtn
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            $active={mode === value}
            onClick={() => setMode(value)}
          >
            <Icon size={11} aria-hidden="true" />
            {label}
          </ModeBtn>
        ))}
      </ModeRow>

      <FrameWrap>
        <DevicePreviewFrame mode={mode}>
          <ArtistPublicProfilePreview
            artistName={artistName}
            bio={bio}
            heroSrc={heroSrc}
            avatarSrc={avatarSrc}
            bannerSrc={bannerSrc}
          />
        </DevicePreviewFrame>
      </FrameWrap>
    </Card>
  );
}

const Card = styled.section`
  border-radius: 22px;
  border: 0;
  background: #080808;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 18px;
    gap: 14px;
  }
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const Title = styled.h2`
  font-size: 17px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;

  @media (max-width: 720px) {
    font-size: 14px;
  }
`;

const Sub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.5;
  max-width: 560px;
`;

const OpenLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-decoration: none;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
    color: #fff;
  }
`;

const ModeRow = styled.div`
  display: inline-flex;
  align-self: flex-start;
  padding: 4px;
  border-radius: 12px;
  border: 0;
  background: rgba(0, 0, 0, 0.35);
  gap: 4px;
  flex-wrap: wrap;
`;

const ModeBtn = styled.button`
  appearance: none;
  border: 0;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.12)' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : 'rgba(255, 255, 255, 0.7)')};
  padding: 8px 12px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }
`;

const FrameWrap = styled.div`
  border-radius: 18px;
  border: 0;
  background: rgba(0, 0, 0, 0.45);
  padding: 8px;
`;
