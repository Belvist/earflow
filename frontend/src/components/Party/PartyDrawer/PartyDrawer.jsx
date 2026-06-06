/**
 * PartyDrawer — панель Party: desktop справа, mobile bottom sheet.
 * Разметка: шапка вне прокрутки, контент в скролле с min-height:0 (стабильно на iOS).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import apiClient from '../../../api/client';
import useAuth from '../../../hooks/useAuth';
import { rememberPartyWsTicket } from '../../../hooks/partyConnection';
import { usePlayer } from '../../../context/PlayerContext';
import BottomSheet from '../../BottomSheet';
import { MOBILE_CHROME_OFFSET_PX, MOBILE_SHEET_CONTENT_PADDING_PX } from '../../../styles/mediaCover';
import formatPartyError from './formatPartyError';
import { formatInviteCodeForDisplay } from './inviteCodeDisplay';
import { buildAppPartyInviteUrl, extractJoinTokenFromApiPath } from './partyShareUrl';
import {
  AddCurrentTrackButton,
  CloseButton,
  CodeInput,
  Description,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderArea,
  DrawerPanel,
  DrawerTitle,
  EmptyQueueHint,
  EndSessionPill,
  ErrorMessage,
  FormGroup,
  Input,
  InviteCodeMuted,
  InviteError,
  Label,
  LeaveButton,
  MutedCodeHint,
  NowPlayingArtist,
  NowPlayingBar,
  NowPlayingCover,
  NowPlayingText,
  NowPlayingTitle,
  Participant,
  ParticipantAvatar,
  ParticipantInfo,
  ParticipantName,
  ParticipantRole,
  ParticipantsPanel,
  ParticipantsList,
  PartyNameCard,
  PartyNameLine,
  PartyNameTextCol,
  PartyStatusInline,
  QueueCover,
  QueueInfo,
  QueueItem,
  QueueMeta,
  QueueRemoveButton,
  QueueSection,
  QueueTitle,
  RetryButton,
  RoleBadge,
  RoleRow,
  Section,
  SectionTitle,
  SharePillButton,
  SharePillRow,
  Spacer8,
  Spinner,
  StatusDotLg,
  SubmitButton,
  SubtleSectionLabel,
  Tab,
  TabsContainer,
} from './PartyDrawer.styles';

export default function PartyDrawer({ isOpen, onClose }) {
  const player = usePlayer();
  const { user } = useAuth();
  const {
    partyMode,
    partyInfo,
    exitPartyMode,
    currentTrack,
    activePartyId,
    setActivePartyId,
    party,
  } = player;

  const username = user?.username || user?.firstName || user?.first_name || 'Участник';

  const [activeTab, setActiveTab] = useState('create');
  const [view, setView] = useState('menu');

  const [partyTitle, setPartyTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState(null);

  const errorText = useMemo(() => formatPartyError(error), [error]);

  const [inviteCode, setInviteCode] = useState('');
  const [inviteLinkPath, setInviteLinkPath] = useState('');
  const [inviteExpiresAt, setInviteExpiresAt] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState(null);
  /** 'code' | 'link' | null — краткая подсветка после копирования */
  const [copyFlash, setCopyFlash] = useState(null);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const effectivePartyId = activePartyId || partyInfo?.partyId || party?.party?.id || null;

  const clearInviteState = useCallback(() => {
    setInviteCode('');
    setInviteLinkPath('');
    setInviteExpiresAt('');
  }, []);

  const applyInviteResponse = useCallback((res) => {
    const invite = res?.invite || {};
    const code = invite.code || res?.code || '';
    const linkP = invite.link;
    const expiresAt = invite.expiresAt || res?.expiresAt || '';

    if (typeof linkP === 'string' && linkP.trim()) {
      setInviteLinkPath(String(linkP).trim());
    }
    if (!code) {
      clearInviteState();
      return false;
    }

    setInviteCode(String(code));
    setInviteExpiresAt(typeof expiresAt === 'string' && expiresAt.trim() ? expiresAt.trim() : '');
    return true;
  }, [clearInviteState]);

  const findRecoverableHostedPartyId = useCallback(async () => {
    try {
      const res = await apiClient.getUserParties();
      const parties = Array.isArray(res?.parties) ? res.parties : [];
      const live = parties
        .map((p) => (p?.id != null ? String(p.id).trim() : ''))
        .filter(Boolean);
      if (live.length !== 1) return '';
      return live[0];
    } catch {
      return '';
    }
  }, []);

  const resetMissingParty = useCallback((missingPid) => {
    const pid = missingPid != null ? String(missingPid).trim() : '';
    const currentPid = effectivePartyId != null ? String(effectivePartyId).trim() : '';
    if (pid && currentPid && pid !== currentPid) return;
    party?.disconnect?.();
    exitPartyMode();
    setActivePartyId(null);
    clearInviteState();
    setInviteLoading(false);
    setView('menu');
  }, [clearInviteState, effectivePartyId, exitPartyMode, party, setActivePartyId]);

  const requestInviteCode = useCallback(async (partyId) => {
    const pid = partyId ? String(partyId) : '';
    if (!pid) return;

    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await apiClient.createPartyInvite(pid);
      const resolvedPid = res?.partyId != null ? String(res.partyId).trim() : '';
      if (resolvedPid && resolvedPid !== pid) {
        setActivePartyId(resolvedPid);
      }
      if (!applyInviteResponse(res)) {
        setInviteError('Не удалось получить код приглашения');
      }
    } catch (e) {
      clearInviteState();
      const st = e && typeof e === 'object' ? (e.status ?? e.responseStatus) : null;
      if (st === 404) {
        const recoveredPid = await findRecoverableHostedPartyId();
        if (recoveredPid) {
          setActivePartyId(recoveredPid);
          setView('active');
          try {
            const retryRes = await apiClient.createPartyInvite(recoveredPid);
            const retryResolvedPid = retryRes?.partyId != null ? String(retryRes.partyId).trim() : '';
            if (retryResolvedPid && retryResolvedPid !== recoveredPid) {
              setActivePartyId(retryResolvedPid);
            }
            if (applyInviteResponse(retryRes)) return;
          } catch {
            /* fall through to the not-found state below */
          }
        }
        resetMissingParty(pid);
        setError('Сессия не найдена. Создайте сессию заново.');
        setInviteError('Сессия не найдена. Создайте сессию заново.');
      } else if (st === 403) {
        setInviteError('Нет прав на приглашение. Обновите страницу и войдите снова.');
      } else {
        const msg = e && typeof e === 'object' && typeof e.message === 'string' ? e.message : '';
        setInviteError(msg || 'Не удалось получить код приглашения');
      }
    } finally {
      setInviteLoading(false);
    }
  }, [applyInviteResponse, clearInviteState, findRecoverableHostedPartyId, resetMissingParty, setActivePartyId]);

  useEffect(() => {
    if (party?.isConnected && activePartyId) {
      setView('active');
    }
  }, [party?.isConnected, activePartyId]);

  useEffect(() => {
    if (!partyMode && view === 'active') {
      setInviteCode('');
      setInviteLinkPath('');
      setInviteExpiresAt('');
      setInviteError(null);
      setInviteLoading(false);
      setView('menu');
    }
  }, [partyMode, view]);

  useEffect(() => {
    if (party?.error) {
      setError(party.error);
      return;
    }
    if (party?.isConnected) {
      setError(null);
    }
  }, [party?.error, party?.isConnected]);

  useEffect(() => {
    if (!isOpen || !partyMode) return;
    const pid = activePartyId || partyInfo?.partyId;
    if (!pid) return;
    setView('active');
    if (partyInfo?.isHost && !inviteCode && !inviteLoading && !inviteError) {
      void requestInviteCode(String(pid));
    }
  }, [
    isOpen,
    partyMode,
    activePartyId,
    partyInfo?.partyId,
    partyInfo?.isHost,
    inviteCode,
    inviteLoading,
    inviteError,
    requestInviteCode,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (!party?.isHost || !party?.isConnected || !effectivePartyId) return;
    if (inviteCode || inviteLoading || inviteError) return;
    void requestInviteCode(effectivePartyId);
  }, [
    isOpen,
    party?.isHost,
    party?.isConnected,
    effectivePartyId,
    inviteCode,
    inviteLoading,
    inviteError,
    requestInviteCode,
  ]);

  useEffect(() => {
    if (!isOpen || !party?.isHost || !party?.isConnected || !effectivePartyId || !inviteExpiresAt) {
      return undefined;
    }
    const expiresMs = Date.parse(inviteExpiresAt);
    if (!Number.isFinite(expiresMs)) return undefined;

    const scheduleMs = expiresMs - Date.now() - 30000;
    if (scheduleMs <= 0) {
      setInviteCode('');
      setInviteLinkPath('');
      setInviteExpiresAt('');
      if (!inviteLoading) {
        void requestInviteCode(effectivePartyId);
      }
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setInviteCode('');
      setInviteLinkPath('');
      setInviteExpiresAt('');
      void requestInviteCode(effectivePartyId);
    }, Math.max(1000, scheduleMs));
    return () => window.clearTimeout(timer);
  }, [
    isOpen,
    party?.isHost,
    party?.isConnected,
    effectivePartyId,
    inviteExpiresAt,
    inviteLoading,
    requestInviteCode,
  ]);

  const handleCreateParty = useCallback(
    async (e) => {
      e.preventDefault();
      setIsCreating(true);
      setError(null);
      setInviteCode('');
      setInviteLinkPath('');
      setInviteExpiresAt('');
      setInviteError(null);

      try {
        const response = await apiClient.createParty({
          title: partyTitle.trim() || 'Совместное прослушивание',
          hostName: username,
        });

        if (response.success && response.party) {
          const pid = String(response.party.id);
          rememberPartyWsTicket(pid, response.wsToken || response.ticket || '');
          setActivePartyId(pid);
          setView('active');
          if (response.invite?.link) {
            setInviteLinkPath(String(response.invite.link).trim());
          }
          const createdInviteCode = response.inviteCode || response.invite?.code || '';
          if (createdInviteCode) {
            setInviteCode(String(createdInviteCode));
            setInviteExpiresAt(
              typeof response.invite?.expiresAt === 'string' && response.invite.expiresAt.trim()
                ? response.invite.expiresAt.trim()
                : ''
            );
          } else {
            setInviteExpiresAt('');
            void requestInviteCode(pid);
          }
        }
      } catch (err) {
        if (err.message?.includes('Maximum') || err.code === 'MAX_PARTIES_EXCEEDED') {
          setError('Достигнут лимит сессий. Очищаем…');
          try {
            await apiClient.cleanupUserParties();
            setError(null);
            const retryResponse = await apiClient.createParty({
              title: partyTitle.trim() || 'Совместное прослушивание',
              hostName: username,
            });
            if (retryResponse.success && retryResponse.party) {
              const pid2 = String(retryResponse.party.id);
              rememberPartyWsTicket(pid2, retryResponse.wsToken || retryResponse.ticket || '');
              setActivePartyId(pid2);
              setView('active');
              if (retryResponse.invite?.link) {
                setInviteLinkPath(String(retryResponse.invite.link).trim());
              }
              const retryInviteCode = retryResponse.inviteCode || retryResponse.invite?.code || '';
              if (retryInviteCode) {
                setInviteCode(String(retryInviteCode));
                setInviteExpiresAt(
                  typeof retryResponse.invite?.expiresAt === 'string' && retryResponse.invite.expiresAt.trim()
                    ? retryResponse.invite.expiresAt.trim()
                    : ''
                );
              } else {
                setInviteExpiresAt('');
                void requestInviteCode(pid2);
              }
            }
          } catch {
            setError('Не удалось очистить старые сессии. Попробуйте позже.');
          }
        } else {
          setError(err.message || 'Не удалось создать сессию');
        }
      } finally {
        setIsCreating(false);
      }
    },
    [partyTitle, username, setActivePartyId, requestInviteCode]
  );

  const handleJoinParty = useCallback(
    async (e) => {
      e.preventDefault();
      const code = inputCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

      if (code.length < 8) {
        setError('Введите полный код');
        return;
      }

      setIsJoining(true);
      setError(null);

      try {
        const formattedCode = `${code.slice(0, 4)}-${code.slice(4, 8)}`;
        const response = await apiClient.joinPartyByCode(formattedCode, username);

        if (response.success && response.party) {
          const pid = String(response.party.id);
          rememberPartyWsTicket(pid, response.wsToken || response.ticket || '');
          setActivePartyId(pid);
          setInputCode('');
          setView('active');
        }
      } catch (err) {
        const st = err && typeof err === 'object' ? (err.status ?? err.responseStatus) : null;
        if (st === 404) {
          setError('Код не найден или срок приглашения истёк. Попросите у хоста новый код.');
        } else if (st === 403) {
          setError('Доступ запрещён. Обновите страницу или войдите снова (защита сессии).');
        } else {
          setError(err.message || 'Неверный код');
        }
      } finally {
        setIsJoining(false);
      }
    },
    [inputCode, username, setActivePartyId]
  );

  const handleLeaveParty = useCallback(async () => {
    const pid = effectivePartyId ? String(effectivePartyId) : '';
    if (pid) {
      try {
        if (party?.isHost) {
          await apiClient.endParty(pid);
        } else {
          await apiClient.leaveParty(pid);
        }
      } catch {
        /* best-effort */
      }
    }

    party?.disconnect?.();
    exitPartyMode();
    setActivePartyId(null);
    setInviteCode('');
    setInviteLinkPath('');
    setInviteExpiresAt('');
    setInviteError(null);
    setInviteLoading(false);
    setView('menu');
  }, [effectivePartyId, party, exitPartyMode, setActivePartyId]);

  const copyPayload = useMemo(
    () => formatInviteCodeForDisplay(inviteCode) || String(inviteCode || '').replace(/\s+/g, ''),
    [inviteCode]
  );

  const appShareUrl = useMemo(() => {
    const tok = extractJoinTokenFromApiPath(inviteLinkPath);
    if (!tok) return '';
    return buildAppPartyInviteUrl(tok);
  }, [inviteLinkPath]);

  const writeClipboard = useCallback((text, onDone) => {
    if (!text) return;
    const done = onDone || (() => undefined);
    Promise.resolve(navigator.clipboard.writeText(text))
      .then(() => {
        done();
      })
      .catch(() => {
        try {
          const el = document.createElement('textarea');
          el.value = text;
          el.setAttribute('readonly', '');
          el.style.position = 'fixed';
          el.style.left = '-9999px';
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
          done();
        } catch {
          /* ignore */
        }
      });
  }, []);

  const handleCopyCode = useCallback(() => {
    if (!copyPayload) return;
    writeClipboard(copyPayload, () => {
      setCopyFlash('code');
      setTimeout(() => setCopyFlash((f) => (f === 'code' ? null : f)), 2000);
    });
  }, [copyPayload, writeClipboard]);

  const handleCopyLink = useCallback(() => {
    if (!appShareUrl) return;
    writeClipboard(appShareUrl, () => {
      setCopyFlash('link');
      setTimeout(() => setCopyFlash((f) => (f === 'link' ? null : f)), 2000);
    });
  }, [appShareUrl, writeClipboard]);

  const handleCodeChange = useCallback((e) => {
    const value = e.target.value
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8);
    setInputCode(value);
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    setPartyTitle('');
    setInputCode('');
    setError(null);
    onClose();
  }, [onClose]);

  const partyData = useMemo(() => party?.party || {}, [party?.party]);
  const participantsList = party?.participants || [];
  const queueList = Array.isArray(party?.queue) ? party.queue : [];
  const canAddToQueue =
    typeof party?.canPerformAction === 'function' ? party.canPerformAction('addToQueue') : true;
  const canRemoveFromQueue =
    typeof party?.canPerformAction === 'function' ? party.canPerformAction('removeFromQueue') : false;
  const nextQueueItem = queueList.length > 0 ? queueList[0] : null;
  const restQueue = queueList.length > 1 ? queueList.slice(1) : [];
  const currentInQueue = !!(
    currentTrack?.id && queueList.some((q) => q && String(q.id) === String(currentTrack.id))
  );

  const handleAddCurrentTrackToQueue = useCallback(() => {
    if (!currentTrack?.id) return;
    if (!party?.addToQueue) return;

    const coverCandidate =
      typeof currentTrack.cover_path === 'string'
        ? currentTrack.cover_path
        : typeof currentTrack.coverPath === 'string'
          ? currentTrack.coverPath
          : '';

    const payload = {
      id: currentTrack.id,
      title: currentTrack.title || 'Unknown',
      artist: currentTrack.artist || 'Unknown Artist',
      cover: typeof coverCandidate === 'string' && coverCandidate.trim() ? coverCandidate.trim() : null,
      duration: currentTrack.duration || currentTrack.durationSeconds || 0,
    };
    party.addToQueue(payload);
  }, [
    party,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.cover_path,
    currentTrack?.coverPath,
    currentTrack?.duration,
    currentTrack?.durationSeconds,
  ]);

  const handleRemoveQueueAt = useCallback(
    (index, item) => {
      if (typeof party?.removeFromQueue !== 'function') return;
      if (!canRemoveFromQueue) return;
      party.removeFromQueue(item?.queueId ? item.queueId : index);
    },
    [party, canRemoveFromQueue]
  );

  useEffect(() => {
    if (activePartyId) return;
    const pid = partyData && partyData.id ? String(partyData.id) : '';
    if (!pid) return;
    setActivePartyId(pid);
  }, [activePartyId, partyData, setActivePartyId]);

  const displayInvite = formatInviteCodeForDisplay(inviteCode);

  const nowPlayingCover =
    currentTrack && (currentTrack.cover_path || currentTrack.coverPath || currentTrack.cover)
      ? apiClient.getCoverUrl({ cover: currentTrack.cover_path || currentTrack.coverPath || currentTrack.cover })
      : null;

  const renderActiveParty = () => (
    <>
      <PartyNameCard>
        <PartyNameTextCol>
          <PartyNameLine>{partyData.title || 'Совместное прослушивание'}</PartyNameLine>
          <PartyStatusInline>
            {party?.isConnected ? 'Подключено' : 'Подключение...'}
          </PartyStatusInline>
        </PartyNameTextCol>
        <StatusDotLg $connected={!!party?.isConnected} aria-hidden />
      </PartyNameCard>

      <RoleRow>
        <RoleBadge $isHost={party?.isHost}>
          {party?.isHost ? 'Ведущий' : 'Участник'}
        </RoleBadge>
      </RoleRow>

      {errorText ? (
        <ErrorMessage>
          {errorText}
          {typeof party?.forceReconnect === 'function' ? (
            <RetryButton
              type="button"
              onClick={() => {
                setError(null);
                party.forceReconnect();
              }}
            >
              Переподключиться
            </RetryButton>
          ) : null}
        </ErrorMessage>
      ) : null}

      {party?.isHost && (
        <>
          {inviteError ? (
            <>
              <InviteError style={{ marginBottom: 8 }}>{String(inviteError)}</InviteError>
              <RetryButton
                type="button"
                onClick={() => {
                  if (activePartyId) void requestInviteCode(activePartyId);
                }}
              >
                Повторить
              </RetryButton>
            </>
          ) : null}
          <SharePillRow>
            <SharePillButton
              type="button"
              disabled={!appShareUrl || !!inviteError || inviteLoading}
              onClick={handleCopyLink}
            >
              {copyFlash === 'link' ? 'Скопировано' : 'скопировать ссылку'}
            </SharePillButton>
            <SharePillButton
              type="button"
              disabled={!displayInvite || !!inviteError || inviteLoading}
              onClick={handleCopyCode}
            >
              {copyFlash === 'code' ? 'Скопировано' : 'скопировать код'}
            </SharePillButton>
          </SharePillRow>
          {displayInvite && !inviteError && (
            <MutedCodeHint id="party-invite-code" aria-label="Код приглашения">
              {displayInvite}
            </MutedCodeHint>
          )}
          {inviteLoading && !displayInvite && !inviteError ? (
            <InviteCodeMuted style={{ textAlign: 'center', marginBottom: 10 }}>Загрузка кода…</InviteCodeMuted>
          ) : null}
        </>
      )}

      <SubtleSectionLabel>участники ({participantsList.length || party?.participantCount || 1})</SubtleSectionLabel>
      <ParticipantsPanel>
        <ParticipantsList>
          {participantsList.length > 0 ? (
            participantsList.map((p, i) => (
              <Participant key={p.id || i}>
                <ParticipantAvatar $isHost={p.isHost}>
                  {(p.username && p.username !== 'Anonymous' ? p.username[0] : '👤').toUpperCase()}
                </ParticipantAvatar>
                <ParticipantInfo>
                  <ParticipantName>
                    {p.username && p.username !== 'Anonymous' ? p.username : `Участник ${i + 1}`}
                  </ParticipantName>
                  <ParticipantRole>{p.isHost ? 'Хост' : 'Участник'}</ParticipantRole>
                </ParticipantInfo>
              </Participant>
            ))
          ) : (
            <Participant>
              <ParticipantAvatar $isHost={party?.isHost}>
                {party?.isHost ? '👑' : '🎧'}
              </ParticipantAvatar>
              <ParticipantInfo>
                <ParticipantName>Вы</ParticipantName>
                <ParticipantRole>{party?.isHost ? 'Хост' : 'Участник'}</ParticipantRole>
              </ParticipantInfo>
            </Participant>
          )}
        </ParticipantsList>
      </ParticipantsPanel>

      {currentTrack?.id && (
        <>
          <SubtleSectionLabel>сейчас играет</SubtleSectionLabel>
          <NowPlayingBar>
            <NowPlayingCover
              src={nowPlayingCover || '/default-cover.png'}
              alt=""
            />
            <NowPlayingText>
              <NowPlayingTitle>{currentTrack.title || 'Трек'}</NowPlayingTitle>
              <NowPlayingArtist>
                {currentTrack.artist || 'Неизвестный артист'}
              </NowPlayingArtist>
            </NowPlayingText>
          </NowPlayingBar>
        </>
      )}

      <Section>
        <SectionTitle>Очередь ({queueList.length})</SectionTitle>
        <AddCurrentTrackButton
          type="button"
          onClick={handleAddCurrentTrackToQueue}
          disabled={!canAddToQueue || !currentTrack?.id || currentInQueue}
        >
          {currentInQueue ? 'Трек уже в очереди' : 'Добавить текущий трек'}
        </AddCurrentTrackButton>
        <Spacer8 />
        <QueueSection>
          {nextQueueItem ? (
            <>
              <QueueItem key={`q-0-${nextQueueItem.id ?? 'x'}`}>
                <QueueCover
                  src={apiClient.getCoverUrl({ cover: nextQueueItem.cover }) || '/default-cover.png'}
                  alt=""
                />
                <QueueInfo>
                  <QueueTitle>{nextQueueItem.title || 'Unknown'}</QueueTitle>
                  <QueueMeta>{nextQueueItem.artist || 'Unknown Artist'}</QueueMeta>
                  <QueueMeta>Следующий трек</QueueMeta>
                </QueueInfo>
                <QueueRemoveButton
                  type="button"
                  disabled={!canRemoveFromQueue}
                  onClick={() => handleRemoveQueueAt(0, nextQueueItem)}
                  title="Убрать из очереди"
                  aria-label="Убрать из очереди"
                >
                  ×
                </QueueRemoveButton>
              </QueueItem>
              {restQueue.map((item, i) => (
                <QueueItem key={`q-${i + 1}-${item.id ?? i}`}>
                  <QueueCover
                    src={apiClient.getCoverUrl({ cover: item.cover }) || '/default-cover.png'}
                    alt=""
                  />
                  <QueueInfo>
                    <QueueTitle>{item.title || 'Unknown'}</QueueTitle>
                    <QueueMeta>{item.artist || 'Unknown Artist'}</QueueMeta>
                    <QueueMeta>Добавил: {item.addedByName || 'Участник'}</QueueMeta>
                  </QueueInfo>
                  <QueueRemoveButton
                    type="button"
                    disabled={!canRemoveFromQueue}
                    onClick={() => handleRemoveQueueAt(i + 1, item)}
                    title="Убрать из очереди"
                    aria-label="Убрать из очереди"
                  >
                    ×
                  </QueueRemoveButton>
                </QueueItem>
              ))}
            </>
          ) : (
            <EmptyQueueHint>Очередь пуста</EmptyQueueHint>
          )}
        </QueueSection>
      </Section>

      {party?.isHost ? (
        <EndSessionPill type="button" onClick={handleLeaveParty}>
          завершить
        </EndSessionPill>
      ) : (
        <LeaveButton type="button" onClick={handleLeaveParty}>
          Выйти из сессии
        </LeaveButton>
      )}
    </>
  );

  const renderMenu = () => (
    <>
      <TabsContainer>
        <Tab
          type="button"
          $active={activeTab === 'create'}
          onClick={() => {
            setActiveTab('create');
            setError(null);
          }}
        >
          Создать
        </Tab>
        <Tab
          type="button"
          $active={activeTab === 'join'}
          onClick={() => {
            setActiveTab('join');
            setError(null);
          }}
        >
          Присоединиться
        </Tab>
      </TabsContainer>

      {errorText && <ErrorMessage>{errorText}</ErrorMessage>}

      {activeTab === 'create' ? (
        <form onSubmit={handleCreateParty}>
          <Description>Создайте сессию и слушайте музыку с друзьями в реальном времени.</Description>

          <FormGroup>
            <Label htmlFor="party-drawer-title">Название</Label>
            <Input
              id="party-drawer-title"
              type="text"
              value={partyTitle}
              onChange={(e) => setPartyTitle(e.target.value)}
              placeholder="Например, вечер пятницы"
              maxLength={100}
              disabled={isCreating}
            />
          </FormGroup>

          <SubmitButton type="submit" disabled={isCreating}>
            {isCreating && <Spinner />}
            {isCreating ? 'Создаём…' : 'Создать сессию'}
          </SubmitButton>
        </form>
      ) : (
        <form onSubmit={handleJoinParty}>
          <Description>Введите код приглашения, который прислал ведущий.</Description>

          <FormGroup>
            <Label htmlFor="party-drawer-join-code">Код приглашения</Label>
            <CodeInput
              id="party-drawer-join-code"
              type="text"
              value={inputCode.length > 4 ? `${inputCode.slice(0, 4)}-${inputCode.slice(4)}` : inputCode}
              onChange={handleCodeChange}
              placeholder="XXXX-XXXX"
              disabled={isJoining}
              autoComplete="one-time-code"
              inputMode="text"
              enterKeyHint="go"
              spellCheck={false}
            />
          </FormGroup>

          <SubmitButton type="submit" disabled={isJoining || inputCode.length < 8}>
            {isJoining && <Spinner />}
            {isJoining ? 'Подключаем…' : 'Войти в сессию'}
          </SubmitButton>
        </form>
      )}
    </>
  );

  const desktopVariants = {
    hidden: { x: '100%', opacity: 0 },
    visible: { x: 0, opacity: 1 },
    exit: { x: '100%', opacity: 0 },
  };

  if (!isOpen) return null;

  const panelContent = (
    <DrawerPanel
      key="drawer"
      $embedded={isMobile}
      variants={isMobile ? undefined : desktopVariants}
      initial={isMobile ? false : 'hidden'}
      animate={isMobile ? undefined : 'visible'}
      exit={isMobile ? undefined : 'exit'}
      transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      role={isMobile ? 'dialog' : 'complementary'}
      aria-modal={isMobile ? 'true' : undefined}
      aria-label={view === 'active' ? 'Время пати' : 'Слушаем вместе'}
      aria-describedby={view === 'active' && displayInvite && party?.isHost ? 'party-invite-code' : undefined}
    >
      <DrawerHeaderArea>
        <DrawerHeader>
          <DrawerTitle>{view === 'active' ? 'Время пати' : 'Слушаем вместе'}</DrawerTitle>
          <CloseButton type="button" onClick={handleClose} aria-label="Закрыть панель">
            ×
          </CloseButton>
        </DrawerHeader>
      </DrawerHeaderArea>

      <DrawerBody $embedded={isMobile}>
        {view === 'active' ? renderActiveParty() : renderMenu()}
      </DrawerBody>
    </DrawerPanel>
  );

  if (isMobile) {
    return (
      <BottomSheet
        isOpen={isOpen}
        onClose={handleClose}
        snapPoints={[0.78, 0.94]}
        initialSnap={0.78}
        bottomOffsetPx={MOBILE_CHROME_OFFSET_PX + 8}
        sideInsetPx={8}
        topInsetPx={12}
        closeThresholdPx={96}
        showOverlay
        contentPaddingBottomPx={24}
      >
        {panelContent}
      </BottomSheet>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {panelContent}
    </AnimatePresence>
  );
}
