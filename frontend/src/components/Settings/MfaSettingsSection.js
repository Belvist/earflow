import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { QRCodeSVG } from 'qrcode.react';
import { FaShieldAlt, FaRegCopy, FaCheck, FaDownload } from 'react-icons/fa';
import apiClient from '../../api/client';
import StepUpModal from './StepUpModal';
import { useStepUpRunner } from '../../hooks/useStepUpRunner';
import { runSensitiveSessionAction } from './activeSessionsStepUp';

const SURFACE = '#282828';
const onlyDigits = (v) => String(v || '').replace(/\D+/g, '').slice(0, 6);

function formatDateLabel(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

function mapMfaError(e, fallback) {
  const code = String(e?.code || '').trim().toUpperCase();
  if (code === 'MFA_ALREADY_ENABLED') return '2FA уже включена';
  if (code === 'MFA_NOT_ENABLED') return '2FA не включена';
  if (code === 'MFA_SETUP_REQUIRED') return 'Сначала запустите настройку 2FA';
  if (code === 'INVALID_2FA_CODE') return 'Неверный код. Проверьте и попробуйте ещё раз.';
  if (code === 'TOKEN_REQUIRED') return 'Введите код из приложения-аутентификатора';
  if (code === 'MFA_STEP_UP_REQUIRED') return 'Нужно подтверждение 2FA';
  return e?.message || fallback;
}

function downloadTextFile(filename, text) {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch {
    // ignore
  }
}

async function copyTextToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}

export default function MfaSettingsSection() {
  const { stepUp } = useStepUpRunner();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [setupData, setSetupData] = useState(null);
  const [tokenEnable, setTokenEnable] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState(null);
  const [tokenDisable, setTokenDisable] = useState('');
  const [useRecoveryDisable, setUseRecoveryDisable] = useState(false);
  const [recoveryDisable, setRecoveryDisable] = useState('');
  const [copied, setCopied] = useState('');

  const loadStatus = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await apiClient.getMfaStatus();
      setStatus(data);
    } catch (e) {
      setStatus(null);
      setError(e?.message || 'Не удалось загрузить статус 2FA');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const mfaEnabled = status?.enabled === true;
  const recoveryRemaining = Number.isFinite(Number(status?.recoveryCodesRemaining))
    ? Number(status.recoveryCodesRemaining)
    : 0;

  const startSetup = useCallback(async () => {
    setBusy('setup');
    setError('');
    try {
      const data = await apiClient.mfaSetup();
      setSetupData(data);
      setRecoveryCodes(null);
      setTokenEnable('');
    } catch (e) {
      setError(mapMfaError(e, 'Не удалось начать настройку 2FA'));
    } finally {
      setBusy('');
    }
  }, []);

  const cancelSetup = useCallback(() => {
    setSetupData(null);
    setTokenEnable('');
    setError('');
  }, []);

  const confirmEnable = useCallback(async () => {
    const t = onlyDigits(tokenEnable);
    if (t.length !== 6) {
      setError('Введите 6 цифр кода из приложения-аутентификатора');
      return;
    }
    setBusy('enable');
    setError('');
    try {
      const data = await apiClient.mfaEnable({ token: t });
      setRecoveryCodes(Array.isArray(data?.recoveryCodes) ? data.recoveryCodes : null);
      setSetupData(null);
      setTokenEnable('');
      await loadStatus();
    } catch (e) {
      setError(mapMfaError(e, 'Не удалось включить 2FA'));
    } finally {
      setBusy('');
    }
  }, [tokenEnable, loadStatus]);

  const handleDisable = useCallback(async () => {
    if (busy) return;
    setError('');
    setBusy('disable');
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: async () => {
          if (useRecoveryDisable) {
            await apiClient.mfaDisable({ recoveryCode: String(recoveryDisable || '').trim() });
          } else {
            await apiClient.mfaDisable({ token: onlyDigits(tokenDisable) });
          }
        },
      });
      setTokenDisable('');
      setRecoveryDisable('');
      setUseRecoveryDisable(false);
      await loadStatus();
    } catch (e) {
      setError(mapMfaError(e, 'Не удалось выключить 2FA'));
    } finally {
      setBusy('');
    }
  }, [busy, stepUp, useRecoveryDisable, recoveryDisable, tokenDisable, loadStatus]);

  const handleRegenerate = useCallback(async () => {
    if (busy) return;
    setError('');
    setBusy('regen');
    try {
      await runSensitiveSessionAction({
        stepUp,
        action: async () => {
          const data = await apiClient.mfaRegenerateRecovery();
          setRecoveryCodes(Array.isArray(data?.recoveryCodes) ? data.recoveryCodes : null);
          await loadStatus();
        },
      });
    } catch (e) {
      setError(mapMfaError(e, 'Не удалось перегенерировать коды'));
    } finally {
      setBusy('');
    }
  }, [busy, stepUp, loadStatus]);

  const onCopy = useCallback(async (text, key) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    setCopied(key);
    window.setTimeout(() => setCopied(''), 1600);
  }, []);

  const codesText = Array.isArray(recoveryCodes) ? recoveryCodes.join('\n') : '';
  const secret = setupData?.secretBase32 || '';
  const otpauthUrl = setupData?.otpauthUrl || '';

  if (loading) {
    return (
      <Section>
        <SectionTitle>Двухфакторная аутентификация</SectionTitle>
        <MutedState>Загружаем статус…</MutedState>
      </Section>
    );
  }

  return (
    <Section>
      <StepUpModal open={stepUp.open} onClose={stepUp.close} onSuccess={stepUp.onSuccess} />
      {stepUp.error ? <ErrorStrip>{stepUp.error}</ErrorStrip> : null}
      {error ? <ErrorStrip>{error}</ErrorStrip> : null}

      <SectionHead>
        <SectionTitle>Двухфакторная аутентификация</SectionTitle>
        <StatusBadge $on={mfaEnabled}>
          <FaShieldAlt size={11} aria-hidden />
          {mfaEnabled ? 'Включена' : 'Выключена'}
        </StatusBadge>
      </SectionHead>

      <InfoCard>
        Двухфакторная аутентификация (TOTP) защищает вход и чувствительные действия
        (смена пароля, завершение сессий, отвязка Telegram) кодом из приложения-аутентификатора
        (Google Authenticator, Authy, 1Password и др.).
      </InfoCard>

      {!mfaEnabled ? (
        <>
          {!setupData ? (
            <SuggestCard>
              <SuggestText>
                Рекомендуем включить: код из приложения закрывает вход даже при утечке
                пароля. Настройка занимает минуту.
              </SuggestText>
              <BtnPrimary type="button" onClick={startSetup} disabled={busy !== ''}>
                {busy === 'setup' ? 'Готовим…' : 'Включить 2FA'}
              </BtnPrimary>
            </SuggestCard>
          ) : (
            <SetupPanel>
              <StepLabel>Шаг 1. Отсканируйте QR-код</StepLabel>
              <Hint>
                Откройте приложение-аутентификатор и отсканируйте этот код, либо введите
                секретный ключ вручную.
              </Hint>
              <QrRow>
                <QrBox>
                  {otpauthUrl ? (
                    <QRCodeSVG value={otpauthUrl} size={168} level="M" includeMargin />
                  ) : (
                    <QrPlaceholder>QR…</QrPlaceholder>
                  )}
                </QrBox>
                {secret ? (
                  <SecretBox>
                    <SecretLabel>Секретный ключ</SecretLabel>
                    <SecretRow>
                      <SecretValue>{secret}</SecretValue>
                      <IconBtn
                        type="button"
                        aria-label="Скопировать ключ"
                        onClick={() => onCopy(secret, 'secret')}
                      >
                        {copied === 'secret' ? <FaCheck size={12} /> : <FaRegCopy size={12} />}
                      </IconBtn>
                    </SecretRow>
                  </SecretBox>
                ) : null}
              </QrRow>

              <StepLabel>Шаг 2. Введите код из приложения</StepLabel>
              <Field>
                <Label>6-значный код TOTP</Label>
                <Input
                  value={tokenEnable}
                  onChange={(e) => setTokenEnable(onlyDigits(e.target.value))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  disabled={busy !== ''}
                />
              </Field>
              <PairActions>
                <BtnPrimary
                  type="button"
                  onClick={confirmEnable}
                  disabled={busy !== '' || onlyDigits(tokenEnable).length !== 6}
                >
                  {busy === 'enable' ? 'Проверяем…' : 'Включить 2FA'}
                </BtnPrimary>
                <BtnGhost type="button" onClick={cancelSetup} disabled={busy !== ''}>
                  Отмена
                </BtnGhost>
              </PairActions>
            </SetupPanel>
          )}
        </>
      ) : (
        <>
          <ActiveBlock>
            <Meta>
              <MetaItem>
                <MetaLabel>Включена</MetaLabel>
                <MetaValue>{formatDateLabel(status?.enabledAt)}</MetaValue>
              </MetaItem>
              <MetaItem>
                <MetaLabel>Recovery-коды</MetaLabel>
                <MetaValue>
                  {recoveryRemaining} из 10
                  {recoveryRemaining <= 2 ? (
                    <Warn> — осталось мало, перегенерируйте</Warn>
                  ) : null}
                </MetaValue>
              </MetaItem>
            </Meta>
          </ActiveBlock>

          {recoveryCodes && codesText ? (
            <CodeBlock>
              <CodeHead>
                <CodeHeadText>Сохраните эти коды в безопасном месте</CodeHeadText>
                <CodeActions>
                  <SmallButton type="button" onClick={() => onCopy(codesText, 'codes')}>
                    {copied === 'codes' ? <FaCheck size={11} /> : <FaRegCopy size={11} />}
                    <span>{copied === 'codes' ? 'Скопировано' : 'Скопировать'}</span>
                  </SmallButton>
                  <SmallButton
                    type="button"
                    onClick={() =>
                      downloadTextFile(
                        `earflow-recovery-codes-${new Date().toISOString().slice(0, 10)}.txt`,
                        codesText,
                      )
                    }
                  >
                    <FaDownload size={11} />
                    <span>Скачать</span>
                  </SmallButton>
                </CodeActions>
              </CodeHead>
              <CodeGrid>
                {recoveryCodes.map((c) => (
                  <CodeCell key={c}>{c}</CodeCell>
                ))}
              </CodeGrid>
              <CodeNote>Каждый код одноразовый. После использования удалите его из хранилища.</CodeNote>
              <SmallButton type="button" onClick={() => setRecoveryCodes(null)}>
                Скрыть коды
              </SmallButton>
            </CodeBlock>
          ) : null}

          {!recoveryCodes ? (
            <BtnGhost type="button" onClick={handleRegenerate} disabled={busy !== ''}>
              {busy === 'regen' ? 'Генерируем…' : 'Перегенерировать recovery-коды'}
            </BtnGhost>
          ) : null}

          <DisableCard>
            <DisableTitle>Выключить 2FA</DisableTitle>
            {useRecoveryDisable ? (
              <Field>
                <Label>Recovery code</Label>
                <Input
                  value={recoveryDisable}
                  onChange={(e) => setRecoveryDisable(e.target.value)}
                  placeholder="abcd-efgh-ijkl"
                  disabled={busy !== ''}
                />
              </Field>
            ) : (
              <Field>
                <Label>Код TOTP</Label>
                <Input
                  value={tokenDisable}
                  onChange={(e) => setTokenDisable(onlyDigits(e.target.value))}
                  inputMode="numeric"
                  placeholder="123456"
                  disabled={busy !== ''}
                />
              </Field>
            )}
            <DisableActions>
              <BtnDanger type="button" onClick={handleDisable} disabled={busy !== ''}>
                {busy === 'disable' ? 'Выключаем…' : 'Выключить 2FA'}
              </BtnDanger>
              <GhostToggle
                type="button"
                onClick={() => {
                  setUseRecoveryDisable((v) => !v);
                  setTokenDisable('');
                  setRecoveryDisable('');
                }}
                disabled={busy !== ''}
              >
                {useRecoveryDisable ? 'Ввести код TOTP' : 'Использовать recovery code'}
              </GhostToggle>
            </DisableActions>
          </DisableCard>
        </>
      )}
    </Section>
  );
}

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

const StatusBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: ${(p) => (p.$on ? 'rgba(29, 185, 84, 0.16)' : 'rgba(255, 255, 255, 0.1)')};
  color: ${(p) => (p.$on ? '#5fff8d' : 'rgba(255, 255, 255, 0.65)')};
  flex-shrink: 0;
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
  padding: 10px 0;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
`;

const SuggestCard = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(29, 185, 84, 0.07);
  border: 1px solid rgba(29, 185, 84, 0.25);

  & > button {
    flex-shrink: 0;
  }

  @media (min-width: 561px) {
    & > button {
      align-self: center;
    }
  }

  @media (max-width: 560px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const SuggestText = styled.p`
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.72);
`;

const DisableCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(255, 69, 58, 0.05);
  border: 1px solid rgba(255, 69, 58, 0.22);
`;

const DisableTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
`;

const DisableActions = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
`;

const ErrorStrip = styled.div`
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(255, 69, 58, 0.12);
  color: #ff8a84;
  font-size: 13px;
`;

const SetupPanel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: ${SURFACE};
  border: 1px solid rgba(255, 255, 255, 0.1);
`;

const StepLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #fff;
`;

const Hint = styled.p`
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
`;

const QrRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
`;

const QrBox = styled.div`
  background: #fff;
  border-radius: 14px;
  padding: 8px;
  display: inline-flex;
`;

const QrPlaceholder = styled.div`
  width: 168px;
  height: 168px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
`;

const SecretBox = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SecretLabel = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
`;

const SecretRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SecretValue = styled.code`
  font-size: 13px;
  color: #fff;
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 10px;
  border-radius: 8px;
  word-break: break-all;
`;

const IconBtn = styled.button`
  appearance: none;
  border: 0;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.8);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
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
  background: rgba(0, 0, 0, 0.2);
  color: #fff;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
  }
`;

const PairActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const Btn = styled.button`
  appearance: none;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const BtnPrimary = styled(Btn)`
  border: 0;
  background: #1db954;
  color: #000;
  align-self: flex-start;
`;

const BtnGhost = styled(Btn)`
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
`;

const BtnDanger = styled(Btn)`
  border: 1px solid rgba(255, 69, 58, 0.35);
  background: transparent;
  color: #ff8a84;
`;

const GhostToggle = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  align-self: flex-start;
  font-family: inherit;

  &:disabled {
    opacity: 0.55;
  }
`;

const ActiveBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  padding: 14px 16px;
  border-radius: 12px;
  background: ${SURFACE};
`;

const MetaItem = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const MetaLabel = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
`;

const MetaValue = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #fff;
`;

const Warn = styled.span`
  color: #f5b7b1;
  font-weight: 400;
  font-size: 12px;
`;

const CodeBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  background: ${SURFACE};
  border: 1px solid rgba(255, 255, 255, 0.1);
`;

const CodeHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
`;

const CodeHeadText = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #fff;
`;

const CodeActions = styled.div`
  display: flex;
  gap: 8px;
`;

const SmallButton = styled.button`
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-family: inherit;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
  }
`;

const CodeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px;
`;

const CodeCell = styled.div`
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.3);
  font-family: monospace;
  font-size: 13px;
  color: #fff;
  text-align: center;
`;

const CodeNote = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.5;
`;