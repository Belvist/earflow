import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaCheckCircle, FaChevronLeft, FaEllipsisH, FaPlay, FaRandom } from 'react-icons/fa';

const safeText = (v) => {
  if (v === null || v === undefined) return '';
  return String(v);
};

export default function ArtistPublicProfilePreview({ artistName, bio, heroSrc, avatarSrc, bannerSrc }) {
  const name = useMemo(() => {
    const n = safeText(artistName).trim();
    return n || 'Artist';
  }, [artistName]);

  const bioText = useMemo(() => safeText(bio).trim(), [bio]);

  const avatarUrl = useMemo(() => safeText(avatarSrc).trim(), [avatarSrc]);

  const bannerUrl = useMemo(() => {
    const b = safeText(bannerSrc).trim();
    if (b) return b;
    const h = safeText(heroSrc).trim();
    return h;
  }, [bannerSrc, heroSrc]);

  const coverUrl = avatarUrl || bannerUrl;

  const previewTracks = useMemo(() => ([
    { title: 'Популярный трек', duration: '0:00' },
    { title: 'Новый релиз', duration: '0:00' },
    { title: 'Трек артиста', duration: '0:00' },
  ]), []);

  return (
    <Page>
      <Hero>
        <HeroLayer>
          {bannerUrl ? <HeroImage src={bannerUrl} alt="" /> : null}
          <HeroOverlay />
        </HeroLayer>

        <Inner>
          <TopBar>
            <BackButton type="button" disabled aria-label="Назад">
              <FaChevronLeft size={12} aria-hidden="true" />
            </BackButton>
          </TopBar>

          <Layout>
            <AvatarWrap aria-hidden={!avatarUrl}>
              {avatarUrl ? <Avatar src={avatarUrl} alt="" /> : <AvatarPlaceholder />}
            </AvatarWrap>
            <HeroInfo>
              <VerifiedRow>
                <FaCheckCircle size={14} aria-hidden="true" />
                Подтверждённый артист
              </VerifiedRow>
              <Name>{name}</Name>
              <Stats $inline>
                <Stat $inline>
                  <StatValue>0</StatValue>
                  <StatLabel>треков</StatLabel>
                </Stat>
                <Dot aria-hidden="true" />
                <Stat $inline>
                  <StatValue>0</StatValue>
                  <StatLabel>прослушиваний в месяц</StatLabel>
                </Stat>
              </Stats>
            </HeroInfo>
          </Layout>
        </Inner>
      </Hero>

      <Actions>
        <PrimaryButton type="button" disabled>
          <FaPlay size={13} aria-hidden="true" />
          Играть
        </PrimaryButton>
        <SecondaryButton type="button" disabled>
          <FaRandom size={13} aria-hidden="true" />
          Перемешать
        </SecondaryButton>
        <SecondaryButton type="button" disabled>
          <FaEllipsisH size={13} aria-hidden="true" />
          Ещё
        </SecondaryButton>
      </Actions>

      <Content>
        <SectionTitle>Популярные треки</SectionTitle>
        {previewTracks.map((track, index) => (
          <TrackRow key={track.title}>
            <RankCell>{index + 1}</RankCell>
            <TrackCover>
              {coverUrl ? <TrackImage src={coverUrl} alt="" /> : null}
            </TrackCover>
            <TrackMeta>
              <TrackName>{track.title}</TrackName>
              <TrackSub>{name}</TrackSub>
            </TrackMeta>
            <TrackRight>{track.duration}</TrackRight>
          </TrackRow>
        ))}

        <DiscographyHeader>
          <SectionTitle>Дискография</SectionTitle>
          <Tabs role="tablist" aria-label="Фильтр дискографии">
            <Tab type="button" $active disabled>Все</Tab>
            <Tab type="button" disabled>Альбомы</Tab>
            <Tab type="button" disabled>Синглы и EP</Tab>
          </Tabs>
        </DiscographyHeader>
        <AlbumsRow>
          <AlbumCard>
            <AlbumCover>
              {coverUrl ? <AlbumImage src={coverUrl} alt="" /> : null}
            </AlbumCover>
            <AlbumMeta>
              <AlbumTitle>Релизы</AlbumTitle>
              <AlbumSub>{name}</AlbumSub>
            </AlbumMeta>
          </AlbumCard>
          <AlbumCard>
            <AlbumCover>
              {bannerUrl ? <AlbumImage src={bannerUrl} alt="" /> : null}
            </AlbumCover>
            <AlbumMeta>
              <AlbumTitle>Синглы</AlbumTitle>
              <AlbumSub>{name}</AlbumSub>
            </AlbumMeta>
          </AlbumCard>
        </AlbumsRow>

        <SectionTitle>Об артисте</SectionTitle>
        <AboutCard>
          {bioText ? <Bio>{bioText}</Bio> : <BioPlaceholder>Биография пока не добавлена.</BioPlaceholder>}
          <Stats>
            <Stat>
              <StatLabel>Статус</StatLabel>
              <StatValue>Подтверждён</StatValue>
            </Stat>
            <Stat>
              <StatLabel>Треки</StatLabel>
              <StatValue>0</StatValue>
            </Stat>
            <Stat>
              <StatLabel>Прослушиваний</StatLabel>
              <StatValue>0</StatValue>
            </Stat>
          </Stats>
        </AboutCard>
      </Content>
    </Page>
  );
}

const Page = styled.div`
  width: 100%;
  height: 100%;
  background: #000;
  color: #fff;
  font-family: 'Unbounded', system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial;
`;

const Hero = styled.div`
  position: relative;
  background: #000;
  overflow: hidden;
`;

const HeroLayer = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 340px;
  pointer-events: none;
  z-index: 0;
`;

const HeroImage = styled.img`
  width: 100%;
  height: 340px;
  object-fit: cover;
  filter: none;
  transform: scale(1.12) translate(0%, 4%);
  opacity: 0.5;
  box-shadow: none;
  display: block;
`;

const HeroOverlay = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 340px;
  background: rgba(0, 0, 0, 0.58);
`;

const Inner = styled.div`
  position: relative;
  padding: 18px 16px 12px;
  max-width: 980px;
  margin: 0 auto;
  z-index: 1;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  width: 100%;
`;

const BackButton = styled.button`
  width: 40px;
  height: 40px;
  border-radius: 999px;
  border: 0;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 1;
`;

const Layout = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 24px;
  align-items: start;
  margin-top: 18px;

  @media (max-width: 520px) {
    grid-template-columns: 64px 1fr;
    gap: 10px;
  }
`;

const AvatarWrap = styled.div`
  width: 140px;
  height: 175px;
  border-radius: 28px;
  overflow: hidden;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  flex: 0 0 auto;
  box-shadow: none;

  @media (max-width: 520px) {
    width: 64px;
    height: 80px;
    border-radius: 12px;
  }
`;

const Avatar = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const AvatarPlaceholder = styled.div`
  width: 100%;
  height: 100%;
  background: #080808;
`;

const HeroInfo = styled.div`
  min-width: 0;
  align-self: end;
`;

const VerifiedRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
`;

const Name = styled.div`
  font-size: 46px;
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;

  @media (max-width: 900px) {
    font-size: 36px;
  }

  @media (max-width: 520px) {
    font-size: 28px;
  }
`;

const Bio = styled.div`
  color: rgba(255, 255, 255, 0.7);
  font-size: 13px;
  line-height: 1.45;
  max-width: 820px;
  margin-bottom: 14px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
`;

const BioPlaceholder = styled.div`
  max-width: 720px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.62);
  font-size: 13px;
  line-height: 1.5;
  padding: 14px;
`;

const Stats = styled.div`
  margin-top: ${(p) => (p.$inline ? '14px' : '0')};
  display: ${(p) => (p.$inline ? 'flex' : 'grid')};
  align-items: ${(p) => (p.$inline ? 'center' : 'start')};
  flex-wrap: wrap;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${(p) => (p.$inline ? '8px 12px' : '14px')};
  flex: 1;

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
    gap: 10px;
  }
`;

const Stat = styled.div`
  display: flex;
  flex-direction: ${(p) => (p.$inline ? 'row' : 'column')};
  align-items: ${(p) => (p.$inline ? 'baseline' : 'flex-start')};
  gap: ${(p) => (p.$inline ? '5px' : '6px')};
  min-width: 0;
`;

const StatValue = styled.div`
  font-size: 14px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StatLabel = styled.div`
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Dot = styled.span`
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.35);
  display: inline-block;
  flex-shrink: 0;
`;

const Actions = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  max-width: 980px;
  margin: 0 auto;
  padding: 16px 16px 4px;
`;

const PrimaryButton = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  height: 38px;
  padding: 0 14px;
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  font-weight: 800;
  background: #fff;
  color: #000;
  cursor: default;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
`;

const SecondaryButton = styled.button`
  appearance: none;
  border: 0;
  border-radius: 999px;
  height: 38px;
  padding: 0 14px;
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  cursor: default;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;

const Content = styled.div`
  padding: 18px 16px 28px;
  max-width: 980px;
  margin: 0 auto;
`;

const SectionTitle = styled.div`
  margin-top: 18px;
  margin-bottom: 12px;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
`;

const TrackRow = styled.div`
  display: grid;
  grid-template-columns: 28px 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 8px 10px;
  border-radius: 10px;
  background: transparent;
  border: 0;

  &:nth-of-type(2) {
    background: rgba(255, 255, 255, 0.04);
  }
`;

const RankCell = styled.div`
  color: rgba(255, 255, 255, 0.42);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
`;

const TrackCover = styled.div`
  width: 48px;
  height: 60px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

const TrackImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const TrackMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

const TrackName = styled.div`
  font-weight: 900;
  font-size: 14px;
`;

const TrackSub = styled.div`
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  margin-top: 2px;
`;

const TrackRight = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
`;

const DiscographyHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 18px;
`;

const Tabs = styled.div`
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
`;

const Tab = styled.button`
  border: 0;
  border-radius: 999px;
  background: ${(p) => (p.$active ? '#fff' : 'transparent')};
  color: ${(p) => (p.$active ? '#000' : 'rgba(255,255,255,0.7)')};
  padding: 7px 12px;
  font-family: 'Unbounded', sans-serif;
  font-size: 10px;
  font-weight: 800;
`;

const AlbumsRow = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
`;

const AlbumCard = styled.div`
  border-radius: 16px;
  overflow: hidden;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
`;

const AlbumCover = styled.div`
  height: 130px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

const AlbumImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const AlbumMeta = styled.div`
  padding: 10px 12px;
`;

const AlbumTitle = styled.div`
  font-size: 14px;
  font-weight: 900;
`;

const AlbumSub = styled.div`
  margin-top: 2px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
`;

const AboutCard = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) 230px;
  gap: 20px;
  align-items: start;
  padding: 20px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.04);
  border: 0;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;
