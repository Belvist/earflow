import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';

import Card from './Card';
import Button from './Button';
import AlbumUploadWizard from './AlbumUploadWizard';
import TrackUploadWizard from './TrackUploadWizard';
import TracksTable from './TracksTable';
import { artistPortalUsecase } from '../../usecases/artistPortalUsecase';
import { uploadTrackWithMeta } from '../../usecases/trackUploadUsecase';

const safeText = (v) => {
  if (v === null || v === undefined) return '';
  return String(v);
};

function normalizeTracksResponse(data) {
  let items = [];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && Array.isArray(data.items)) {
    items = data.items;
  }
  return items
    .map((t) => (t && typeof t === 'object' ? t : null))
    .filter(Boolean)
    .map((t) => ({
      id: safeText(t.id),
      title: safeText(t.title),
      artist: safeText(t.artist),
      album: safeText(t.album),
      genre: safeText(t.genre),
      year: (() => {
        if (t.year === null || t.year === undefined) return '';
        return safeText(t.year);
      })(),
      created_at: safeText(t.created_at ?? t.createdAt),
      updated_at: safeText(t.updated_at ?? t.updatedAt),
      plays: t.plays ?? t.play_count ?? t.playCount,
      playlist_adds: t.playlist_adds ?? t.playlistAdds,
      revenue: t.revenue ?? t.earnings,
      moderation_status: safeText(t.moderation_status || t.moderationStatus),
      cover_path: safeText(t.cover_path || t.coverPath),
      is_available: t.is_available === true,
      has_ebap: t.has_ebap === true,
      ebap_status: safeText(t.ebap_status ?? t.ebapStatus),
      has_hls: t.has_hls === true,
      hls_status: safeText(t.hls_status ?? t.hlsStatus),
    }));
}

export default function TracksPanel({ portal, compact }) {
  const nav = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);

  const [drafts, setDrafts] = useState([]);

  const [uploadMode, setUploadMode] = useState('track');

  const [busyId, setBusyId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const selectedCount = useMemo(() => items.length, [items]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await artistPortalUsecase.listTracks();
      if (!res.ok) {
        if (res.error.type === 'unauthorized') {
          setError('Требуется повторный вход');
          return;
        }
        if (res.error.type === 'forbidden') {
          nav('/onboarding', { replace: true });
          return;
        }
        setError('Ошибка загрузки треков');
        return;
      }
      setItems(normalizeTracksResponse(res.data));
    } finally {
      setLoading(false);
    }
  }, [nav]);

  useEffect(() => {
    void load();
  }, [load]);

  const withWriteGuard = useCallback(async (fn) => {
    await fn();
    return true;
  }, []);

  const createDraft = useCallback(({ file, meta }) => {
    const tempId = `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const draft = {
      id: tempId,
      file,
      meta: meta && typeof meta === 'object' ? meta : {},
      fileName: file && typeof file.name === 'string' ? file.name : 'audio',
      createdAt: Date.now(),
      lastError: '',
    };
    setDrafts((prev) => [draft, ...prev].slice(0, 20));
    return tempId;
  }, []);

  const updateDraftError = useCallback((id, msg) => {
    const safeId = safeText(id);
    setDrafts((prev) => prev.map((d) => (safeText(d.id) === safeId ? { ...d, lastError: safeText(msg) } : d)));
  }, []);

  const removeDraft = useCallback((id) => {
    const safeId = safeText(id);
    setDrafts((prev) => prev.filter((d) => safeText(d.id) !== safeId));
  }, []);

  const performUpload = useCallback(async ({ file, meta, draftId }) => {
    const safeDraftId = safeText(draftId);
    setUploadError('');
    setError('');

    return await withWriteGuard(async () => {
      setUploading(true);
      try {
        const result = await uploadTrackWithMeta({ file, meta });
        if (result.ok) {
          removeDraft(safeDraftId);
          await load();
          return true;
        }

        const msg = (() => {
          if (result.error?.type === 'csrf') return 'Ошибка защиты запроса. Обновите страницу и повторите.';
          if (result.error?.type === 'forbidden') return 'Доступ к кабинету артиста не подтверждён';
          if (result.error?.type === 'forbidden_generic') return 'Доступ запрещён';
          if (result.error?.type === 'unauthorized') return 'Требуется повторный вход';
          return 'Не удалось загрузить трек';
        })();
        updateDraftError(safeDraftId, msg);
        setUploadError(msg);
        return false;
      } catch {
        const msg = 'Не удалось загрузить трек';
        setUploadError(msg);
        updateDraftError(safeDraftId, msg);
        return false;
      } finally {
        setUploading(false);
      }
    });
  }, [load, removeDraft, updateDraftError, withWriteGuard]);

  const onUpload = useCallback(async ({ file, meta }) => {
    const draftId = createDraft({ file, meta });
    return await performUpload({ file, meta, draftId });
  }, [createDraft, performUpload]);

  const retryDraft = useCallback(async (draftId) => {
    const safeId = safeText(draftId);
    const draft = drafts.find((d) => safeText(d.id) === safeId);
    if (!draft || !draft.file) return;
    updateDraftError(safeId, '');
    await performUpload({ file: draft.file, meta: draft.meta, draftId: safeId });
  }, [drafts, performUpload, updateDraftError]);

  const doPublishToggle = async (id, nextState) => {
    await withWriteGuard(async () => {
      setBusyId(String(id));
      setError('');
      try {
        const res = nextState ? await artistPortalUsecase.publishTrack(id) : await artistPortalUsecase.unpublishTrack(id);
        if (res.ok) await load();
      } finally {
        setBusyId('');
      }
    });
  };

  const doDelete = async (id) => {
    await withWriteGuard(async () => {
      setBusyId(String(id));
      setError('');
      try {
        const res = await artistPortalUsecase.deleteTrack(id);
        if (res.ok) await load();
      } finally {
        setBusyId('');
      }
    });
  };

  const doSaveMeta = async (id, patch) => {
    const safeId = safeText(id);
    const current = items.find((t) => safeText(t.id) === safeId);
    if (!current) return;

    const payload = {
      ...(patch && patch.title !== undefined && safeText(patch.title) !== safeText(current.title) ? { title: patch.title } : {}),
      ...(patch && patch.album !== undefined && safeText(patch.album) !== safeText(current.album) ? { album: patch.album } : {}),
      ...(patch && patch.genre !== undefined && safeText(patch.genre) !== safeText(current.genre) ? { genre: patch.genre } : {}),
      ...(patch && patch.year !== undefined && safeText(patch.year) !== safeText(current.year) ? { year: patch.year } : {}),
    };
    if (!Object.keys(payload).length) return;

    await withWriteGuard(async () => {
      setBusyId(safeId);
      setError('');
      try {
        const res = await artistPortalUsecase.updateTrack(id, payload);
        if (res.ok) await load();
      } finally {
        setBusyId('');
      }
    });
  };

  const doUploadCover = async (id, file) => {
    if (!file) return;
    await withWriteGuard(async () => {
      setBusyId(String(id));
      setError('');
      try {
        const res = await artistPortalUsecase.uploadTrackCover(id, file);
        if (res.ok) await load();
      } finally {
        setBusyId('');
      }
    });
  };

  return (
    <Wrap>
      <Card>
        <HeaderRow>
          <div>
            <Title>Треки</Title>
            <Sub>Загрузка, публикация, обложки и метаданные</Sub>
          </div>
          {compact ? null : (
            <RightActions>
              <Button type="button" $size="sm" onClick={() => nav('/tracks')}>Все треки</Button>
            </RightActions>
          )}
        </HeaderRow>

        <UploadModeRow>
          <Button type="button" $size="sm" onClick={() => setUploadMode('track')} disabled={uploadMode === 'track' || uploading}>
            Трек
          </Button>
          <Button type="button" $size="sm" onClick={() => setUploadMode('album')} disabled={uploadMode === 'album' || uploading}>
            Альбом
          </Button>
        </UploadModeRow>

        {uploadMode === 'album' ? (
          <AlbumUploadWizard
            disabled={uploading}
            onComplete={async () => {
              await load();
            }}
          />
        ) : (
          <TrackUploadWizard disabled={uploading} error={uploadError} onSubmit={onUpload} />
        )}

        {drafts.length ? (
          <Drafts>
            <DraftsTitle>Черновики загрузки</DraftsTitle>
            <DraftList>
              {drafts.map((d) => (
                <DraftRow key={safeText(d.id)}>
                  <DraftInfo>
                    <DraftName>{safeText(d.meta?.title).trim() || safeText(d.fileName) || 'Трек'}</DraftName>
                    {safeText(d.lastError) ? <DraftError>{safeText(d.lastError)}</DraftError> : null}
                  </DraftInfo>
                  <DraftActions>
                    <Button type="button" onClick={() => retryDraft(d.id)} disabled={uploading}>Повторить</Button>
                    <Button type="button" onClick={() => removeDraft(d.id)} disabled={uploading}>Удалить</Button>
                  </DraftActions>
                </DraftRow>
              ))}
            </DraftList>
          </Drafts>
        ) : null}

        {error ? <ErrorText>{error}</ErrorText> : null}
      </Card>

      <Card>
        <TitleRow>
          <Title>Твои треки</Title>
          <Sub>{selectedCount} шт.</Sub>
        </TitleRow>

        {loading ? <div>Загрузка...</div> : null}
        {!loading && items.length === 0 ? <div>Нет треков</div> : null}

        {!loading && items.length ? (
          <TracksTable
            items={items}
            busyId={busyId}
            onEdit={doSaveMeta}
            onPublishToggle={doPublishToggle}
            onDelete={doDelete}
            onUploadCover={doUploadCover}
          />
        ) : null}
      </Card>

    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const HeaderRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
`;

const RightActions = styled.div`
  display: flex;
  gap: 10px;
`;

const UploadModeRow = styled.div`
  margin-top: 12px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const Title = styled.h2`
  font-size: 16px;
  font-weight: 900;
  margin: 0;
`;

const Sub = styled.div`
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.5;
  margin-top: 6px;
`;

const ErrorText = styled.div`
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.10);
  font-size: 13px;
`;

const Drafts = styled.div`
  margin-top: 14px;
  padding: 12px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DraftsTitle = styled.div`
  font-weight: 800;
  font-size: 13px;
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
`;

const DraftInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 220px;
`;

const DraftName = styled.div`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
`;

const DraftError = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.10);
`;

const DraftActions = styled.div`
  display: flex;
  gap: 10px;
`;

const TitleRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: baseline;
`;
