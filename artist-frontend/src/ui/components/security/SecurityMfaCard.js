import React, { useCallback, useState } from 'react';
import styled from 'styled-components';
import { QRCodeCanvas } from 'qrcode.react';
import { FaShieldAlt, FaQrcode, FaSync, FaPowerOff, FaCheckCircle, FaRegCopy, FaCheck, FaDownload } from 'react-icons/fa';

import Button from '../Button';
import Input from '../Input';

const onlyDigits = (v) => String(v || '').replaceAll(/\D+/g, '').slice(0, 6);

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

function CodeList({ codes, onCopyAll, onDownload }) {
    return (
        <CodeBlock>
            <CodeHead>
                <CodeHeadText>Сохраните эти коды в безопасном месте</CodeHeadText>
                <CodeActions>
                    <SmallButton type="button" onClick={onCopyAll}>
                        <FaRegCopy size={11} aria-hidden="true" />
                        <span>Скопировать</span>
                    </SmallButton>
                    <SmallButton type="button" onClick={onDownload}>
                        <FaDownload size={11} aria-hidden="true" />
                        <span>Скачать</span>
                    </SmallButton>
                </CodeActions>
            </CodeHead>
            <CodeGrid>
                {codes.map((c) => (
                    <CodeCell key={c}>{c}</CodeCell>
                ))}
            </CodeGrid>
            <CodeNote>Каждый код одноразовый. После использования удалите его из хранилища.</CodeNote>
        </CodeBlock>
    );
}

export default function SecurityMfaCard({
    mfa,
    capability,
    enabledAtLabel,
    onStartSetup,
    onConfirmEnable,
    onFinishSetup,
    onDisable,
    onRegenerate,
    setupData,
    recoveryCodes,
    submitting,
    error,
}) {
    const [tokenEnable, setTokenEnable] = useState('');
    const [tokenDisable, setTokenDisable] = useState('');
    const [recoveryDisable, setRecoveryDisable] = useState('');
    const [useRecovery, setUseRecovery] = useState(false);
    const [secretCopied, setSecretCopied] = useState(false);

    const mfaEnabled = mfa?.enabled === true;
    const recoveryCodesRemaining = Number.isFinite(Number(mfa?.recoveryCodesRemaining))
        ? Number(mfa.recoveryCodesRemaining)
        : 0;
    const canDisable = capability?.canDisable === true;
    const canRegenerate = capability?.canRegenerateRecovery === true;
    const canSetup = capability?.canSetup === true;

    const secret = setupData && typeof setupData.secretBase32 === 'string' ? setupData.secretBase32 : '';
    const otpauthUrl = setupData && typeof setupData.otpauthUrl === 'string' ? setupData.otpauthUrl : '';

    const showCodes = Array.isArray(recoveryCodes) && recoveryCodes.length > 0;
    const codesText = showCodes ? recoveryCodes.join('\n') : '';

    const onCopyAll = useCallback(() => {
        if (!codesText) return;
        void copyTextToClipboard(codesText);
    }, [codesText]);

    const onDownload = useCallback(() => {
        if (!codesText) return;
        const ts = new Date().toISOString().slice(0, 10);
        downloadTextFile(`earflow-recovery-codes-${ts}.txt`, codesText);
    }, [codesText]);

    const onCopySecret = useCallback(async () => {
        if (!secret) return;
        const ok = await copyTextToClipboard(secret);
        if (!ok) return;
        setSecretCopied(true);
        window.setTimeout(() => setSecretCopied(false), 1600);
    }, [secret]);

    const enableReady = onlyDigits(tokenEnable).length === 6;
    const disableReady = useRecovery
        ? String(recoveryDisable).trim().length > 0
        : onlyDigits(tokenDisable).length === 6;

    const handleEnable = () => {
        if (!enableReady) return;
        onConfirmEnable(onlyDigits(tokenEnable));
    };

    const handleDisable = () => {
        if (!disableReady) return;
        if (useRecovery) {
            onDisable({ recoveryCode: String(recoveryDisable).trim() });
            return;
        }
        onDisable({ token: onlyDigits(tokenDisable) });
    };

    return (
        <Card>
            <Head>
                <TitleGroup>
                    <Eyebrow>Двухфакторная защита</Eyebrow>
                    <Title>TOTP (Time-Based One-Time Password)</Title>
                    <Sub>
                        Вход защищается кодом из приложения-аутентификатора (Google Authenticator, Authy, 1Password, Bitwarden и др.).
                        Чувствительные действия подтверждаются step-up проверкой.
                    </Sub>
                </TitleGroup>

                <StatusBadge $on={mfaEnabled}>
                    <FaShieldAlt size={12} aria-hidden="true" />
                    {mfaEnabled ? 'Активна' : 'Выключена'}
                </StatusBadge>
            </Head>

            {mfaEnabled ? (
                <ActiveBlock>
                    <Meta>
                        <MetaItem>
                            <MetaLabel>Включена</MetaLabel>
                            <MetaValue>{enabledAtLabel || '—'}</MetaValue>
                        </MetaItem>
                        <MetaItem>
                            <MetaLabel>Recovery-коды</MetaLabel>
                            <MetaValue>{recoveryCodesRemaining} из 10</MetaValue>
                        </MetaItem>
                    </Meta>

                    {showCodes ? (
                        <CodeList codes={recoveryCodes} onCopyAll={onCopyAll} onDownload={onDownload} />
                    ) : null}

                    <SectionDivider aria-hidden="true" />

                    <SectionTitle>Регенерация recovery-кодов</SectionTitle>
                    <SectionSub>
                        Если сомневаетесь в сохранности старых кодов — сгенерируйте новые.
                        Старые коды перестанут работать сразу.
                    </SectionSub>
                    <ActionRow>
                        <Button type="button" onClick={onRegenerate} disabled={submitting || !canRegenerate}>
                            <FaSync size={12} style={{ marginRight: 8 }} aria-hidden="true" />
                            {submitting ? 'Генерируем…' : 'Сгенерировать новые'}
                        </Button>
                    </ActionRow>

                    <SectionDivider aria-hidden="true" />

                    <SectionTitle>Отключить 2FA</SectionTitle>
                    <SectionSub>
                        Подтвердите операцию кодом из приложения или одним из recovery-кодов.
                        После отключения каталог снова станет доступен без 2FA — это менее безопасно.
                    </SectionSub>

                    <ToggleRow>
                        <ToggleChip type="button" $active={!useRecovery} onClick={() => setUseRecovery(false)}>
                            Код TOTP
                        </ToggleChip>
                        <ToggleChip type="button" $active={useRecovery} onClick={() => setUseRecovery(true)}>
                            Recovery-код
                        </ToggleChip>
                    </ToggleRow>

                    {useRecovery ? (
                        <Field>
                            <Label>Recovery-код</Label>
                            <Input
                                value={recoveryDisable}
                                onChange={(e) => setRecoveryDisable(e.target.value)}
                                placeholder="abcd-efgh-ijkl"
                                autoComplete="one-time-code"
                            />
                        </Field>
                    ) : (
                        <Field>
                            <Label>Код из приложения (6 цифр)</Label>
                            <Input
                                value={tokenDisable}
                                onChange={(e) => setTokenDisable(onlyDigits(e.target.value))}
                                inputMode="numeric"
                                placeholder="123456"
                                autoComplete="one-time-code"
                            />
                        </Field>
                    )}

                    <ActionRow>
                        <DangerButton
                            type="button"
                            onClick={handleDisable}
                            disabled={submitting || !canDisable || !disableReady}
                        >
                            <FaPowerOff size={12} style={{ marginRight: 8 }} aria-hidden="true" />
                            {submitting ? 'Отключаем…' : 'Отключить 2FA'}
                        </DangerButton>
                    </ActionRow>

                    {error ? <ErrorStrip>{error}</ErrorStrip> : null}
                </ActiveBlock>
            ) : (
                <InactiveBlock>
                    {!setupData ? (
                        <>
                            <SectionSub>
                                Без 2FA ваш каталог и профиль уязвимы к взлому по паролю.
                                Настройка занимает меньше минуты.
                            </SectionSub>
                            <ActionRow>
                                <Button type="button" $variant="primary" onClick={onStartSetup} disabled={submitting || !canSetup}>
                                    <FaQrcode size={12} style={{ marginRight: 8 }} aria-hidden="true" />
                                    {submitting ? 'Готовим…' : 'Начать настройку 2FA'}
                                </Button>
                            </ActionRow>
                            {error ? <ErrorStrip>{error}</ErrorStrip> : null}
                        </>
                    ) : (
                        <>
                            <StepTitle>1. Отсканируйте QR в приложении</StepTitle>
                            <StepSub>
                                Откройте приложение-аутентификатор и добавьте новую запись сканированием QR-кода.
                                Приложение начнёт показывать 6-значные коды, обновляющиеся каждые 30 секунд.
                            </StepSub>
                            <QrBox>
                                {otpauthUrl ? (
                                    <QRCodeCanvas value={otpauthUrl} size={176} includeMargin bgColor="#111" fgColor="#fff" />
                                ) : null}
                            </QrBox>

                            <StepTitle>2. Или введите secret вручную</StepTitle>
                            <SecretRow>
                                <SecretBox aria-label="Секретный ключ">{secret || '—'}</SecretBox>
                                <SmallButton type="button" onClick={onCopySecret} disabled={!secret}>
                                    {secretCopied ? <FaCheck size={11} aria-hidden="true" /> : <FaRegCopy size={11} aria-hidden="true" />}
                                    <span>{secretCopied ? 'Скопировано' : 'Скопировать'}</span>
                                </SmallButton>
                            </SecretRow>

                            <StepTitle>3. Подтвердите код из приложения</StepTitle>
                            <Field>
                                <Label>Код (6 цифр)</Label>
                                <Input
                                    value={tokenEnable}
                                    onChange={(e) => setTokenEnable(onlyDigits(e.target.value))}
                                    inputMode="numeric"
                                    placeholder="123456"
                                    autoComplete="one-time-code"
                                    autoFocus
                                />
                            </Field>

                            <ActionRow>
                                <Button
                                    type="button"
                                    $variant="primary"
                                    onClick={handleEnable}
                                    disabled={submitting || !enableReady}
                                >
                                    <FaCheckCircle size={12} style={{ marginRight: 8 }} aria-hidden="true" />
                                    {submitting ? 'Включаем…' : 'Включить 2FA'}
                                </Button>
                            </ActionRow>

                            {showCodes ? (
                                <>
                                    <SectionDivider aria-hidden="true" />
                                    <StepTitle>4. Сохраните recovery-коды</StepTitle>
                                    <SectionSub>
                                        Без приложения — коды единственный способ войти.
                                        Сохраните офлайн (менеджер паролей / печать / сейф).
                                    </SectionSub>
                                    <CodeList codes={recoveryCodes} onCopyAll={onCopyAll} onDownload={onDownload} />
                                    <ActionRow>
                                        <Button type="button" $variant="primary" onClick={onFinishSetup} disabled={submitting}>
                                            Я сохранил коды, продолжить
                                        </Button>
                                    </ActionRow>
                                </>
                            ) : null}

                            {error ? <ErrorStrip>{error}</ErrorStrip> : null}
                        </>
                    )}
                </InactiveBlock>
            )}
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
  gap: 16px;

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
  max-width: 620px;
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

const ActiveBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const InactiveBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Meta = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 540px) {
    grid-template-columns: 1fr;
  }
`;

const MetaItem = styled.div`
  padding: 12px 14px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.03);
`;

const MetaLabel = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 4px;
`;

const MetaValue = styled.div`
  font-size: 14px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.95);
`;

const SectionDivider = styled.div`
  height: 1px;
  background: #111;
  margin: 6px 0;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.95);
`;

const SectionSub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12.5px;
  line-height: 1.55;
`;

const StepTitle = styled.h3`
  margin: 4px 0 -4px;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.82);
`;

const StepSub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12.5px;
  line-height: 1.55;
`;

const QrBox = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.04);
  border: 0;
`;

const SecretRow = styled.div`
  display: flex;
  gap: 8px;
  align-items: stretch;
  flex-wrap: wrap;
`;

const SecretBox = styled.div`
  flex: 1 1 240px;
  min-width: 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 0;
  color: rgba(255, 255, 255, 0.9);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 13px;
  letter-spacing: 0.04em;
  word-break: break-all;
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

const ActionRow = styled.div`
  display: flex;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 10px;
`;

const ToggleRow = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const ToggleChip = styled.button`
  appearance: none;
  border: 0;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.25)')};
  color: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.75)')};
  border-radius: 10px;
  padding: 6px 12px;
  font-size: 11.5px;
  font-weight: 800;
  cursor: pointer;
  letter-spacing: 0.02em;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.98);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.45);
    outline-offset: 2px;
  }
`;

const SmallButton = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.5);
    outline-offset: 2px;
  }
`;

const DangerButton = styled.button`
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.78);
  border-radius: 14px;
  padding: 12px 18px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.02em;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.10);
    border-color: transparent;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.72);
    outline-offset: 2px;
  }
`;

const CodeBlock = styled.div`
  padding: 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const CodeHead = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
`;

const CodeHeadText = styled.div`
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 700;
  letter-spacing: 0.04em;
`;

const CodeActions = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const CodeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 8px;
`;

const CodeCell = styled.div`
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.35);
  border: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 0.04em;
  text-align: center;
  user-select: all;
`;

const CodeNote = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.10);
`;

const ErrorStrip = styled.div`
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12.5px;
`;
