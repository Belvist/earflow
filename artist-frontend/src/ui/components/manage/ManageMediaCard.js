import React from 'react';
import styled from 'styled-components';
import { FaImage, FaUserCircle, FaUpload } from 'react-icons/fa';

import Button from '../Button';

export default function ManageMediaCard({
  avatarSrc,
  bannerSrc,
  avatarFileName,
  bannerFileName,
  avatarPending,
  bannerPending,
  uploadingAvatar,
  uploadingBanner,
  onPickAvatar,
  onPickBanner,
  onUploadAvatar,
  onUploadBanner,
}) {
  const handleAvatarInput = (e) => {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    e.target.value = '';
    if (file && typeof onPickAvatar === 'function') onPickAvatar(file);
  };

  const handleBannerInput = (e) => {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    e.target.value = '';
    if (file && typeof onPickBanner === 'function') onPickBanner(file);
  };

  return (
    <Card>
      <Head>
        <TitleGroup>
          <Eyebrow>Обложки</Eyebrow>
          <Title>Аватар и баннер</Title>
          <Sub>
            Аватар — квадрат 4:5, баннер — широкий (21:9 или 16:9).
            Изменения применяются сразу после загрузки.
          </Sub>
        </TitleGroup>
      </Head>

      <Grid>
        <Section>
          <SectionHead>
            <SectionIcon aria-hidden="true"><FaUserCircle size={14} /></SectionIcon>
            <SectionTitle>Аватар</SectionTitle>
          </SectionHead>
          <AvatarBox aria-hidden={!avatarSrc}>
            {avatarSrc ? <PreviewImg src={avatarSrc} alt="" /> : <PreviewEmpty />}
          </AvatarBox>
          <Actions>
            <FileSlot>
              <HiddenInput
                id="manage-avatar-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleAvatarInput}
                disabled={uploadingAvatar}
              />
              <FilePickLabel htmlFor="manage-avatar-file" aria-disabled={uploadingAvatar}>
                Выбрать файл
              </FilePickLabel>
              <FileName title={avatarFileName || ''}>
                {avatarFileName || 'Файл не выбран'}
              </FileName>
            </FileSlot>
            <Button
              type="button"
              $variant="primary"
              onClick={onUploadAvatar}
              disabled={!avatarPending || uploadingAvatar}
            >
              <FaUpload size={12} style={{ marginRight: 8 }} aria-hidden="true" />
              {uploadingAvatar ? 'Загружаем…' : 'Загрузить аватар'}
            </Button>
          </Actions>
        </Section>

        <Section>
          <SectionHead>
            <SectionIcon aria-hidden="true"><FaImage size={14} /></SectionIcon>
            <SectionTitle>Баннер</SectionTitle>
          </SectionHead>
          <BannerBox aria-hidden={!bannerSrc}>
            {bannerSrc ? <PreviewImg src={bannerSrc} alt="" /> : <PreviewEmpty />}
          </BannerBox>
          <Actions>
            <FileSlot>
              <HiddenInput
                id="manage-banner-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleBannerInput}
                disabled={uploadingBanner}
              />
              <FilePickLabel htmlFor="manage-banner-file" aria-disabled={uploadingBanner}>
                Выбрать файл
              </FilePickLabel>
              <FileName title={bannerFileName || ''}>
                {bannerFileName || 'Файл не выбран'}
              </FileName>
            </FileSlot>
            <Button
              type="button"
              $variant="primary"
              onClick={onUploadBanner}
              disabled={!bannerPending || uploadingBanner}
            >
              <FaUpload size={12} style={{ marginRight: 8 }} aria-hidden="true" />
              {uploadingBanner ? 'Загружаем…' : 'Загрузить баннер'}
            </Button>
          </Actions>
        </Section>
      </Grid>
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

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 280px) minmax(0, 1fr);
  gap: 20px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    gap: 16px;
  }
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SectionIcon = styled.div`
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  border: 0;
  color: #fff;
`;

const SectionTitle = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
`;

const AvatarBox = styled.div`
  width: 100%;
  max-width: 220px;
  aspect-ratio: 4 / 5;
  border-radius: 16px;
  overflow: hidden;
  border: 0;
  background: rgba(0, 0, 0, 0.35);
`;

const BannerBox = styled.div`
  width: 100%;
  aspect-ratio: 21 / 9;
  border-radius: 16px;
  overflow: hidden;
  border: 0;
  background: rgba(0, 0, 0, 0.35);
`;

const PreviewImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const PreviewEmpty = styled.div`
  width: 100%;
  height: 100%;
  background: #181818;
`;

const Actions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const FileSlot = styled.div`
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 10px;
`;

const HiddenInput = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
`;

const FilePickLabel = styled.label`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s ease, border-color 0.15s ease;

  &[aria-disabled='true'] {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:hover:not([aria-disabled='true']) {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.22);
  }
`;

const FileName = styled.div`
  min-width: 0;
  color: rgba(255, 255, 255, 0.65);
  font-size: 11px;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
