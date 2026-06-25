import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  FaDesktop,
  FaMobileAlt,
  FaTabletAlt,
  FaSync,
  FaTimes,
  FaHandPaper,
  FaCircle,
  FaChevronDown,
  FaKey,
  FaTelegramPlane,
  FaBroom,
} from 'react-icons/fa';
import apiClient from '../../api/client';
import StepUpModal from './StepUpModal';
import { useStepUpRunner } from '../../hooks/useStepUpRunner';
import { runSensitiveSessionAction } from './activeSessionsStepUp';
import PasswordChangeSection from './PasswordChangeSection';
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

function Collapsible({ icon: Icon, title, subtitle, children }) {
  const [open, setOpen] = useState(false);
  return (
    <AccCard>
      <AccHead type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <AccIcon aria-hidden="true">
          <Icon size={15} />
        </AccIcon>
        <AccText>
          <AccTitle>{title}</AccTitle>
          {subtitle ? <AccSub>{subtitle}</AccSub> : null}
        </AccText>
        <AccChevron $open={open} aria-hidden="true">
          <FaChevronDown size={12} />
        </AccChevron>
      </AccHead>
      {open ? <AccBody>{children}</AccBody> : null}
    </AccCard>
  );
}

function SessionDetailsRow({ session, pending, disabled, onRevoke }) {
  return (
    <DetailRow $current={session.current === true}>
      <DetailMain>
        <DetailChips>
          {session.current === true ? (
            <CurrentPill>
              <FaCircle size={6} aria-hidden="true" />
              Текущая
            </CurrentPill>
          ) : null}
          {session.lastSeenLabel ? <MetaChip>Активность: {session.lastSeenLabel}</MetaChip> : null}
          {session.createdAtLabel ? <MetaChip $dim>Вход: {session.createdAtLabel}</MetaChip> : null}
          {session.ip ? <MetaChip $dim>{session.ip}</MetaChip> : null}
        </DetailChips>
      </DetailMain>
      {session.current !== true ? (
        <RevokeBtn
          type="button"
          aria-label="Завершить сессию"
          disabled={pending || disabled}
          onClick={() => onRevoke(session.sid)}
        >
          <FaTimes size={13} />
        </RevokeBtn>
      ) : null}
    </DetailRow>
  );
}

export default function SecuritySettingsSection() {
  const { stepUp } = useStepUpRunner();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [expandedKeys, setExpandedKeys] = useState(() => new Set());

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

  useEffect(() => {
    if (groups.length === 0) return;
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (currentGroup?.key) next.add(currentGroup.key);
      groups.forEach((group) => {
        if (group.sessions.length > 1 || group.duplicateCount > 0) {
          next.add(group.key);
        }
      });
      return next;
    });
  }, [groups, currentGroup?.key]);

  const groups = useMemo(() => groupSessionsByDevice(sessions), [sessions]);
  const { currentGroup, otherGroups } = useMemo(() => splitDeviceGroups(groups), [groups]);
  const otherSessionsTotal = useMemo(
    () => sessions.filter((s) => s.current !== true).length,
    [sessions],
  );

  const busy = busyKey !== '';

  const toggleExpanded = (key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Revokes sids one by one inside a single step-up window. Already-gone
  // sessions are skipped; step-up errors bubble up to open the modal.
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

  const handleRevokeSession = (sid) =>
    runRevoke(`sid:${sid}`, () => revokeSids([sid]), 'Не удалось завершить сессию');

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

  const renderDeviceCard = (group) => {
    const Icon = resolveDeviceIcon(group.deviceType);
    const expanded = expandedKeys.has(group.key);
    const groupBusy = busyKey === `group:${group.key}`;
    const primarySession = group.primary || group.sessions[0];
    const lastSeen = primarySession?.lastSeenLabel || '';
    const createdAt = primarySession?.createdAtLabel || '';
    const ip = primarySession?.ip || '';
    const collapsible =
      group.sessions.length > 1 || group.duplicateCount > 0;

    const metaRow = (
      <DeviceMeta>
        {group.current ? (
          <CurrentPill>
            <FaCircle size={6} aria-hidden="true" />
            Это устройство
          </CurrentPill>
        ) : null}
        {lastSeen ? <MetaChip>Активность: {lastSeen}</MetaChip> : null}
        {createdAt ? <MetaChip $dim>Вход: {createdAt}</MetaChip> : null}
        {ip ? <MetaChip $dim>{ip}</MetaChip> : null}
        {group.duplicateCount > 0 ? (
          <MetaChip $warn>
            {group.current
              ? `ещё входов: ${group.duplicateCount}`
              : `сессий: ${group.sessions.length}`}
          </MetaChip>
        ) : null}
      </DeviceMeta>
    );

    if (!collapsible) {
      return (
        <DeviceCard key={group.key} $current={group.current}>
          <DeviceHeadStatic>
            <DeviceIcon aria-hidden="true" $current={group.current}>
              <Icon size={18} />
            </DeviceIcon>
            <DeviceMain>
              <DeviceName>{group.label}</DeviceName>
              {metaRow}
            </DeviceMain>
          </DeviceHeadStatic>
        </DeviceCard>
      );
    }

    return (
      <DeviceCard key={group.key} $current={group.current}>
        <DeviceHead
          type="button"
          onClick={() => toggleExpanded(group.key)}
          aria-expanded={expanded}
        >
          <DeviceIcon aria-hidden="true" $current={group.current}>
            <Icon size={18} />
          </DeviceIcon>
          <DeviceMain>
            <DeviceName>{group.label}</DeviceName>
            {metaRow}
          </DeviceMain>
          <DeviceChevron $open={expanded} aria-hidden="true">
            <FaChevronDown size={12} />
          </DeviceChevron>
        </DeviceHead>

        {expanded ? (
          <DeviceBody>
            <DetailList>
              {group.sessions.map((session) => (
                <SessionDetailsRow
                  key={session.sid}
                  session={session}
                  pending={busyKey === `sid:${session.sid}`}
                  disabled={busy}
                  onRevoke={handleRevokeSession}
                />
              ))}
            </DetailList>
            {staleSidsForGroup(group).length > 0 ? (
              <GroupAction
                type="button"
                disabled={busy}
                onClick={() => handleRevokeGroupStale(group)}
              >
                <FaBroom size={13} aria-hidden="true" />
                {groupBusy
                  ? 'Завершаем…'
                  : group.current
                    ? `Завершить старые входы (${group.duplicateCount})`
                    : 'Завершить сеансы устройства'}
              </GroupAction>
            ) : null}
          </DeviceBody>
        ) : null}
      </DeviceCard>
    );
  };

  return (
    <Wrap>
      <StepUpModal open={stepUp.open} onClose={stepUp.close} onSuccess={stepUp.onSuccess} />
      {stepUp.error ? <ErrorStrip>{stepUp.error}</ErrorStrip> : null}

      <Intro>
        Здесь только <strong>входы в аккаунт</strong> — браузеры и приложения, где вы
        авторизованы. Передача музыки между колонками и телефонами — в разделе
        «Синхронизация».
      </Intro>

      {error ? <ErrorStrip>{error}</ErrorStrip> : null}

      {loading && sessions.length === 0 ? <Empty>Загружаем устройства…</Empty> : null}
      {!loading && sessions.length === 0 && !error ? (
        <Empty>Активных сессий не найдено.</Empty>
      ) : null}

      {currentGroup ? (
        <Block>
          <BlockHead>
            <BlockTitle>Текущий вход</BlockTitle>
            <RefreshBtn type="button" onClick={loadSessions} disabled={loading || busy}>
              <FaSync size={11} aria-hidden="true" />
              Обновить
            </RefreshBtn>
          </BlockHead>
          {renderDeviceCard(currentGroup)}
        </Block>
      ) : null}

      {otherGroups.length > 0 ? (
        <Block>
          <BlockHead>
            <BlockTitle>Другие входы</BlockTitle>
            <BlockCount>{otherGroups.length}</BlockCount>
          </BlockHead>
          <DeviceList>{otherGroups.map(renderDeviceCard)}</DeviceList>
        </Block>
      ) : null}

      {otherSessionsTotal > 0 ? (
        <Block>
          <TerminateOthers type="button" onClick={handleRevokeOthers} disabled={busy}>
            <FaHandPaper size={14} aria-hidden="true" />
            {busyKey === 'others' ? 'Завершаем…' : `Завершить все другие сеансы (${otherSessionsTotal})`}
          </TerminateOthers>
          <TerminateHint>Выйти на всех устройствах, кроме текущего</TerminateHint>
        </Block>
      ) : null}

      {sessions.length > 0 ? (
        <TerminateAll type="button" onClick={handleRevokeAll} disabled={busy}>
          {busyKey === 'all' ? 'Завершаем…' : 'Выйти на всех устройствах (включая это)'}
        </TerminateAll>
      ) : null}

      <Collapsible
        icon={FaKey}
        title="Пароль"
        subtitle="Смена пароля, проверка надёжности"
      >
        <PasswordChangeSection embedded />
      </Collapsible>

      <Collapsible
        icon={FaTelegramPlane}
        title="Telegram"
        subtitle="Привязка аккаунта и отвязка"
      >
        <TelegramUnlinkSection embedded />
      </Collapsible>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Intro = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  line-height: 1.55;

  strong {
    color: rgba(255, 255, 255, 0.82);
    font-weight: 600;
  }
`;

const ErrorStrip = styled.div`
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.12);
  color: #ff8a84;
  font-size: 13px;
`;

const Empty = styled.div`
  padding: 24px 12px;
  text-align: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
`;

const Block = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const BlockHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const BlockTitle = styled.h4`
  margin: 0;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
`;

const BlockCount = styled.span`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  font-weight: 600;
`;

const RefreshBtn = styled.button`
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  padding: 6px 11px;
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
`;

const DeviceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DeviceCard = styled.div`
  border-radius: 12px;
  background: ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.08)' : 'rgba(255, 255, 255, 0.04)')};
  border: 1px solid ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.22)' : 'rgba(255, 255, 255, 0.06)')};
  overflow: hidden;
`;

const DeviceHead = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  width: 100%;
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
`;

const DeviceHeadStatic = styled.div`
  width: 100%;
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 12px;
  align-items: center;
  padding: 12px;
`;

const DeviceIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.16)' : 'rgba(255, 255, 255, 0.06)')};
  color: ${(p) => (p.$current ? '#1db954' : 'rgba(255, 255, 255, 0.85)')};
`;

const DeviceMain = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const DeviceName = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DeviceMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const DeviceChevron = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
  transition: transform 0.18s ease;
  transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')});
`;

const DeviceBody = styled.div`
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DetailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const DetailRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 10px;
  background: ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.07)' : 'rgba(0, 0, 0, 0.18)')};

  @media (max-width: 520px) {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
`;

const DetailMain = styled.div`
  min-width: 0;
`;

const DetailChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const MetaChip = styled.span`
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: ${(p) => (p.$warn ? 'rgba(255, 214, 10, 0.1)' : 'rgba(255, 255, 255, 0.06)')};
  color: ${(p) =>
    p.$warn
      ? '#ffd60a'
      : p.$dim
        ? 'rgba(255, 255, 255, 0.45)'
        : 'rgba(255, 255, 255, 0.65)'};
`;

const CurrentPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(29, 185, 84, 0.15);
  color: #1db954;
  font-weight: 700;

  svg {
    color: #1db954;
  }
`;

const RevokeBtn = styled.button`
  appearance: none;
  border: 0;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.7);
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

const GroupAction = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.1);
  color: #ff8a84;
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const TerminateOthers = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 69, 58, 0.1);
  color: #ff8a84;
  font-size: 14px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const TerminateHint = styled.p`
  margin: 0;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
`;

const TerminateAll = styled.button`
  appearance: none;
  border: 1px solid rgba(255, 69, 58, 0.35);
  width: 100%;
  padding: 11px 14px;
  border-radius: 12px;
  background: transparent;
  color: #ff8a84;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const AccCard = styled.div`
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

const AccHead = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  width: 100%;
  display: grid;
  grid-template-columns: 36px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  color: inherit;
`;

const AccIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
`;

const AccText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const AccTitle = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
`;

const AccSub = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
`;

const AccChevron = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
  transition: transform 0.18s ease;
  transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')});
`;

const AccBody = styled.div`
  padding: 0 12px 14px;
`;
