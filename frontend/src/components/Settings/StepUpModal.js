import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { postMfaStepUp } from '../../auth/mfaStepUp';

const onlyDigits = (v) => String(v || '').replaceAll(/\D+/g, '').slice(0, 6);

export default function StepUpModal({ open, onClose, onSuccess }) {
  const [token, setToken] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const tokenClean = useMemo(() => onlyDigits(token), [token]);

  if (!open) return null;

  const submit = async () => {
    const t = tokenClean;
    const r = String(recoveryCode || '').trim();

    if (!t && !r) {
      setError('Введите код из приложения или recovery code');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await postMfaStepUp({ token: t || undefined, recoveryCode: t ? undefined : r });
      if (!res.ok) {
        setError('Неверный 2FA код или подтверждение недоступно');
        return;
      }
      setToken('');
      setRecoveryCode('');
      if (typeof onSuccess === 'function') {
        onSuccess();
      }
    } catch {
      setError('Не удалось подтвердить 2FA');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Overlay role="dialog" aria-modal="true" aria-labelledby="step-up-title">
      <Modal>
        <Title id="step-up-title">Подтвердите действие</Title>
        <Hint>
          Для завершения сессий или других чувствительных операций нужен код 2FA
          (TOTP или recovery code).
        </Hint>
        <Field>
          <Label>Код TOTP (6 цифр)</Label>
          <Input
            value={token}
            onChange={(e) => setToken(onlyDigits(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
          />
        </Field>
        <Or>или</Or>
        <Field>
          <Label>Recovery code</Label>
          <Input
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            placeholder="abcd-efgh-ijkl"
          />
        </Field>
        {error ? <ErrorText>{error}</ErrorText> : null}
        <Actions>
          <SecondaryBtn type="button" onClick={onClose} disabled={submitting}>
            Отмена
          </SecondaryBtn>
          <PrimaryBtn type="button" onClick={submit} disabled={submitting}>
            {submitting ? 'Проверяем…' : 'Подтвердить'}
          </PrimaryBtn>
        </Actions>
      </Modal>
    </Overlay>
  );
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  z-index: 1200;
`;

const Modal = styled.div`
  width: min(480px, 100%);
  padding: 20px;
  border-radius: 14px;
  background: #181818;
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Title = styled.h2`
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.span`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const Input = styled.input`
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
`;

const Or = styled.div`
  text-align: center;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
`;

const ErrorText = styled.div`
  font-size: 13px;
  color: #ff8a84;
`;

const Actions = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 4px;
`;

const Btn = styled.button`
  appearance: none;
  border: 0;
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const SecondaryBtn = styled(Btn)`
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
`;

const PrimaryBtn = styled(Btn)`
  background: #1db954;
  color: #000;
`;
