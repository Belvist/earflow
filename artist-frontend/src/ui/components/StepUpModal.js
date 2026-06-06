import React, { useMemo, useState } from 'react';
import styled from 'styled-components';

import Card from './Card';
import Input from './Input';
import Button from './Button';
import { mfaUsecase } from '../../usecases/mfaUsecase';

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
      const res = await mfaUsecase.stepUp({ token: t || undefined, recoveryCode: t ? undefined : r });
      if (!res.ok) {
        setError('Неверный 2FA код');
        return;
      }
      setToken('');
      setRecoveryCode('');
      if (typeof onSuccess === 'function') onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Overlay>
      <Modal>
        <Card>
          <Title>Подтвердите 2FA</Title>
          <Body>
            <Field>
              <Label>Код TOTP (6 цифр)</Label>
              <Input value={token} onChange={(e) => setToken(onlyDigits(e.target.value))} inputMode="numeric" placeholder="123456" />
            </Field>
            <Or>или</Or>
            <Field>
              <Label>Recovery code</Label>
              <Input value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} placeholder="abcd-efgh-ijkl" />
            </Field>
            {error ? <ErrorText>{error}</ErrorText> : null}
          </Body>
          <Actions>
            <Button type="button" onClick={onClose} disabled={submitting}>Отмена</Button>
            <Button type="button" $variant="primary" onClick={submit} disabled={submitting}>Подтвердить</Button>
          </Actions>
        </Card>
      </Modal>
    </Overlay>
  );
}

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  z-index: 50;
`;

const Modal = styled.div`
  width: min(520px, 100%);
`;

const Title = styled.h2`
  font-size: 18px;
  font-weight: 900;
  margin-bottom: 12px;
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const Or = styled.div`
  text-align: center;
  color: rgba(255, 255, 255, 0.35);
  font-size: 12px;
  padding: 4px 0;
`;

const Actions = styled.div`
  margin-top: 14px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
`;

const ErrorText = styled.div`
  color: rgba(255, 255, 255, 0.10);
  font-size: 13px;
  line-height: 1.4;
`;
