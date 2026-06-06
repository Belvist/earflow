import React, { useState } from 'react';
import styled from 'styled-components';
import { FaLock, FaSave, FaKey } from 'react-icons/fa';

import Button from '../Button';
import Input from '../Input';

export default function SecurityPasswordCard({
    capability,
    strength,
    onPasswordInput,
    onSubmit,
    submitting,
    error,
}) {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const mode = capability?.mode === 'set' ? 'set' : 'change';
    const requiresCurrent = capability?.requiresCurrentPassword === true;
    const blocked = capability?.canChange === false && capability?.canSet === false;
    const blockReason = capability?.blockReason?.message || '';

    const strengthScore = Number.isFinite(Number(strength?.score)) ? Number(strength.score) : 0;
    const strengthMaxScore = Number.isFinite(Number(strength?.maxScore)) && Number(strength.maxScore) > 0
        ? Number(strength.maxScore)
        : 5;
    const strengthLabel = typeof strength?.label === 'string' ? strength.label : '';
    const strengthTone = typeof strength?.tone === 'string' ? strength.tone : 'neutral';
    const strengthChecks = Array.isArray(strength?.checks) ? strength.checks : [];
    const meetsComplexity = strength?.meetsComplexity === true;

    const matchesConfirm = newPassword === confirmPassword;
    const confirmFilled = confirmPassword.length > 0;
    const currentFilled = currentPassword.length > 0;

    const canSubmit = !submitting
        && !blocked
        && newPassword.length > 0
        && meetsComplexity
        && confirmFilled
        && matchesConfirm
        && (!requiresCurrent || currentFilled);

    const handleNewPasswordChange = (e) => {
        const value = e.target.value;
        setNewPassword(value);
        if (typeof onPasswordInput === 'function') onPasswordInput(value);
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit({
            currentPassword: requiresCurrent ? currentPassword : '',
            newPassword,
            onDone: () => {
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                if (typeof onPasswordInput === 'function') onPasswordInput('');
            },
        });
    };

    const pct = Math.min(100, Math.max(0, (strengthScore / strengthMaxScore) * 100));
    const hasSubTitle = strengthLabel && newPassword.length > 0;

    return (
        <Card>
            <Head>
                <TitleGroup>
                    <Eyebrow>Пароль</Eyebrow>
                    <Title>{mode === 'change' ? 'Смена пароля' : 'Установка пароля'}</Title>
                    <Sub>
                        {mode === 'change'
                            ? 'После смены пароля все другие устройства будут автоматически разлогинены.'
                            : 'Установка пароля позволит входить по email, даже если Telegram будет недоступен.'}
                    </Sub>
                </TitleGroup>

                <StatusBadge $on={capability?.canChange === true}>
                    <FaLock size={12} aria-hidden="true" />
                    {capability?.canChange === true ? 'Задан' : 'Не задан'}
                </StatusBadge>
            </Head>

            {blocked && blockReason ? (
                <Warning>
                    <FaKey size={12} aria-hidden="true" />
                    <span>{blockReason}</span>
                </Warning>
            ) : null}

            <Form onSubmit={handleSubmit} noValidate>
                {requiresCurrent ? (
                    <Field>
                        <Label htmlFor="pwd-current">Текущий пароль</Label>
                        <Input
                            id="pwd-current"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            placeholder="Введите текущий пароль"
                            autoComplete="current-password"
                            required
                            disabled={blocked}
                        />
                    </Field>
                ) : null}

                <Field>
                    <Label htmlFor="pwd-new">Новый пароль</Label>
                    <Input
                        id="pwd-new"
                        type="password"
                        value={newPassword}
                        onChange={handleNewPasswordChange}
                        placeholder="Введите новый пароль"
                        autoComplete="new-password"
                        required
                        disabled={blocked}
                    />
                    <StrengthRow>
                        <StrengthBar>
                            <StrengthFill $tone={strengthTone} $pct={pct} />
                        </StrengthBar>
                        <StrengthLabel $tone={strengthTone}>
                            {hasSubTitle ? strengthLabel : '—'}
                        </StrengthLabel>
                    </StrengthRow>
                    {strengthChecks.length > 0 ? (
                        <Hints>
                            {strengthChecks.map((check) => (
                                <Hint key={check.id} $ok={check.ok === true}>
                                    {check.label}
                                </Hint>
                            ))}
                        </Hints>
                    ) : null}
                </Field>

                <Field>
                    <Label htmlFor="pwd-confirm">Подтвердите новый пароль</Label>
                    <Input
                        id="pwd-confirm"
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Повторите новый пароль"
                        autoComplete="new-password"
                        required
                        disabled={blocked}
                    />
                    {confirmFilled && !matchesConfirm ? (
                        <InlineError>Пароли не совпадают</InlineError>
                    ) : null}
                </Field>

                {error ? <ErrorStrip>{error}</ErrorStrip> : null}

                <Bottom>
                    <Button type="submit" $variant="primary" disabled={!canSubmit}>
                        <FaSave size={12} style={{ marginRight: 8 }} aria-hidden="true" />
                        {submitting
                            ? 'Сохраняем…'
                            : (mode === 'change' ? 'Сменить пароль' : 'Установить пароль')}
                    </Button>
                </Bottom>
            </Form>
        </Card>
    );
}

const Card = styled.section`
  border-radius: 22px;
  border: 0;
  background: #080808;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 18px;
  }
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const Title = styled.h2`
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;

  @media (max-width: 720px) {
    font-size: 19px;
  }
`;

const Sub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.55;
  max-width: 600px;
`;

const StatusBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  height: fit-content;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.88);
`;

const Warning = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12.5px;

  & > span {
    flex: 1;
    min-width: 0;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.label`
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.02em;
`;

const StrengthRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const StrengthBar = styled.div`
  flex: 1;
  height: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

const StrengthFill = styled.div`
  height: 100%;
  width: ${(p) => p.$pct}%;
  transition: width 0.25s ease, background 0.25s ease;
  background: ${(p) => {
        if (p.$tone === 'ok') return 'rgba(255, 255, 255, 0.12)';
        if (p.$tone === 'warn') return 'rgba(255, 255, 255, 0.10)';
        if (p.$tone === 'danger') return 'rgba(255, 255, 255, 0.10)';
        return 'rgba(255, 255, 255, 0.3)';
    }};
`;

const StrengthLabel = styled.div`
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  min-width: 70px;
  text-align: right;
  color: rgba(255, 255, 255, 0.55);
`;

const Hints = styled.div`
  display: flex;
  flex-wrap: wrap;
`;

const Hint = styled.div`
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  background: ${(p) => (p.$ok ? '#181818' : '#101010')};
  border: 0;
  color: ${(p) => (p.$ok ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.55)')};
  font-weight: 700;
`;

const InlineError = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.72);
`;

const ErrorStrip = styled.div`
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12.5px;
`;

const Bottom = styled.div`
  display: flex;
  justify-content: flex-end;
`;
