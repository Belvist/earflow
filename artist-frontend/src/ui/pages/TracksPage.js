import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { FaChartBar } from 'react-icons/fa';

import Shell from '../layout/Shell';
import ArtistTopBar from '../components/ArtistTopBar';
import StepUpModal from '../components/StepUpModal';
import { TracksStats, TracksUploadCard, TracksListCard } from '../components/tracks';
import { useAuth } from '../../state/auth/AuthContext';
import { artistPortalUsecase } from '../../usecases/artistPortalUsecase';
import { uploadTrackWithMeta } from '../../usecases/trackUploadUsecase';
import { safeText } from '../components/dashboard/formatters';

function normalizeTrack(t) {
    if (!t || typeof t !== 'object') return null;
    return {
        id: safeText(t.id),
        title: safeText(t.title),
        artist: safeText(t.artist),
        album: safeText(t.album),
        genre: safeText(t.genre),
        year: t.year === null || t.year === undefined ? '' : safeText(t.year),
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
    };
}

function normalizeTracksResponse(data) {
    let items = [];
    if (Array.isArray(data)) items = data;
    else if (data && Array.isArray(data.items)) items = data.items;
    return items.map(normalizeTrack).filter(Boolean);
}

function classifyActionError(result, fallback) {
    const type = result?.error?.type;
    if (type === 'stepup_required') return { stepup: true };
    if (type === 'mfa_required') return { redirect: '/security/2fa', message: 'Для действия требуется 2FA' };
    if (type === 'forbidden') return { redirect: '/onboarding', message: 'Доступ к кабинету артиста не подтверждён' };
    if (type === 'csrf') return { message: 'Ошибка защиты запроса. Обновите страницу и повторите.' };
    if (type === 'forbidden_generic') return { message: 'Доступ запрещён' };
    if (type === 'unauthorized') return { message: 'Требуется повторный вход' };
    return { message: fallback || 'Не удалось выполнить действие' };
}

function diffTrackPatch(current, patch) {
    const payload = {};
    if (patch?.title !== undefined && safeText(patch.title) !== safeText(current.title)) payload.title = patch.title;
    if (patch?.album !== undefined && safeText(patch.album) !== safeText(current.album)) payload.album = patch.album;
    if (patch?.genre !== undefined && safeText(patch.genre) !== safeText(current.genre)) payload.genre = patch.genre;
    if (patch?.year !== undefined && safeText(patch.year) !== safeText(current.year)) payload.year = patch.year;
    return payload;
}

export default function TracksPage() {
    const { portal, logout } = useAuth();
    const nav = useNavigate();

    const [items, setItems] = useState([]);
    const [drafts, setDrafts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [globalError, setGlobalError] = useState('');
    const [notice, setNotice] = useState(null);
    const [stepUpOpen, setStepUpOpen] = useState(false);

    const pendingRef = useRef(null);
    const itemsRef = useRef(items);
    const draftsRef = useRef(drafts);

    useEffect(() => {
        itemsRef.current = items;
    }, [items]);

    useEffect(() => {
        draftsRef.current = drafts;
    }, [drafts]);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 4500);
        return () => clearTimeout(timer);
    }, [notice]);

    const load = useCallback(async () => {
        setLoading(true);
        setGlobalError('');
        try {
            const res = await artistPortalUsecase.listTracks();
            if (!res.ok) {
                if (res.error?.type === 'forbidden') {
                    nav('/onboarding', { replace: true });
                    return;
                }
                if (res.error?.type === 'mfa_required') {
                    nav('/security/2fa', { replace: true });
                    return;
                }
                if (res.error?.type === 'unauthorized') {
                    setGlobalError('Требуется повторный вход');
                    return;
                }
                setGlobalError('Ошибка загрузки треков');
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

    const handleActionError = useCallback((res, pending, fallbackMsg) => {
        const info = classifyActionError(res, fallbackMsg);
        if (info.stepup) {
            pendingRef.current = pending;
            setStepUpOpen(true);
            return;
        }
        if (info.redirect) {
            setNotice({ kind: 'error', text: info.message });
            nav(info.redirect, { replace: true });
            return;
        }
        setNotice({ kind: 'error', text: info.message });
    }, [nav]);

    const createDraft = useCallback(({ file, meta }) => {
        const id = `draft_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const draft = {
            id,
            file,
            meta: meta && typeof meta === 'object' ? meta : {},
            fileName: file && typeof file.name === 'string' ? file.name : 'audio',
            createdAt: Date.now(),
            lastError: '',
        };
        setDrafts((prev) => [draft, ...prev].slice(0, 20));
        return id;
    }, []);

    const updateDraftError = useCallback((id, msg) => {
        setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, lastError: safeText(msg) } : d)));
    }, []);

    const removeDraft = useCallback((id) => {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
    }, []);

    const runAction = useCallback(async (pending) => {
        if (!pending || typeof pending !== 'object') return;

        if (pending.kind === 'upload') {
            const draftId = pending.draftId || createDraft({ file: pending.file, meta: pending.meta });
            setUploading(true);
            setUploadError('');
            try {
                const result = await uploadTrackWithMeta({ file: pending.file, meta: pending.meta });
                if (result.ok) {
                    removeDraft(draftId);
                    await load();
                    setNotice({ kind: 'success', text: 'Трек загружен' });
                    return;
                }
                const info = classifyActionError(result, 'Не удалось загрузить трек');
                if (info.stepup) {
                    pendingRef.current = { ...pending, draftId };
                    setStepUpOpen(true);
                    return;
                }
                if (info.redirect) {
                    setNotice({ kind: 'error', text: info.message });
                    nav(info.redirect, { replace: true });
                    updateDraftError(draftId, info.message);
                    setUploadError(info.message);
                    return;
                }
                updateDraftError(draftId, info.message);
                setUploadError(info.message);
                setNotice({ kind: 'error', text: info.message });
            } finally {
                setUploading(false);
            }
            return;
        }

        if (pending.kind === 'publish') {
            setBusyId(String(pending.id));
            try {
                const res = pending.next
                    ? await artistPortalUsecase.publishTrack(pending.id)
                    : await artistPortalUsecase.unpublishTrack(pending.id);
                if (res.ok) {
                    await load();
                    setNotice({
                        kind: 'success',
                        text: pending.next ? 'Трек опубликован' : 'Трек снят с публикации',
                    });
                    return;
                }
                handleActionError(res, pending, pending.next ? 'Не удалось опубликовать трек' : 'Не удалось снять трек с публикации');
            } finally {
                setBusyId('');
            }
            return;
        }

        if (pending.kind === 'delete') {
            setBusyId(String(pending.id));
            try {
                const res = await artistPortalUsecase.deleteTrack(pending.id);
                if (res.ok) {
                    await load();
                    setNotice({ kind: 'success', text: 'Трек удалён' });
                    return;
                }
                handleActionError(res, pending, 'Не удалось удалить трек');
            } finally {
                setBusyId('');
            }
            return;
        }

        if (pending.kind === 'edit') {
            if (!pending.payload || !Object.keys(pending.payload).length) return;
            setBusyId(String(pending.id));
            try {
                const res = await artistPortalUsecase.updateTrack(pending.id, pending.payload);
                if (res.ok) {
                    await load();
                    setNotice({ kind: 'success', text: 'Изменения сохранены' });
                    return;
                }
                handleActionError(res, pending, 'Не удалось сохранить изменения');
            } finally {
                setBusyId('');
            }
            return;
        }

        if (pending.kind === 'cover') {
            if (!pending.file) return;
            setBusyId(String(pending.id));
            try {
                const res = await artistPortalUsecase.uploadTrackCover(pending.id, pending.file);
                if (res.ok) {
                    await load();
                    setNotice({ kind: 'success', text: 'Обложка обновлена' });
                    return;
                }
                handleActionError(res, pending, 'Не удалось загрузить обложку');
            } finally {
                setBusyId('');
            }
        }
    }, [createDraft, handleActionError, load, nav, removeDraft, updateDraftError]);

    const onUpload = useCallback(async ({ file, meta }) => {
        await runAction({ kind: 'upload', file, meta });
    }, [runAction]);

    const onRetryDraft = useCallback(async (draftId) => {
        const draft = draftsRef.current.find((d) => d.id === draftId);
        if (!draft || !draft.file) return;
        updateDraftError(draftId, '');
        await runAction({ kind: 'upload', file: draft.file, meta: draft.meta, draftId });
    }, [runAction, updateDraftError]);

    const onPublishToggle = useCallback((id, next) => {
        void runAction({ kind: 'publish', id: String(id), next: !!next });
    }, [runAction]);

    const onDelete = useCallback((id) => {
        void runAction({ kind: 'delete', id: String(id) });
    }, [runAction]);

    const onEdit = useCallback((id, patch) => {
        const current = itemsRef.current.find((t) => String(t.id) === String(id));
        if (!current) return;
        const payload = diffTrackPatch(current, patch);
        if (!Object.keys(payload).length) return;
        void runAction({ kind: 'edit', id: String(id), payload });
    }, [runAction]);

    const onUploadCover = useCallback((id, file) => {
        if (!file) return;
        void runAction({ kind: 'cover', id: String(id), file });
    }, [runAction]);

    const onAlbumComplete = useCallback(async () => {
        await load();
        setNotice({ kind: 'success', text: 'Альбом загружен' });
    }, [load]);

    const onStepUpSuccess = useCallback(async () => {
        setStepUpOpen(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (!pending) return;
        await runAction(pending);
    }, [runAction]);

    const onStepUpClose = useCallback(() => {
        setStepUpOpen(false);
        pendingRef.current = null;
    }, []);

    return (
        <Shell>
            <ArtistTopBar portal={portal} onLogout={logout} />

            <Main>
                <Wrap>
                    <PageHeader>
                        <HeaderCopy>
                            <Eyebrow>Каталог</Eyebrow>
                            <Title>Треки</Title>
                            <Sub>
                                Загружайте, публикуйте и редактируйте релизы.
                                Каждый трек появляется на странице артиста сразу после модерации.
                            </Sub>
                        </HeaderCopy>
                        <AnalyticsLink type="button" onClick={() => nav('/analytics')}>
                            <FaChartBar size={12} aria-hidden="true" />
                            Аналитика
                        </AnalyticsLink>
                    </PageHeader>

                    <TracksStats tracks={items} drafts={drafts} />

                    <TracksUploadCard
                        uploading={uploading}
                        uploadError={uploadError}
                        drafts={drafts}
                        onUpload={onUpload}
                        onRetryDraft={onRetryDraft}
                        onRemoveDraft={removeDraft}
                        onAlbumComplete={onAlbumComplete}
                    />

                    <TracksListCard
                        items={items}
                        loading={loading}
                        busyId={busyId}
                        onEdit={onEdit}
                        onPublishToggle={onPublishToggle}
                        onDelete={onDelete}
                        onUploadCover={onUploadCover}
                    />

                    {globalError ? <ErrorStrip>{globalError}</ErrorStrip> : null}
                </Wrap>
            </Main>

            <StepUpModal
                open={stepUpOpen}
                onClose={onStepUpClose}
                onSuccess={onStepUpSuccess}
            />

            {notice ? (
                <NoticeToast $kind={notice.kind} role="status" aria-live="polite">
                    {notice.text}
                </NoticeToast>
            ) : null}
        </Shell>
    );
}

const Main = styled.div`
  padding: 22px 18px 80px;

  @media (max-width: 720px) {
    padding: 16px 14px 80px;
  }
`;

const Wrap = styled.div`
  width: min(1080px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const PageHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 4px 0;

  @media (max-width: 720px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const HeaderCopy = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const Title = styled.h1`
  font-size: 25px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.03em;
  line-height: 1.02;
  margin: 0;

  @media (max-width: 720px) {
    font-size: 20px;
  }
`;

const Sub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.55;
  max-width: 560px;
`;

const AnalyticsLink = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 0;
  background: #fff;
  color: #000;
  font-family: inherit;
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
  letter-spacing: 0.02em;
  transition: transform 0.15s ease;
  flex-shrink: 0;

  &:hover {
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.85);
    outline-offset: 2px;
  }
`;

const ErrorStrip = styled.div`
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
`;

const NoticeToast = styled.div`
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  z-index: 200;
  pointer-events: none;
  box-shadow: none;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.92);

  @media (max-width: 720px) {
    left: 16px;
    right: 16px;
    transform: none;
    text-align: center;
  }
`;
