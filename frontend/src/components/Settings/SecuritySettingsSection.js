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
  FaChevronDown,
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

function SessionDetailRow({ session, pending, disabled, onRevoke }) {
  return (
    <DetailRow $current={session.current === true}>
      <DetailText>{formatSessionLine(session) || 'Сессия'}</DetailText>
      {session.current !== true ? (
        <RevokeBtn
          type="button"
          aria-label="Завершить сессию"
          disabled={pending || disabled}
          onClick={() => onRevoke(session.sid)}
        >
          <FaTimes size={12} />
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

  const groups = useMemo(() => groupSessionsByDevice(sessions), [sessions]);
  const { currentGroup, otherGroups } = useMemo(() => splitDeviceGroups(groups), [groups]);
  const otherSessionsTotal = useMemo(
    () => sessions.filter((s) => s.current !== true).length,
    [sessions],
  );

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

  const busy = busyKey !== '';

  const toggleExpanded = (key) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  const renderGroupRow = (group) => {
    const Icon = resolveDeviceIcon(group.deviceType);
    const expanded = expandedKeys.has(group.key);
    const groupBusy = busyKey === `group:${group.key}`;
    const primarySession = group.primary || group.sessions[0];
    const collapsible = group.sessions.length > 1 || group.duplicateCount > 0;
    const subtitle = group.current
      ? `Это устройство · ${formatSessionLine(primarySession)}`
      : formatSessionLine(primarySession);

    const headContent = (
      <>
        <RowIcon aria-hidden>
          <Icon size={18} />
        </RowIcon>
        <RowMain>
          <RowName>{group.label}</RowName>
          <RowSub>{subtitle || '—'}</RowSub>
        </RowMain>
        {collapsible ? (
          <ChevronWrap $open={expanded} aria-hidden>
            <FaChevronDown size={12} />
          </ChevronWrap>
        ) : null}
        {!collapsible && !group.current && primarySession?.current !== true ? (
          <RevokeBtn
            type="button"
            aria-label="Завершить сессию"
            disabled={busy || busyKey === `sid:${primarySession?.sid}`}
            onClick={() => handleRevokeSession(primarySession.sid)}
          >
            <FaTimes size={12} />
          </RevokeBtn>
        ) : null}
      </>
    );

    if (!collapsible) {
      return (
        <SessionRow key={group.key} $current={group.current}>
          {headContent}
        </SessionRow>
      );
    }

    return (
      <div key={group.key}>
        <SessionRow
          as="button"
          type="button"
          $current={group.current}
          $clickable
          onClick={() => toggleExpanded(group.key)}
        >
          {headContent}
        </SessionRow>
        {expanded ? (
          <ExpandedBlock>
            {group.sessions.map((session) => (
              <SessionDetailRow
                key={session.sid}
                session={session}
                pending={busyKey === `sid:${session.sid}`}
                disabled={busy}
                onRevoke={handleRevokeSession}
              />
            ))}
            {staleSidsForGroup(group).length > 0 ? (
              <GroupAction
                type="button"
                disabled={busy}
                onClick={() => handleRevokeGroupStale(group)}
              >
                <FaBroom size={12} aria-hidden />
                {groupBusy
                  ? 'Завершаем…'
                  : group.current
                    ? `Завершить старые входы (${group.duplicateCount})`
                    : 'Завершить все сессии устройства'}
              </GroupAction>
            ) : null}
          </ExpandedBlock>
        ) : null}
      </div>
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

        {currentGroup ? (
          <HeroCard>
            {(() => {
              const Icon = resolveDeviceIcon(currentGroup.deviceType);
              const primary = currentGroup.primary || currentGroup.sessions[0];
              return (
                <>
                  <HeroIcon aria-hidden>
                    <Icon size={22} />
                  </HeroIcon>
                  <HeroCopy>
                    <HeroName>{currentGroup.label}</HeroName>
                    <HeroSub>Текущий вход · {formatSessionLine(primary)}</HeroSub>
                  </HeroCopy>
                  <CurrentBadge>сейчас</CurrentBadge>
                </>
              );
            })()}
          </HeroCard>
        ) : null}

        {otherGroups.length > 0 ? (
          <>
            <SectionLabel>Другие входы · {otherGroups.length}</SectionLabel>
            <GroupCard>{otherGroups.map(renderGroupRow)}</GroupCard>
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

const HeroCard = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  align-items: center;
  padding: 16px;
  border-radius: 12px;
  background: ${SURFACE};
  border: 1px solid rgba(255, 255, 255, 0.14);
`;

const HeroIcon = styled.div`
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
`;

const HeroCopy = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const HeroName = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HeroSub = styled.div`
  font-size: 12px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.5);
`;

const CurrentBadge = styled.span`
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  flex-shrink: 0;
`;

const GroupCard = styled.div`
  border-radius: 12px;
  background: ${SURFACE};
  overflow: hidden;
`;

const SessionRow = styled.div`
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  font-family: inherit;
  color: inherit;
  border: 0;
  background: ${(p) => (p.$current ? 'rgba(255, 255, 255, 0.04)' : 'transparent')};
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};

  & + &,
  div + & {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  &:hover {
    background: ${(p) => (p.$clickable ? 'rgba(255, 255, 255, 0.05)' : p.$current ? 'rgba(255, 255, 255, 0.04)' : 'transparent')};
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

const ChevronWrap = styled.span`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.6);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: transform 0.18s ease;
  transform: rotate(${(p) => (p.$open ? '180deg' : '0deg')});
`;

const ExpandedBlock = styled.div`
  padding: 0 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
`;

const DetailRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);

  @media (max-width: 520px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const DetailText = styled.div`
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.62);
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

const GroupAction = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 69, 58, 0.1);
  color: #ff8a84;
  font-size: 12px;
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
