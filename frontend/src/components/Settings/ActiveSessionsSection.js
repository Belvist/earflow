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
} from 'react-icons/fa';
import apiClient from '../../api/client';
import StepUpModal from './StepUpModal';
import { useStepUpRunner } from '../../hooks/useStepUpRunner';
import { runSensitiveSessionAction } from './activeSessionsStepUp';

const DEVICE_ICONS = {
  desktop: FaDesktop,
  mobile: FaMobileAlt,
  tablet: FaTabletAlt,
};

function resolveDeviceIcon(type) {
  return DEVICE_ICONS[type] || FaDesktop;
}

function splitSessions(sessions) {
  const list = Array.isArray(sessions) ? sessions : [];
  const current = list.find((s) => s.current === true) || null;
  const others = list.filter((s) => s.current !== true);
  return { current, others };
}

export default function ActiveSessionsSection() {
  const { stepUp } = useStepUpRunner();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busySid, setBusySid] = useState('');
  const [revokingOthers, setRevokingOthers] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);
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

  const { current, others } = useMemo(() => splitSessions(sessions), [sessions]);

  const formatActionError = (e, fallback) => {
    const code = String(e?.code || '').trim().toUpperCase();
    if (code === 'FRESH_LOGIN_REQUIRED') {
      return 'Новая сессия не может завершать другие без 2FA. Подтвердите кодом.';
    }
    if (code === 'MFA_STEP_UP_REQUIRED') {
      return 'Нужно подтверждение 2FA для этого действия.';
    }
    return e?.message || fallback;
  };

  const handleRevokeOne = async (sid) => {
    if (!sid || busySid || revokingOthers || revokingAll) return;
    setError('');
    setBusySid(sid);
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: () => apiClient.revokeAuthSession(sid),
      });
      await loadSessions();
    } catch (e) {
      setError(formatActionError(e, 'Не удалось завершить сессию'));
    } finally {
      setBusySid('');
    }
  };

  const handleRevokeOthers = async () => {
    if (revokingOthers || busySid || revokingAll || others.length === 0) return;
    setError('');
    setRevokingOthers(true);
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: () => apiClient.revokeOtherAuthSessions(),
      });
      await loadSessions();
    } catch (e) {
      setError(formatActionError(e, 'Не удалось завершить другие сессии'));
    } finally {
      setRevokingOthers(false);
    }
  };

  const handleRevokeAll = async () => {
    if (revokingAll || busySid || revokingOthers || sessions.length === 0) return;
    setError('');
    setRevokingAll(true);
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: () => apiClient.revokeAllAuthSessions(),
      });
      window.location.href = '/login';
    } catch (e) {
      setError(formatActionError(e, 'Не удалось завершить все сессии'));
      setRevokingAll(false);
    }
  };

  return (
    <Wrap>
      <StepUpModal open={stepUp.open} onClose={stepUp.close} onSuccess={stepUp.onSuccess} />
      {stepUp.error ? <ErrorStrip>{stepUp.error}</ErrorStrip> : null}
      <Intro>
        Устройства и браузеры, где вы вошли в Earflow. Если видите незнакомую сессию —
        завершите её и смените пароль.
      </Intro>

      <Toolbar>
        <RefreshBtn type="button" onClick={loadSessions} disabled={loading || revokingOthers}>
          <FaSync size={12} aria-hidden="true" />
          Обновить
        </RefreshBtn>
      </Toolbar>

      {error ? <ErrorStrip>{error}</ErrorStrip> : null}

      {loading && sessions.length === 0 ? (
        <Empty>Загружаем сессии…</Empty>
      ) : null}

      {!loading && sessions.length === 0 && !error ? (
        <Empty>Активных сессий не найдено.</Empty>
      ) : null}

      {current ? (
        <Block>
          <BlockHead>
            <BlockTitle>Это устройство</BlockTitle>
          </BlockHead>
          <SessionRow $current>
            <SessionIcon aria-hidden="true">
              {React.createElement(resolveDeviceIcon(current.deviceType), { size: 18 })}
            </SessionIcon>
            <SessionMain>
              <SessionName>{current.device || 'Текущее устройство'}</SessionName>
              <SessionMeta>
                <CurrentPill>
                  <FaCircle size={6} aria-hidden="true" />
                  Это устройство
                </CurrentPill>
                {current.ip ? <MetaChip>{current.ip}</MetaChip> : null}
                {current.lastSeenLabel ? (
                  <MetaChip>Активность: {current.lastSeenLabel}</MetaChip>
                ) : null}
              </SessionMeta>
            </SessionMain>
          </SessionRow>

          {others.length > 0 ? (
            <TerminateOthers type="button" onClick={handleRevokeOthers} disabled={revokingOthers || !!busySid}>
              <FaHandPaper size={14} aria-hidden="true" />
              {revokingOthers ? 'Завершаем…' : 'Завершить все другие сеансы'}
            </TerminateOthers>
          ) : null}
          {others.length > 0 ? (
            <TerminateHint>Выйти на всех устройствах, кроме текущего</TerminateHint>
          ) : null}
          <TerminateAll type="button" onClick={handleRevokeAll} disabled={revokingAll || !!busySid || revokingOthers}>
            {revokingAll ? 'Завершаем…' : 'Выйти на всех устройствах (включая это)'}
          </TerminateAll>
        </Block>
      ) : null}

      {others.length > 0 ? (
        <Block>
          <BlockHead>
            <BlockTitle>Активные сеансы</BlockTitle>
            <BlockCount>{others.length}</BlockCount>
          </BlockHead>
          <SessionList>
            {others.map((session) => {
              const Icon = resolveDeviceIcon(session.deviceType);
              const pending = busySid === session.sid;
              return (
                <SessionRow key={session.sid}>
                  <SessionIcon aria-hidden="true">
                    <Icon size={18} />
                  </SessionIcon>
                  <SessionMain>
                    <SessionName>{session.device || 'Неизвестное устройство'}</SessionName>
                    <SessionMeta>
                      {session.ip ? <MetaChip>{session.ip}</MetaChip> : null}
                      {session.lastSeenLabel ? (
                        <MetaChip>{session.lastSeenLabel}</MetaChip>
                      ) : null}
                      {session.createdAtLabel ? (
                        <MetaChip $dim>Вход: {session.createdAtLabel}</MetaChip>
                      ) : null}
                    </SessionMeta>
                  </SessionMain>
                  <RevokeBtn
                    type="button"
                    aria-label="Завершить сессию"
                    disabled={pending || revokingOthers}
                    onClick={() => handleRevokeOne(session.sid)}
                  >
                    <FaTimes size={14} />
                  </RevokeBtn>
                </SessionRow>
              );
            })}
          </SessionList>
        </Block>
      ) : null}
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
`;

const Toolbar = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const RefreshBtn = styled.button`
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
  border-radius: 999px;
  padding: 8px 12px;
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

const SessionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const SessionRow = styled.div`
  display: grid;
  grid-template-columns: 44px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border-radius: 12px;
  background: ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.08)' : 'rgba(255, 255, 255, 0.04)')};
  border: 1px solid ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.22)' : 'rgba(255, 255, 255, 0.06)')};
`;

const SessionIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
`;

const SessionMain = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SessionName = styled.div`
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SessionMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const MetaChip = styled.span`
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: ${(p) => (p.$dim ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.65)')};
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
  width: 36px;
  height: 36px;
  border-radius: 10px;
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

const TerminateOthers = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  margin-top: 4px;
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
  margin-top: 8px;
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
