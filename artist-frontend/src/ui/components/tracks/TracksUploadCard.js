import React, { useState } from 'react';
import styled from 'styled-components';

import Button from '../Button';
import TrackUploadWizard from '../TrackUploadWizard';
import AlbumUploadWizard from '../AlbumUploadWizard';
import { safeText } from '../dashboard/formatters';

export default function TracksUploadCard({
  uploading,
  uploadError,
  drafts,
  onUpload,
  onRetryDraft,
  onRemoveDraft,
  onAlbumComplete,
}) {
  const [mode, setMode] = useState('track');

  return (
    <Card>
      <Head>
        <TitleGroup>
          <Eyebrow>Новый релиз</Eyebrow>
          <Title>Загрузите трек или альбом</Title>
          <Sub>
            WAV или FLAC, обложка 4:5, мастер до 500&nbsp;МБ.
            Публикация — сразу после модерации.
          </Sub>
        </TitleGroup>
        <Toggle role="tablist" aria-label="Тип загрузки">
          <ToggleBtn
            type="button"
            role="tab"
            aria-selected={mode === 'track'}
            $active={mode === 'track'}
            onClick={() => setMode('track')}
            disabled={uploading}
          >
            Трек
          </ToggleBtn>
          <ToggleBtn
            type="button"
            role="tab"
            aria-selected={mode === 'album'}
            $active={mode === 'album'}
            onClick={() => setMode('album')}
            disabled={uploading}
          >
            Альбом
          </ToggleBtn>
        </Toggle>
      </Head>

      <WizardSlot>
        {mode === 'album' ? (
          <AlbumUploadWizard disabled={uploading} onComplete={onAlbumComplete} />
        ) : (
          <TrackUploadWizard disabled={uploading} error={uploadError} onSubmit={onUpload} />
        )}
      </WizardSlot>

      {Array.isArray(drafts) && drafts.length ? (
        <Drafts>
          <DraftsTitle>Черновики загрузки</DraftsTitle>
          <DraftList>
            {drafts.map((d) => {
              const id = safeText(d.id);
              const name = safeText(d.meta?.title).trim() || safeText(d.fileName) || 'Трек';
              const err = safeText(d.lastError);
              return (
                <DraftRow key={id}>
                  <DraftInfo>
                    <DraftName>{name}</DraftName>
                    {err ? <DraftError>{err}</DraftError> : null}
                  </DraftInfo>
                  <DraftActions>
                    <Button
                      type="button"
                      $size="sm"
                      onClick={() => onRetryDraft(d.id)}
                      disabled={uploading}
                    >
                      Повторить
                    </Button>
                    <Button
                      type="button"
                      $size="sm"
                      onClick={() => onRemoveDraft(d.id)}
                      disabled={uploading}
                    >
                      Удалить
                    </Button>
                  </DraftActions>
                </DraftRow>
              );
            })}
          </DraftList>
        </Drafts>
      ) : null}
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
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  min-width: 0;
  flex: 1 1 280px;
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
`;

const Toggle = styled.div`
  display: inline-flex;
  padding: 4px;
  border-radius: 14px;
  border: 0;
  background: rgba(0, 0, 0, 0.35);
  gap: 4px;
  flex-shrink: 0;
`;

const ToggleBtn = styled.button`
  appearance: none;
  border: 0;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.12)' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : 'rgba(255, 255, 255, 0.7)')};
  padding: 8px 16px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover:not(:disabled) {
    color: #fff;
    background: rgba(255, 255, 255, 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const WizardSlot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Drafts = styled.div`
  padding: 14px;
  border-radius: 16px;
  border: 0;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const DraftsTitle = styled.div`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const DraftList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DraftRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.35);
  border: 0;
`;

const DraftInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1 1 220px;
`;

const DraftName = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DraftError = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.10);
`;

const DraftActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;
