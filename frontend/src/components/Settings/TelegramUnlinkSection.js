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
      <Hint>
        {hasTelegram
          ? 'Аккаунт привязан к Telegram. Отвязка требует пароль и 2FA step-up (если включена).'
          : 'Telegram не привязан.'}
      </Hint>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <Notice>{notice}</Notice> : null}
      {hasTelegram ? (
        <Actions>
          <Button type="button" $embedded={embedded} onClick={unlink} disabled={busy || !hasPassword} $danger>
            {busy ? 'Отвязываем…' : 'Отвязать Telegram'}
          </Button>
          {!hasPassword ? (
            <Warn>Установите пароль перед отвязкой.</Warn>
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

const Muted = styled.div`
  font-size: 0.85rem;
  opacity: 0.7;
`;

const ErrorText = styled.div`
  color: #f5b7b1;
  font-size: 0.85rem;
`;

const Notice = styled.div`
  color: rgba(255, 255, 255, 0.75);
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
  border-radius: 999px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  background: ${(p) =>
    p.$danger
      ? '#c0392b'
      : p.$embedded
        ? '#fff'
        : '#1db954'};
  color: ${(p) => (p.$danger ? '#fff' : '#000')};
  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
`;

const Warn = styled.span`
  font-size: 0.78rem;
  color: #f5b7b1;
`;
