import React, { useCallback, useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';

import Shell from '../layout/Shell';
import ArtistTopBar from '../components/ArtistTopBar';
import StepUpModal from '../components/StepUpModal';
import {
    SecurityHero,
    SecurityStats,
    SecurityMfaCard,
    SecurityPasswordCard,
    SecurityTelegramCard,
    SecuritySessionsCard,
} from '../components/security';
import { useAuth } from '../../state/auth/AuthContext';
import { securityUsecase } from '../../usecases/securityUsecase';

const PASSWORD_STRENGTH_DEBOUNCE_MS = 350;

function safeText(v) {
    if (v === null || v === undefined) return '';
    return String(v);
}

function mapError(result, fallback) {
    const type = result?.error?.type;
    const code = result?.error?.code;
    const status = Number(result?.error?.status) || 0;

    if (type === 'stepup_required') return { stepup: true };
    if (type === 'mfa_required') return { message: 'Для действия требуется 2FA' };
    if (type === 'unauthorized') return { message: 'Требуется повторный вход' };
    if (type === 'csrf') return { message: 'Защита запроса сработала. Обновите страницу и повторите.' };

    if (status === 400 && code === 'INVALID_CURRENT_PASSWORD') return { message: 'Текущий пароль неверный' };
    if (status === 400 && code === 'CURRENT_PASSWORD_REQUIRED') return { message: 'Введите текущий пароль' };
    if (status === 400 && code === 'NEW_PASSWORD_REQUIRED') return { message: 'Введите новый пароль' };
    if (status === 400 && code === 'WEAK_PASSWORD') return { message: 'Пароль не соответствует требованиям безопасности' };
    if (status === 403 && code === 'MFA_REQUIRED_TO_SET_PASSWORD') {
        return { message: 'Сначала включите 2FA — установка пароля доступна только после этого' };
    }

    if (status === 409 && code === 'TELEGRAM_NOT_LINKED') return { message: 'Telegram уже отвязан' };
    if (status === 409 && code === 'PASSWORD_REQUIRED_BEFORE_UNLINK') {
        return { message: 'Сначала установите пароль — иначе потеряете доступ' };
    }
    if (status === 409) return { message: 'Действие невозможно в текущем состоянии' };

    if (status === 429) return { message: 'Слишком много попыток, попробуйте через минуту' };
    if (status === 503) return { message: 'Сервис временно недоступен' };

    return { message: fallback || 'Не удалось выполнить действие' };
}

export default function SecurityPage() {
    const { portal, logout, refresh, refreshPortal } = useAuth();
    const nav = useNavigate();

    const [overview, setOverview] = useState(null);
    const [overviewError, setOverviewError] = useState('');
    const [overviewLoading, setOverviewLoading] = useState(true);

    const [passwordStrength, setPasswordStrength] = useState(null);
    const strengthTimerRef = useRef(0);
    const strengthRequestRef = useRef(0);

    const [setupData, setSetupData] = useState(null);
    const [recoveryCodes, setRecoveryCodes] = useState(null);

    const [mfaBusy, setMfaBusy] = useState(false);
    const [passwordBusy, setPasswordBusy] = useState(false);
    const [telegramBusy, setTelegramBusy] = useState(false);
    const [sessionsBusy, setSessionsBusy] = useState(false);

    const [mfaError, setMfaError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [telegramError, setTelegramError] = useState('');
    const [sessionsError, setSessionsError] = useState('');

    const [notice, setNotice] = useState(null);
    const [stepUpOpen, setStepUpOpen] = useState(false);

    const pendingRef = useRef(null);
    const passwordResetRef = useRef(null);

    useEffect(() => {
        if (!notice) return undefined;
        const timer = setTimeout(() => setNotice(null), 4200);
        return () => clearTimeout(timer);
    }, [notice]);

    const loadOverview = useCallback(async ({ silent = false } = {}) => {
        if (!silent) setOverviewLoading(true);
        setOverviewError('');
        const res = await securityUsecase.loadOverview();
        if (res.ok) {
            setOverview(res.data);
        } else {
            const info = mapError(res, 'Не удалось загрузить данные безопасности');
            if (res.error?.type === 'unauthorized') {
                setOverviewError('Требуется повторный вход');
            } else {
                setOverviewError(info.message || 'Не удалось загрузить данные');
            }
        }
        if (!silent) setOverviewLoading(false);
    }, []);

    useEffect(() => {
        void loadOverview();
    }, [loadOverview]);

    useEffect(() => () => {
        if (strengthTimerRef.current) {
            window.clearTimeout(strengthTimerRef.current);
            strengthTimerRef.current = 0;
        }
    }, []);

    const requestStrength = useCallback((password) => {
        if (strengthTimerRef.current) {
            window.clearTimeout(strengthTimerRef.current);
            strengthTimerRef.current = 0;
        }
        if (!password) {
            setPasswordStrength(null);
            return;
        }
        const requestId = ++strengthRequestRef.current;
        strengthTimerRef.current = window.setTimeout(async () => {
            const res = await securityUsecase.checkPasswordStrength({ password });
            if (requestId !== strengthRequestRef.current) return;
            if (res.ok) {
                setPasswordStrength(res.data);
            }
        }, PASSWORD_STRENGTH_DEBOUNCE_MS);
    }, []);

    const handleRedirect = useCallback((info) => {
        if (!info?.redirect) return false;
        setNotice({ kind: 'error', text: info.message || '' });
        nav(info.redirect, { replace: true });
        return true;
    }, [nav]);

    const runAction = useCallback(async (pending) => {
        if (!pending || typeof pending !== 'object') return;

        if (pending.kind === 'startSetup') {
            setMfaBusy(true);
            setMfaError('');
            try {
                const res = await securityUsecase.mfaSetup();
                if (res.ok) {
                    setSetupData(res.data);
                    return;
                }
                const info = mapError(res, 'Не удалось начать настройку');
                setMfaError(info.message || 'Не удалось начать настройку');
            } finally {
                setMfaBusy(false);
            }
            return;
        }

        if (pending.kind === 'confirmEnable') {
            setMfaBusy(true);
            setMfaError('');
            try {
                const res = await securityUsecase.mfaEnable({ token: pending.token });
                if (res.ok) {
                    if (Array.isArray(res.data?.recoveryCodes)) {
                        setRecoveryCodes(res.data.recoveryCodes);
                    }
                    setNotice({ kind: 'success', text: '2FA успешно включена' });
                    await loadOverview({ silent: true });
                    await refreshPortal();
                    return;
                }
                const info = mapError(res, 'Не удалось включить 2FA');
                const rawCode = res.error?.raw?.code;
                if (rawCode === 'MFA already enabled') {
                    await refresh();
                    setNotice({ kind: 'success', text: '2FA уже включена' });
                    nav('/', { replace: true });
                    return;
                }
                setMfaError(info.message || 'Неверный код');
            } finally {
                setMfaBusy(false);
            }
            return;
        }

        if (pending.kind === 'finishSetup') {
            setRecoveryCodes(null);
            setSetupData(null);
            setMfaError('');
            await refresh();
            await loadOverview({ silent: true });
            return;
        }

        if (pending.kind === 'disable') {
            setMfaBusy(true);
            setMfaError('');
            try {
                const res = await securityUsecase.mfaDisable({
                    token: pending.token,
                    recoveryCode: pending.recoveryCode,
                });
                if (res.ok) {
                    setNotice({ kind: 'success', text: '2FA отключена' });
                    setRecoveryCodes(null);
                    setSetupData(null);
                    await loadOverview({ silent: true });
                    await refreshPortal();
                    return;
                }
                const info = mapError(res, 'Не удалось отключить 2FA');
                setMfaError(info.message || 'Неверный код');
            } finally {
                setMfaBusy(false);
            }
            return;
        }

        if (pending.kind === 'regenerate') {
            setMfaBusy(true);
            setMfaError('');
            try {
                const res = await securityUsecase.mfaRegenerateRecoveryCodes();
                if (res.ok && Array.isArray(res.data?.recoveryCodes)) {
                    setRecoveryCodes(res.data.recoveryCodes);
                    setNotice({ kind: 'success', text: 'Сгенерированы новые recovery-коды' });
                    await loadOverview({ silent: true });
                    return;
                }
                const info = mapError(res, 'Не удалось обновить коды');
                if (info.stepup) {
                    pendingRef.current = pending;
                    setStepUpOpen(true);
                    return;
                }
                if (handleRedirect(info)) return;
                setMfaError(info.message || 'Не удалось обновить коды');
            } finally {
                setMfaBusy(false);
            }
            return;
        }

        if (pending.kind === 'changePassword') {
            setPasswordBusy(true);
            setPasswordError('');
            try {
                const res = await securityUsecase.changePassword({
                    currentPassword: pending.currentPassword,
                    newPassword: pending.newPassword,
                });
                if (res.ok) {
                    if (typeof pending.onDone === 'function') {
                        try { pending.onDone(); } catch { /* noop */ }
                    }
                    if (typeof passwordResetRef.current === 'function') {
                        try { passwordResetRef.current(); } catch { /* noop */ }
                    }
                    setPasswordStrength(null);
                    const revoked = Number(res.data?.revokedOtherSessions) || 0;
                    const hadPassword = overview?.account?.hasPassword === true;
                    const base = hadPassword ? 'Пароль обновлён' : 'Пароль установлен';
                    const tail = revoked > 0 ? ` · Завершено ${revoked} других сессий` : '';
                    setNotice({ kind: 'success', text: base + tail });
                    await refresh();
                    await loadOverview({ silent: true });
                    return;
                }
                const info = mapError(res, 'Не удалось изменить пароль');
                if (info.stepup) {
                    pendingRef.current = pending;
                    setStepUpOpen(true);
                    return;
                }
                if (handleRedirect(info)) return;
                setPasswordError(info.message || 'Не удалось изменить пароль');
            } finally {
                setPasswordBusy(false);
            }
            return;
        }

        if (pending.kind === 'telegramUnlink') {
            setTelegramBusy(true);
            setTelegramError('');
            try {
                const res = await securityUsecase.unlinkTelegram();
                if (res.ok) {
                    setNotice({ kind: 'success', text: 'Telegram отвязан' });
                    await refresh();
                    await loadOverview({ silent: true });
                    return;
                }
                const info = mapError(res, 'Не удалось отвязать Telegram');
                if (info.stepup) {
                    pendingRef.current = pending;
                    setStepUpOpen(true);
                    return;
                }
                if (handleRedirect(info)) return;
                setTelegramError(info.message || 'Не удалось отвязать Telegram');
            } finally {
                setTelegramBusy(false);
            }
            return;
        }

        if (pending.kind === 'revokeOthers') {
            setSessionsBusy(true);
            setSessionsError('');
            try {
                const res = await securityUsecase.revokeOtherSessions();
                if (res.ok) {
                    const count = Number(res.data?.revoked) || 0;
                    setNotice({
                        kind: 'success',
                        text: count > 0 ? `Завершено ${count} сессий` : 'Других сессий нет',
                    });
                    await loadOverview({ silent: true });
                    return;
                }
                const info = mapError(res, 'Не удалось завершить сессии');
                if (info.stepup) {
                    pendingRef.current = pending;
                    setStepUpOpen(true);
                    return;
                }
                if (handleRedirect(info)) return;
                setSessionsError(info.message || 'Не удалось завершить сессии');
            } finally {
                setSessionsBusy(false);
            }
        }
    }, [handleRedirect, loadOverview, nav, overview, refresh, refreshPortal]);

    const onStepUpSuccess = useCallback(async () => {
        setStepUpOpen(false);
        const pending = pendingRef.current;
        pendingRef.current = null;
        await loadOverview({ silent: true });
        if (!pending) return;
        await runAction(pending);
    }, [loadOverview, runAction]);

    const onStepUpClose = useCallback(() => {
        setStepUpOpen(false);
        pendingRef.current = null;
    }, []);

    const onStartSetup = useCallback(() => runAction({ kind: 'startSetup' }), [runAction]);
    const onConfirmEnable = useCallback((token) => runAction({ kind: 'confirmEnable', token }), [runAction]);
    const onFinishSetup = useCallback(() => runAction({ kind: 'finishSetup' }), [runAction]);
    const onDisable = useCallback((args) => runAction({ kind: 'disable', ...args }), [runAction]);
    const onRegenerate = useCallback(() => runAction({ kind: 'regenerate' }), [runAction]);
    const onPasswordSubmit = useCallback(({ currentPassword, newPassword, onDone }) => {
        passwordResetRef.current = onDone;
        runAction({ kind: 'changePassword', currentPassword, newPassword, onDone });
    }, [runAction]);
    const onTelegramUnlink = useCallback(() => runAction({ kind: 'telegramUnlink' }), [runAction]);
    const onRevokeOthers = useCallback(() => runAction({ kind: 'revokeOthers' }), [runAction]);

    const artistName = safeText(portal?.artistName).trim();

    if (overviewError && !overview) {
        return (
            <Shell>
                <ArtistTopBar portal={portal} onLogout={logout} />
                <Main>
                    <Wrap>
                        <ErrorStrip role="alert">{overviewError}</ErrorStrip>
                    </Wrap>
                </Main>
            </Shell>
        );
    }

    if (overviewLoading && !overview) {
        return (
            <Shell>
                <ArtistTopBar portal={portal} onLogout={logout} />
                <Main>
                    <Wrap>
                        <LoadingCard>Загружаем данные безопасности…</LoadingCard>
                    </Wrap>
                </Main>
            </Shell>
        );
    }

    const data = overview || {};
    const account = data.account || {};
    const mfa = data.mfa || {};
    const stepUp = data.stepUp || {};
    const level = data.level || null;
    const issues = data.issues || [];
    const stats = data.stats || [];
    const capabilities = data.capabilities || {};
    const sessions = data.sessions || [];
    const enabledAtLabel = mfa.enabledAt
        ? new Date(mfa.enabledAt).toLocaleString('ru-RU')
        : '';

    return (
        <Shell>
            <ArtistTopBar portal={portal} onLogout={logout} />

            <Main>
                <Wrap>
                    <SecurityHero
                        level={level}
                        issues={issues}
                        account={account}
                        mfa={mfa}
                        stepUp={stepUp}
                        artistName={artistName}
                    />

                    <SecurityStats stats={stats} />

                    <SecurityMfaCard
                        mfa={mfa}
                        capability={capabilities.mfa}
                        enabledAtLabel={enabledAtLabel}
                        setupData={setupData}
                        recoveryCodes={recoveryCodes}
                        submitting={mfaBusy}
                        error={mfaError}
                        onStartSetup={onStartSetup}
                        onConfirmEnable={onConfirmEnable}
                        onFinishSetup={onFinishSetup}
                        onDisable={onDisable}
                        onRegenerate={onRegenerate}
                    />

                    <SecurityPasswordCard
                        capability={capabilities.password}
                        strength={passwordStrength}
                        onPasswordInput={requestStrength}
                        onSubmit={onPasswordSubmit}
                        submitting={passwordBusy}
                        error={passwordError}
                    />

                    {account.hasTelegram ? (
                        <SecurityTelegramCard
                            account={account}
                            capability={capabilities.telegram}
                            onUnlink={onTelegramUnlink}
                            submitting={telegramBusy}
                            error={telegramError}
                        />
                    ) : null}

                    <SecuritySessionsCard
                        sessions={sessions}
                        capability={capabilities.sessions}
                        loading={overviewLoading}
                        submitting={sessionsBusy}
                        error={sessionsError}
                        onRefresh={() => loadOverview({ silent: true })}
                        onRevokeOthers={onRevokeOthers}
                    />
                </Wrap>
            </Main>

            <StepUpModal
                open={stepUpOpen}
                onClose={onStepUpClose}
                onSuccess={onStepUpSuccess}
            />

            {notice ? (
                <NoticeToast $kind={notice.kind} role="status" aria-live="polite">
                    {notice.text}
                </NoticeToast>
            ) : null}
        </Shell>
    );
}

const Main = styled.div`
  padding: 22px 18px 80px;

  @media (max-width: 720px) {
    padding: 16px 14px 80px;
  }
`;

const Wrap = styled.div`
  width: min(1080px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const LoadingCard = styled.div`
  padding: 36px 24px;
  border-radius: 22px;
  border: 0;
  background: rgba(255, 255, 255, 0.03);
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13.5px;
`;

const ErrorStrip = styled.div`
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
`;

const NoticeToast = styled.div`
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: calc(100vw - 32px);
  padding: 12px 18px;
  border-radius: 14px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
  z-index: 200;
  pointer-events: none;
  box-shadow: none;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.92);

  @media (max-width: 720px) {
    left: 16px;
    right: 16px;
    transform: none;
    text-align: center;
  }
`;
