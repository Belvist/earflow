import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';

import Shell from '../layout/Shell';
import ArtistTopBar from '../components/ArtistTopBar';
import StepUpModal from '../components/StepUpModal';
import ImageCropModal from '../components/ImageCropModal';
import { ManageHero, ManageStats, ManageMediaCard, ManageBioCard, ManagePreviewCard } from '../components/manage';
import { useAuth } from '../../state/auth/AuthContext';
import { artistPortalUsecase } from '../../usecases/artistPortalUsecase';
import { buildPublicArtistUrl, coverUrlFromPath, isSafePublicArtistUrl } from '../../usecases/publicLinks';

const safeText = (v) => {
    if (v === null || v === undefined) return '';
    return String(v);
};

function classifyError(result, fallback) {
    const type = result?.error?.type;
    if (type === 'stepup_required') return { stepup: true };
    if (type === 'mfa_required') return { redirect: '/security/2fa', message: 'Для действия требуется 2FA' };
    if (type === 'forbidden') return { redirect: '/onboarding', message: 'Доступ к кабинету артиста не подтверждён' };
    if (type === 'csrf') return { message: 'Ошибка защиты запроса. Обновите страницу и повторите.' };
    if (type === 'forbidden_generic') return { message: 'Доступ запрещён' };
    if (type === 'unauthorized') return { message: 'Требуется повторный вход' };
    return { message: fallback || 'Не удалось выполнить действие' };
}

function readCoverPathFromCard(card, kind) {
    const c = card && typeof card === 'object' ? card : {};
    const map = {
        avatar: ['avatarCoverPath', 'avatar_cover_path', 'avatarKey', 'avatar_key', 'key', 'coverPath', 'cover_path'],
        banner: ['bannerCoverPath', 'banner_cover_path', 'bannerKey', 'banner_key', 'key', 'coverPath', 'cover_path'],
    };
    const keys = map[kind] || [];
    for (const k of keys) {
        const v = c[k];
        const s = safeText(v).trim();
        if (s) return s;
    }
    return '';
}

export default function ManageArtistPage() {
    const { portal, logout, refresh, refreshPortal } = useAuth();
    const nav = useNavigate();

    const [loading, setLoading] = useState(true);
    const [globalError, setGlobalError] = useState('');

    const [bio, setBio] = useState('');
    const [initialBio, setInitialBio] = useState('');
    const [heroCoverPath, setHeroCoverPath] = useState('');
    const [avatarCoverPath, setAvatarCoverPath] = useState('');
    const [bannerCoverPath, setBannerCoverPath] = useState('');

    const [avatarFile, setAvatarFile] = useState(null);
    const [bannerFile, setBannerFile] = useState(null);
    const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
    const [bannerPreviewUrl, setBannerPreviewUrl] = useState('');

    const [savingBio, setSavingBio] = useState(false);
    const [uploadingAvatar, setUploadingAvatar] = useState(false);
    const [uploadingBanner, setUploadingBanner] = useState(false);

    const [notice, setNotice] = useState(null);
    const [stepUpOpen, setStepUpOpen] = useState(false);

    const [cropOpen, setCropOpen] = useState(false);
    const [cropFile, setCropFile] = useState(null);
    const [cropKind, setCropKind] = useState('');
    const [bannerAspect, setBannerAspect] = useState(21 / 9);

    const pendingRef = useRef(null);

    const mfaEnabled = portal?.mfa?.enabled === true;
    const artistName = useMemo(() => safeText(portal?.artistName || portal?.artist_name).trim(), [portal]);
    const artistPublicId = useMemo(() => safeText(portal?.artistPublicId || portal?.artist_public_id || portal?.publicId || portal?.public_id).trim(), [portal]);
    const publicArtistUrl = useMemo(() => {
        const url = buildPublicArtistUrl({ artistPublicId, artistName });
        return isSafePublicArtistUrl(url) ? url : '';
    }, [artistPublicId, artistName]);
    const bioDirty = safeText(bio) !== safeText(initialBio);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 4500);
        return () => clearTimeout(timer);
    }, [notice]);

    useEffect(() => {
        if (!avatarFile) {
            setAvatarPreviewUrl('');
            return undefined;
        }
        const url = URL.createObjectURL(avatarFile);
        setAvatarPreviewUrl(url);
        return () => {
            try { URL.revokeObjectURL(url); } catch { /* noop */ }
        };
    }, [avatarFile]);

    useEffect(() => {
        if (!bannerFile) {
            setBannerPreviewUrl('');
            return undefined;
        }
        const url = URL.createObjectURL(bannerFile);
        setBannerPreviewUrl(url);
        return () => {
            try { URL.revokeObjectURL(url); } catch { /* noop */ }
        };
    }, [bannerFile]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            setLoading(true);
            setGlobalError('');
            try {
                const res = await artistPortalUsecase.loadArtistCard();
                if (cancelled) return;

                if (!res.ok) {
                    if (res.error?.type === 'unauthorized') {
                        await refresh();
                        setGlobalError('Требуется повторный вход');
                        return;
                    }
                    if (res.error?.type === 'forbidden') {
                        nav('/onboarding', { replace: true });
                        return;
                    }
                    setGlobalError('Не удалось загрузить карточку артиста');
                    return;
                }

                const card = res.data;
                const nextBio = safeText(card?.bio);
                setBio(nextBio);
                setInitialBio(nextBio);
                setHeroCoverPath(safeText(card?.heroCoverPath));
                setAvatarCoverPath(safeText(card?.avatarCoverPath));
                setBannerCoverPath(safeText(card?.bannerCoverPath));
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void run();
        return () => { cancelled = true; };
    }, [nav, refresh]);

    const avatarSrc = avatarPreviewUrl || coverUrlFromPath(avatarCoverPath);
    const bannerSrc = bannerPreviewUrl || coverUrlFromPath(bannerCoverPath) || coverUrlFromPath(heroCoverPath);
    const heroSrc = bannerSrc || avatarSrc;

    const handleActionError = useCallback((res, pending, fallback) => {
        const info = classifyError(res, fallback);
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

    const runAction = useCallback(async (pending) => {
        if (!pending || typeof pending !== 'object') return;

        if (!mfaEnabled) {
            setNotice({ kind: 'error', text: 'Для действия нужно включить 2FA' });
            nav('/security/2fa', { replace: true });
            return;
        }

        if (pending.kind === 'saveCard') {
            setSavingBio(true);
            try {
                const res = await artistPortalUsecase.saveArtistCard(pending.payload || {});
                if (res.ok) {
                    if (typeof pending.payload?.bio === 'string') setInitialBio(pending.payload.bio);
                    await refreshPortal();
                    setNotice({ kind: 'success', text: 'Изменения сохранены' });
                    return;
                }
                handleActionError(res, pending, 'Не удалось сохранить изменения');
            } finally {
                setSavingBio(false);
            }
            return;
        }

        if (pending.kind === 'uploadAvatar') {
            if (!pending.file) return;
            setUploadingAvatar(true);
            try {
                const res = await artistPortalUsecase.uploadAvatar(pending.file);
                if (res.ok) {
                    setAvatarFile(null);
                    const next = readCoverPathFromCard(res.data, 'avatar');
                    if (next) setAvatarCoverPath(next);
                    await refreshPortal();
                    setNotice({ kind: 'success', text: 'Аватар обновлён' });
                    return;
                }
                handleActionError(res, pending, 'Не удалось загрузить аватар');
            } finally {
                setUploadingAvatar(false);
            }
            return;
        }

        if (pending.kind === 'uploadBanner') {
            if (!pending.file) return;
            setUploadingBanner(true);
            try {
                const res = await artistPortalUsecase.uploadBanner(pending.file);
                if (res.ok) {
                    setBannerFile(null);
                    const next = readCoverPathFromCard(res.data, 'banner');
                    if (next) {
                        setBannerCoverPath(next);
                        setHeroCoverPath(next);
                    }
                    await refreshPortal();
                    setNotice({ kind: 'success', text: 'Баннер обновлён' });
                    return;
                }
                handleActionError(res, pending, 'Не удалось загрузить баннер');
            } finally {
                setUploadingBanner(false);
            }
        }
    }, [handleActionError, mfaEnabled, nav, refreshPortal]);

    const onPickAvatar = useCallback((file) => {
        if (!(file instanceof File)) return;
        setCropKind('avatar');
        setCropFile(file);
        setCropOpen(true);
    }, []);

    const onPickBanner = useCallback((file) => {
        if (!(file instanceof File)) return;
        setCropKind('banner');
        setCropFile(file);
        setCropOpen(true);
    }, []);

    const onCropConfirm = useCallback((f) => {
        if (cropKind === 'avatar') setAvatarFile(f);
        if (cropKind === 'banner') setBannerFile(f);
        setCropOpen(false);
        setCropFile(null);
        setCropKind('');
    }, [cropKind]);

    const onCropClose = useCallback(() => {
        setCropOpen(false);
        setCropFile(null);
        setCropKind('');
    }, []);

    const onUploadAvatar = useCallback(() => {
        if (!avatarFile) return;
        void runAction({ kind: 'uploadAvatar', file: avatarFile });
    }, [avatarFile, runAction]);

    const onUploadBanner = useCallback(() => {
        if (!bannerFile) return;
        void runAction({ kind: 'uploadBanner', file: bannerFile });
    }, [bannerFile, runAction]);

    const onSaveBio = useCallback(() => {
        const effectiveHero = safeText(bannerCoverPath).trim() || safeText(heroCoverPath).trim();
        const payload = {
            bio: safeText(bio),
            heroCoverPath: effectiveHero,
            avatarCoverPath: safeText(avatarCoverPath),
            bannerCoverPath: safeText(bannerCoverPath),
        };
        void runAction({ kind: 'saveCard', payload });
    }, [bio, avatarCoverPath, bannerCoverPath, heroCoverPath, runAction]);

    const onEnableMfa = useCallback(() => nav('/security/2fa'), [nav]);

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
                    {loading ? <LoadingCard>Загрузка карточки…</LoadingCard> : null}

                    {!loading && globalError ? <ErrorStrip>{globalError}</ErrorStrip> : null}

                    {!loading && !globalError ? (
                        <>
                            <ManageHero
                                artistName={artistName}
                                publicUrl={publicArtistUrl}
                                avatarSrc={avatarSrc}
                                bannerSrc={bannerSrc}
                                mfaEnabled={mfaEnabled}
                                hasUnsavedMedia={!!avatarFile || !!bannerFile}
                                bioDirty={bioDirty}
                            />

                            <ManageStats
                                bioLength={safeText(bio).length}
                                hasAvatar={!!safeText(avatarCoverPath).trim()}
                                hasBanner={!!safeText(bannerCoverPath).trim()}
                                mfaEnabled={mfaEnabled}
                            />

                            <ManageMediaCard
                                avatarSrc={avatarSrc}
                                bannerSrc={bannerSrc}
                                avatarFileName={avatarFile ? safeText(avatarFile.name) : ''}
                                bannerFileName={bannerFile ? safeText(bannerFile.name) : ''}
                                avatarPending={!!avatarFile}
                                bannerPending={!!bannerFile}
                                uploadingAvatar={uploadingAvatar}
                                uploadingBanner={uploadingBanner}
                                onPickAvatar={onPickAvatar}
                                onPickBanner={onPickBanner}
                                onUploadAvatar={onUploadAvatar}
                                onUploadBanner={onUploadBanner}
                            />

                            <ManageBioCard
                                bio={bio}
                                onChange={setBio}
                                onSave={onSaveBio}
                                saving={savingBio}
                                dirty={bioDirty}
                                mfaEnabled={mfaEnabled}
                                onEnableMfa={onEnableMfa}
                            />

                            <ManagePreviewCard
                                artistName={artistName}
                                bio={bio}
                                avatarSrc={avatarSrc}
                                bannerSrc={bannerSrc}
                                heroSrc={heroSrc}
                                publicUrl={publicArtistUrl}
                            />
                        </>
                    ) : null}
                </Wrap>
            </Main>

            <StepUpModal
                open={stepUpOpen}
                onClose={onStepUpClose}
                onSuccess={onStepUpSuccess}
            />

            <ImageCropModal
                open={cropOpen}
                file={cropFile}
                kind={cropKind}
                title={cropKind === 'banner' ? 'Обрезка баннера' : 'Обрезка аватара'}
                aspect={cropKind === 'banner' ? bannerAspect : 4 / 5}
                aspectOptions={cropKind === 'banner' ? [
                    { label: '21:9', value: 21 / 9, onSelect: (v) => setBannerAspect(Number(v)) },
                    { label: '16:9', value: 16 / 9, onSelect: (v) => setBannerAspect(Number(v)) },
                ] : []}
                onClose={onCropClose}
                onConfirm={onCropConfirm}
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

const LoadingCard = styled.div`
  padding: 36px 24px;
  border-radius: 22px;
  border: 0;
  background: rgba(255, 255, 255, 0.03);
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13.5px;
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
