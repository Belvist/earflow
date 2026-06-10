import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import apiClient from '../../api/client';
import { useStepUpRunner } from '../../hooks/useStepUpRunner';
import { runSensitiveSessionAction } from './activeSessionsStepUp';
import StepUpModal from './StepUpModal';

const PASSWORD_STRENGTH_DEBOUNCE_MS = 350;

function mapPasswordError(e) {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'INVALID_CURRENT_PASSWORD') return 'Текущий пароль неверный';
  if (code === 'CURRENT_PASSWORD_REQUIRED') return 'Введите текущий пароль';
  if (code === 'NEW_PASSWORD_REQUIRED') return 'Введите новый пароль';
  if (code === 'WEAK_PASSWORD') return 'Пароль не соответствует требованиям безопасности';
  if (code === 'MFA_REQUIRED_TO_SET_PASSWORD') {
    return 'Сначала включите 2FA — установка пароля доступна только после этого';
  }
  if (code === 'MFA_STEP_UP_REQUIRED') return 'Нужно подтверждение 2FA для этого действия';
  return e?.message || 'Не удалось изменить пароль';
}

export default function PasswordChangeSection({ embedded = false }) {
  const { stepUp } = useStepUpRunner();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [strength, setStrength] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const strengthTimerRef = useRef(0);
  const strengthRequestRef = useRef(0);

  useEffect(() => () => {
    if (strengthTimerRef.current) {
      window.clearTimeout(strengthTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 4200);
    return () => clearTimeout(t);
  }, [notice]);

  const resetForm = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setStrength(null);
  }, []);

  const scheduleStrengthCheck = useCallback((password) => {
    if (strengthTimerRef.current) {
      window.clearTimeout(strengthTimerRef.current);
    }
    const value = String(password || '');
    if (!value) {
      setStrength(null);
      return;
    }
    strengthTimerRef.current = window.setTimeout(async () => {
      const reqId = strengthRequestRef.current + 1;
      strengthRequestRef.current = reqId;
      try {
        const data = await apiClient.checkPasswordStrength(value);
        if (strengthRequestRef.current === reqId) {
          setStrength(data && typeof data === 'object' ? data : null);
        }
      } catch {
        if (strengthRequestRef.current === reqId) {
          setStrength(null);
        }
      }
    }, PASSWORD_STRENGTH_DEBOUNCE_MS);
  }, []);

  const submit = async () => {
    setError('');
    setNotice('');
    if (!newPassword) {
      setError('Введите новый пароль');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Подтверждение пароля не совпадает');
      return;
    }

    setBusy(true);
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: async () => {
          const data = await apiClient.changePassword({
            currentPassword: currentPassword || undefined,
            newPassword,
          });
          const revoked = Number(data?.revokedOtherSessions) || 0;
          const tail = revoked > 0 ? ` Завершено ${revoked} других сессий.` : '';
          setNotice(`Пароль обновлён.${tail}`);
          resetForm();
        },
      });
    } catch (e) {
      setError(mapPasswordError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Wrap $embedded={embedded}>
      {embedded ? null : <Title>Пароль</Title>}
      <Hint>
        Смена пароля требует подтверждения 2FA, если она включена. После смены другие сессии могут быть завершены.
      </Hint>

      <Field>
        <Label>Текущий пароль</Label>
        <Input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          disabled={busy}
        />
      </Field>

      <Field>
        <Label>Новый пароль</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => {
            setNewPassword(e.target.value);
            scheduleStrengthCheck(e.target.value);
          }}
          disabled={busy}
        />
        {strength?.label ? <Strength $ok={strength.meetsComplexity === true}>{strength.label}</Strength> : null}
      </Field>

      <Field>
        <Label>Подтверждение</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={busy}
        />
      </Field>

      {error ? <ErrorText>{error}</ErrorText> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      <Actions>
        <Button type="button" onClick={submit} disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сменить пароль'}
        </Button>
      </Actions>

      {stepUp.error ? <ErrorText>{stepUp.error}</ErrorText> : null}
      <StepUpModal open={stepUp.open} onClose={stepUp.close} onSuccess={stepUp.onSuccess} />
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: ${(p) => (p.$embedded ? '0' : '24px')};
  padding-top: ${(p) => (p.$embedded ? '0' : '20px')};
  border-top: ${(p) => (p.$embedded ? 'none' : '1px solid rgba(255, 255, 255, 0.08)')};
`;

const Title = styled.h3`
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.75;
  line-height: 1.4;
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.span`
  font-size: 0.8rem;
  opacity: 0.8;
`;

const Input = styled.input`
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(0, 0, 0, 0.2);
  color: inherit;
`;

const Strength = styled.span`
  font-size: 0.78rem;
  color: ${(p) => (p.$ok ? '#7dcea0' : '#f5b7b1')};
`;

const ErrorText = styled.div`
  color: #f5b7b1;
  font-size: 0.85rem;
`;

const Notice = styled.div`
  color: #7dcea0;
  font-size: 0.85rem;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
`;

const Button = styled.button`
  padding: 10px 16px;
  border-radius: 8px;
  border: none;
  background: #1db954;
  color: #000;
  font-weight: 600;
  cursor: pointer;
  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;
