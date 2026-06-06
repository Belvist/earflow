import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaChevronLeft, FaCheckCircle } from 'react-icons/fa';
import CachedCoverImage, { CachedCoverImageBase } from '../CachedCoverImage';

const Wrapper = styled.div`
  position: relative;
  width: 100%;
  background: var(--ef-surface-main, #0d0d0d);
  overflow: hidden;
`;

const HeroLayer = styled.div`
  position: absolute;
  inset: 0 0 auto 0;
  height: 340px;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;

  @media (max-width: 520px) {
    height: 180px;
  }
`;

const HeroImage = styled(CachedCoverImageBase)`
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(38px);
  transform: scale(1.32) translate(0%, 9%);
  opacity: 0.55;
  box-shadow: 0 50px 100px rgba(0, 0, 0, 0.75);
`;

const HeroOverlay = styled.div`
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1300px 460px at 50% 12%, rgba(0,0,0,0.20) 0%, rgba(0,0,0,0.80) 68%, rgba(0,0,0,1) 100%),
    linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.68) 55%, rgba(0,0,0,1) 100%);
`;

const Inner = styled.div`
  position: relative;
  padding: 14px 12px 18px;
  max-width: 980px;
  margin: 0 auto;
  z-index: 1;

  @media (min-width: 521px) {
    padding: 18px 16px 24px;
  }
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
`;

const BackButton = styled.button`
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
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

const Layout = styled.div`
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 24px;
  align-items: end;
  margin-top: 22px;

  @media (max-width: 520px) {
    grid-template-columns: 64px 1fr;
    gap: 10px;
    margin-top: 10px;
  }
`;

const Avatar = styled.div`
  width: 140px;
  height: 175px;
  border-radius: 28px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);

  @media (max-width: 520px) {
    width: 64px;
    height: 80px;
    border-radius: 12px;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`;

const Info = styled.div`
  min-width: 0;
`;

const VerifiedRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
  margin-bottom: 8px;

  svg {
    color: #fff;
  }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1.03;
  color: #fff;
  word-break: break-word;

  @media (max-width: 900px) {
    font-size: 28px;
  }

  @media (max-width: 520px) {
    font-size: 18px;
  }
`;

const StatsRow = styled.div`
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  font-weight: 600;

  @media (max-width: 520px) {
    font-size: 10px;
    gap: 4px 10px;
    margin-top: 6px;
  }
`;

const StatItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  strong {
    color: #fff;
    font-weight: 800;
  }
`;

const Dot = styled.span`
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  display: inline-block;
  flex-shrink: 0;
`;

function formatCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '0';
  try {
    return new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function pluralRu(count, forms) {
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

export default function ArtistHeroSection({
  artistName,
  isVerified,
  bannerImageUrl,
  avatarImageUrl,
  trackCount,
  totalPlays,
  onBack,
}) {
  const bannerSrc = useMemo(() => (bannerImageUrl ? String(bannerImageUrl) : null), [bannerImageUrl]);
  const avatarSrc = useMemo(() => (avatarImageUrl ? String(avatarImageUrl) : bannerSrc), [avatarImageUrl, bannerSrc]);

  const trackCountNum = Number(trackCount);
  const safeTrackCount = Number.isFinite(trackCountNum) && trackCountNum > 0 ? trackCountNum : 0;
  const trackWord = pluralRu(safeTrackCount, ['трек', 'трека', 'треков']);

  const totalPlaysNum = Number(totalPlays);
  const hasPlays = totalPlays !== null && totalPlays !== undefined && Number.isFinite(totalPlaysNum);
  const safePlays = hasPlays && totalPlaysNum > 0 ? totalPlaysNum : 0;

  return (
    <Wrapper>
      <HeroLayer aria-hidden="true">
        <HeroImage src={bannerSrc} alt="" />
        <HeroOverlay />
      </HeroLayer>

      <Inner>
        <TopBar>
          <BackButton type="button" onClick={onBack} aria-label="Назад">
            <FaChevronLeft />
          </BackButton>
        </TopBar>

        <Layout>
          <Avatar>
            <CachedCoverImage src={avatarSrc} alt="" />
          </Avatar>

          <Info>
            {isVerified && (
              <VerifiedRow>
                <FaCheckCircle size={14} />
                Подтверждённый артист
              </VerifiedRow>
            )}
            <Title>{artistName || 'Артист'}</Title>
            <StatsRow>
              {safeTrackCount > 0 && (
                <StatItem>
                  <strong>{formatCompactNumber(safeTrackCount)}</strong> {trackWord}
                </StatItem>
              )}
              {safeTrackCount > 0 && hasPlays && <Dot aria-hidden="true" />}
              {hasPlays && (
                <StatItem>
                  <strong>{formatCompactNumber(safePlays)}</strong> прослушиваний в месяц
                </StatItem>
              )}
            </StatsRow>
          </Info>
        </Layout>
      </Inner>
    </Wrapper>
  );
}
