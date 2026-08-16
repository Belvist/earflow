import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import apiClient from '../../api/client';
import StepUpModal from './StepUpModal';
import { useStepUpRunner } from '../../hooks/useStepUpRunner';
import { runSensitiveSessionAction } from './activeSessionsStepUp';

function mapUnlinkError(e) {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'PASSWORD_REQUIRED_BEFORE_UNLINK') {
    return 'Сначала установите пароль в блоке выше — иначе потеряете доступ.';
  }
  if (code === 'TELEGRAM_NOT_LINKED') return 'Telegram уже не привязан.';
  if (code === 'MFA_STEP_UP_REQUIRED') return 'Нужно подтверждение 2FA.';
  return e?.message || 'Не удалось отвязать Telegram';
}

export default function TelegramUnlinkSection({ embedded = false }) {
  const { stepUp } = useStepUpRunner();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await apiClient.getSecurityOverview();
      setOverview(data);
    } catch (e) {
      setOverview(null);
      setError(e?.message || 'Не удалось загрузить данные безопасности');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasTelegram = overview?.account?.hasTelegram === true;
  const hasPassword = overview?.account?.hasPassword === true;

  const unlink = async () => {
    if (!hasTelegram || busy) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: async () => {
          await apiClient.unlinkTelegram();
          setNotice('Telegram отвязан.');
          await load();
        },
      });
    } catch (e) {
      setError(mapUnlinkError(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Wrap $embedded={embedded}>
        {embedded ? null : <Title>Telegram</Title>}
        <Muted>Загрузка…</Muted>
      </Wrap>
    );
  }

  return (
    <Wrap $embedded={embedded}>
      {embedded ? null : <Title>Telegram</Title>}
      <StatusRow>
        <StatusDot $on={hasTelegram} aria-hidden />
        <Hint>
          {hasTelegram
            ? 'Аккаунт привязан к Telegram. Отвязка требует пароль и 2FA step-up (если включена).'
            : 'Telegram не привязан.'}
        </Hint>
      </StatusRow>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <Notice>{notice}</Notice> : null}
      {hasTelegram ? (
        <Actions>
          <Button type="button" onClick={unlink} disabled={busy || !hasPassword} $danger>
            {busy
              ? 'Отвязываем…'
              : hasPassword
                ? 'Отвязать Telegram'
                : 'Сначала установите пароль'}
          </Button>
          {!hasPassword ? (
            <Warn>
              Без пароля вы потеряете доступ к аккаунту после отвязки — установите его
              в блоке выше.
            </Warn>
          ) : null}
        </Actions>
      ) : null}
      <StepUpModal open={stepUp.open} onClose={stepUp.close} onSuccess={stepUp.onSuccess} />
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: ${(p) => (p.$embedded ? '0' : '20px')};
  padding-top: ${(p) => (p.$embedded ? '0' : '16px')};
  border-top: ${(p) => (p.$embedded ? 'none' : '1px solid rgba(255, 255, 255, 0.08)')};
`;

const Title = styled.h3`
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 0.82rem;
  opacity: 0.72;
  line-height: 1.35;
`;

const StatusRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const StatusDot = styled.span`
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${(p) => (p.$on ? '#1db954' : 'rgba(255, 255, 255, 0.25)')};
`;

const Muted = styled.div`
  font-size: 0.85rem;
  opacity: 0.7;
`;

const ErrorText = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.12);
  color: #ff8a84;
  font-size: 0.85rem;
`;

const Notice = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(29, 185, 84, 0.12);
  color: #5fff8d;
  font-size: 0.85rem;
`;

const Actions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
`;

const Button = styled.button`
  padding: 10px 16px;
  border-radius: 10px;
  border: ${(p) => (p.$danger ? '1px solid rgba(255, 69, 58, 0.35)' : 'none')};
  font-weight: 600;
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  background: ${(p) => (p.$danger ? 'rgba(255, 69, 58, 0.14)' : '#1db954')};
  color: ${(p) => (p.$danger ? '#ff8a84' : '#000')};
  transition: background 0.15s ease;

  &:hover:not(:disabled) {
    background: ${(p) => (p.$danger ? 'rgba(255, 69, 58, 0.22)' : '#1ed760')};
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const Warn = styled.span`
  font-size: 0.78rem;
  color: #f5b7b1;
`;
