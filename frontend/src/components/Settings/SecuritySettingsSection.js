import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  FaDesktop,
  FaMobileAlt,
  FaTabletAlt,
  FaSync,
  FaTimes,
  FaKey,
  FaTelegramPlane,
  FaBroom,
} from 'react-icons/fa';
import apiClient from '../../api/client';
import StepUpModal from './StepUpModal';
import { useStepUpRunner } from '../../hooks/useStepUpRunner';
import { runSensitiveSessionAction } from './activeSessionsStepUp';
import PasswordChangeSection from './PasswordChangeSection';
import MfaSettingsSection from './MfaSettingsSection';
import TelegramUnlinkSection from './TelegramUnlinkSection';
import {
  groupSessionsByDevice,
  splitDeviceGroups,
  staleSidsForGroup,
} from '../../utils/sessionDeviceGroups';

const DEVICE_ICONS = {
  desktop: FaDesktop,
  mobile: FaMobileAlt,
  tablet: FaTabletAlt,
};

const SURFACE = '#282828';

function resolveDeviceIcon(type) {
  return DEVICE_ICONS[type] || FaDesktop;
}

function isSessionGone(e) {
  return String(e?.code || '').trim().toUpperCase() === 'SESSION_NOT_FOUND';
}

function formatActionError(e, fallback) {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'FRESH_LOGIN_REQUIRED') {
    return 'Новая сессия не может завершать другие без 2FA. Подтвердите кодом.';
  }
  if (code === 'MFA_STEP_UP_REQUIRED') {
    return 'Нужно подтверждение 2FA для этого действия.';
  }
  return e?.message || fallback;
}

function formatSessionLine(session) {
  const parts = [];
  if (session?.lastSeenLabel) parts.push(`активность ${session.lastSeenLabel}`);
  if (session?.createdAtLabel) parts.push(`вход ${session.createdAtLabel}`);
  if (session?.ip) parts.push(session.ip);
  return parts.join(' · ');
}

export default function SecuritySettingsSection() {
  const { stepUp } = useStepUpRunner();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');

  const loadSessions = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await apiClient.getAuthSessions();
      setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (e) {
      setError(e?.message || 'Не удалось загрузить сессии');
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const groups = useMemo(() => groupSessionsByDevice(sessions), [sessions]);
  const { currentGroup, otherGroups } = useMemo(() => splitDeviceGroups(groups), [groups]);
  const otherSessionsTotal = useMemo(
    () => sessions.filter((s) => s.current !== true).length,
    [sessions],
  );

  const busy = busyKey !== '';

  const revokeSids = useCallback(async (sids) => {
    for (const sid of sids) {
      try {
        await apiClient.revokeAuthSession(sid);
      } catch (e) {
        if (isSessionGone(e)) continue;
        throw e;
      }
    }
  }, []);

  const runRevoke = async (key, action, fallbackMessage) => {
    if (busy) return;
    setError('');
    setBusyKey(key);
    try {
      await runSensitiveSessionAction({ stepUp, action });
      await loadSessions();
    } catch (e) {
      setError(formatActionError(e, fallbackMessage));
    } finally {
      setBusyKey('');
    }
  };

  const handleRevokeGroupStale = (group) =>
    runRevoke(
      `group:${group.key}`,
      () => revokeSids(staleSidsForGroup(group)),
      'Не удалось завершить сессии устройства',
    );

  const handleRevokeOthers = () =>
    runRevoke('others', () => apiClient.revokeOtherAuthSessions(), 'Не удалось завершить другие сеансы');

  const handleRevokeAll = async () => {
    if (busy) return;
    setError('');
    setBusyKey('all');
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: () => apiClient.revokeAllAuthSessions(),
      });
      window.location.href = '/login';
    } catch (e) {
      setError(formatActionError(e, 'Не удалось завершить все сессии'));
      setBusyKey('');
    }
  };

  const renderCurrentGroup = (group) => {
    const Icon = resolveDeviceIcon(group.deviceType);
    const currentSession = group.sessions.find((s) => s.current === true) || group.primary;
    const staleCount = staleSidsForGroup(group).length;
    const groupBusy = busyKey === `group:${group.key}`;
    return (
      <HeroCard key={group.key}>
        <RowIcon aria-hidden>
          <Icon size={20} />
        </RowIcon>
        <RowMain>
          <RowNameLine>
            <RowName>{group.label}</RowName>
            <CurrentBadge>Это устройство</CurrentBadge>
          </RowNameLine>
          <RowSub>{`активность ${currentSession?.lastSeenLabel || 'только что'} · вход ${currentSession?.createdAtLabel || '—'}${currentSession?.ip ? ` · ${currentSession.ip}` : ''}`}</RowSub>
          {staleCount > 0 ? (
            <HeroAction
              type="button"
              disabled={busy}
              onClick={() => handleRevokeGroupStale(group)}
            >
              <FaBroom size={11} aria-hidden />
              {groupBusy
                ? 'Завершаем…'
                : `Убрать старые входы на этом устройстве (${staleCount})`}
            </HeroAction>
          ) : null}
        </RowMain>
      </HeroCard>
    );
  };

  const renderOtherGroup = (group) => {
    const Icon = resolveDeviceIcon(group.deviceType);
    const primarySession = group.primary || group.sessions[0];
    const groupBusy = busyKey === `group:${group.key}`;
    return (
      <SessionRow key={group.key}>
        <RowIcon aria-hidden>
          <Icon size={18} />
        </RowIcon>
        <RowMain>
          <RowNameLine>
            <RowName>{group.label}</RowName>
            {group.sessions.length > 1 ? (
              <CountChip>входов: {group.sessions.length}</CountChip>
            ) : null}
          </RowNameLine>
          <RowSub>{formatSessionLine(primarySession) || '—'}</RowSub>
        </RowMain>
        <RevokeBtn
          type="button"
          aria-label={`Завершить входы: ${group.label}`}
          title="Завершить входы"
          disabled={busy || groupBusy}
          onClick={() => handleRevokeGroupStale(group)}
        >
          <FaTimes size={12} />
        </RevokeBtn>
      </SessionRow>
    );
  };

  return (
    <Wrap>
      <StepUpModal open={stepUp.open} onClose={stepUp.close} onSuccess={stepUp.onSuccess} />
      {stepUp.error ? <ErrorStrip>{stepUp.error}</ErrorStrip> : null}
      {error ? <ErrorStrip>{error}</ErrorStrip> : null}

      <Section>
        <SectionHead>
          <SectionTitle>Активные входы</SectionTitle>
          <RefreshBtn type="button" onClick={loadSessions} disabled={loading || busy}>
            <FaSync size={11} aria-hidden />
            Обновить
          </RefreshBtn>
        </SectionHead>
        <InfoCard>
          Здесь видны устройства и браузеры, где вы входили в аккаунт. Для каждого
          можно завершить сессию.
        </InfoCard>

        {loading && sessions.length === 0 ? (
          <MutedState>Загружаем сессии…</MutedState>
        ) : null}
        {!loading && sessions.length === 0 && !error ? (
          <MutedState>Активных сессий не найдено.</MutedState>
        ) : null}

        {currentGroup ? renderCurrentGroup(currentGroup) : null}

        {otherGroups.length > 0 ? (
          <>
            <SectionLabel>Другие устройства · {otherGroups.length}</SectionLabel>
            <GroupCard>{otherGroups.map(renderOtherGroup)}</GroupCard>
          </>
        ) : null}

        {otherSessionsTotal > 0 ? (
          <DangerCard>
            <DangerHead>
              <DangerTitle>Опасная зона</DangerTitle>
              <DangerSub>Действия завершат выбранные сеансы сразу.</DangerSub>
            </DangerHead>
            <DangerActions>
              <DangerBtn type="button" onClick={handleRevokeOthers} disabled={busy}>
                {busyKey === 'others'
                  ? 'Завершаем…'
                  : 'Выйти на всех устройствах, кроме этого'}
              </DangerBtn>
              {sessions.length > 0 ? (
                <DangerBtnOutline type="button" onClick={handleRevokeAll} disabled={busy}>
                  {busyKey === 'all' ? 'Завершаем…' : 'Выйти везде, включая это устройство'}
                </DangerBtnOutline>
              ) : null}
            </DangerActions>
          </DangerCard>
        ) : null}
      </Section>

      <MfaSettingsSection />

      <Section>
        <SectionTitle>Аккаунт</SectionTitle>
        <AccountCard>
          <AccountBlock>
            <AccountHead>
              <AccountIcon aria-hidden><FaKey size={14} /></AccountIcon>
              <AccountHeadText>
                <AccountHeadTitle>Пароль</AccountHeadTitle>
                <AccountHeadSub>Смена пароля и проверка надёжности</AccountHeadSub>
              </AccountHeadText>
            </AccountHead>
            <PasswordChangeSection embedded />
          </AccountBlock>
          <Divider />
          <AccountBlock>
            <AccountHead>
              <AccountIcon aria-hidden><FaTelegramPlane size={14} /></AccountIcon>
              <AccountHeadText>
                <AccountHeadTitle>Telegram</AccountHeadTitle>
                <AccountHeadSub>Привязка и отвязка аккаунта</AccountHeadSub>
              </AccountHeadText>
            </AccountHead>
            <TelegramUnlinkSection embedded />
          </AccountBlock>
        </AccountCard>
      </Section>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 28px;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const SectionTitle = styled.h4`
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
`;

const SectionLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.5);
`;

const InfoCard = styled.p`
  margin: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: ${SURFACE};
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
`;

const MutedState = styled.div`
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
`;

const ErrorStrip = styled.div`
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.12);
  color: #ff8a84;
  font-size: 13px;
`;

const RefreshBtn = styled.button`
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-family: inherit;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
  }
`;

const CurrentBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(29, 185, 84, 0.18);
  color: #5fff8d;
  flex-shrink: 0;
`;

const HeroCard = styled.div`
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px;
  align-items: start;
  padding: 14px 16px;
  border-radius: 12px;
  background: ${SURFACE};
  border: 1px solid rgba(29, 185, 84, 0.3);
`;

const HeroAction = styled.button`
  appearance: none;
  border: 0;
  margin-top: 8px;
  align-self: flex-start;
  padding: 7px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  font-family: inherit;

  &:hover:not(:disabled) {
    background: rgba(255, 69, 58, 0.15);
    color: #ff8a84;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const CountChip = styled.span`
  font-size: 10px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  flex-shrink: 0;
`;

const GroupCard = styled.div`
  border-radius: 12px;
  background: ${SURFACE};
  overflow: hidden;
`;

const SessionRow = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  font-family: inherit;
  color: inherit;
  border: 0;
  background: transparent;

  & + &,
  div + & {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  &:hover {
    background: rgba(255, 255, 255, 0.03);
  }
`;

const RowIcon = styled.div`
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.88);
  flex-shrink: 0;
`;

const RowMain = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const RowNameLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

const RowName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RowSub = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.48);
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RevokeBtn = styled.button`
  appearance: none;
  border: 0;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.75);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(255, 69, 58, 0.15);
    color: #ff8a84;
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const DangerCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(255, 69, 58, 0.05);
  border: 1px solid rgba(255, 69, 58, 0.22);
`;

const DangerHead = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const DangerTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #ff8a84;
`;

const DangerSub = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
`;

const DangerActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;

  @media (min-width: 640px) {
    flex-direction: row;
    flex-wrap: wrap;
  }
`;

const DangerBtn = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  padding: 11px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.14);
  color: #ff8a84;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;

  &:hover:not(:disabled) {
    background: rgba(255, 69, 58, 0.22);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (min-width: 640px) {
    width: auto;
    flex: 1 1 auto;
  }
`;

const DangerBtnOutline = styled.button`
  appearance: none;
  border: 1px solid rgba(255, 69, 58, 0.35);
  width: 100%;
  padding: 10px 14px;
  border-radius: 10px;
  background: transparent;
  color: #ff8a84;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;

  &:hover:not(:disabled) {
    background: rgba(255, 69, 58, 0.1);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  @media (min-width: 640px) {
    width: auto;
    flex: 1 1 auto;
  }
`;

const AccountCard = styled.div`
  border-radius: 12px;
  background: ${SURFACE};
  overflow: hidden;
`;

const AccountBlock = styled.div`
  padding: 16px;
`;

const AccountHead = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 14px;
`;

const AccountIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  flex-shrink: 0;
`;

const AccountHeadText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const AccountHeadTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #fff;
`;

const AccountHeadSub = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.48);
`;

const Divider = styled.div`
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
`;
