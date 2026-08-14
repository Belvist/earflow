import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import useAuth from '../hooks/useAuth';

const Root = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Button = styled.button`
  width: 100%;
  min-height: 50px;
  padding: 0 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: #2aabee;
  border: none;
  border-radius: 999px;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Unbounded', sans-serif;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease, transform 0.15s ease;

  &:hover:not(:disabled) {
    background: #45b8f1;
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const TelegramIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
            fill="currentColor"
            d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.05-.2s-.16-.05-.23-.03c-.1.03-1.74 1.1-4.9 3.24-.46.32-.88.47-1.25.46-.41-.01-1.2-.23-1.79-.42-.72-.24-.65-1.24.14-1.85 1.92-1.32 3.85-2.65 5.75-3.94 1.6-1.09 3.9-1.48 4.7.02.35.67.14 1.34-.06 1.81z"
        />
    </svg>
);

const normalizeBotUsername = (raw) => {
    const s = typeof raw === 'string' ? raw.trim() : '';
    if (!s) return '';
    const cleaned = s.startsWith('@') ? s.slice(1) : s;
    if (!/^[A-Za-z0-9_]{5,64}$/.test(cleaned)) return '';
    return cleaned;
};

const normalizeBotId = (raw) => {
    const s = String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) return '';
    return s;
};

const runtimeValue = (key) => {
    try {
        if (typeof window === 'undefined') return '';
        const cfg = window.__EARFLOW_RUNTIME_CONFIG__;
        if (!cfg || typeof cfg !== 'object') return '';
        const v = cfg[key];
        return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
    } catch {
        return '';
    }
};

const envValue = (key) => {
    try {
        return typeof process !== 'undefined' ? process.env[key] : '';
    } catch {
        return '';
    }
};

export const getTelegramBotUsername = () => {
    return normalizeBotUsername(runtimeValue('telegramBotUsername') || envValue('REACT_APP_TELEGRAM_BOT_USERNAME'));
};

export const getTelegramBotId = () => {
    return normalizeBotId(runtimeValue('telegramBotId') || envValue('REACT_APP_TELEGRAM_BOT_ID'));
};

export const getTelegramAuthOrigin = () => {
    return runtimeValue('telegramAuthOrigin') || envValue('REACT_APP_TELEGRAM_AUTH_ORIGIN') || 'https://auth.earflow.ru';
};

const buildAuthUrl = ({ botId, authOrigin, returnTo }) => {
    const params = new URLSearchParams({
        bot_id: botId,
        origin: authOrigin,
        return_to: returnTo,
        request_access: 'write',
        lang: 'ru',
        embed: '0',
    });
    return `https://oauth.telegram.org/auth?${params.toString()}`;
};

const POLL_MS = 300;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

const TelegramLoginButton = ({ onSuccess }) => {
    const { loginWithTelegram } = useAuth();
    const inFlightRef = useRef(false);

    const onSuccessRef = useRef(onSuccess);
    const loginWithTelegramRef = useRef(loginWithTelegram);

    useEffect(() => {
        onSuccessRef.current = onSuccess;
        loginWithTelegramRef.current = loginWithTelegram;
    }, [onSuccess, loginWithTelegram]);

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const botUsername = useMemo(() => getTelegramBotUsername(), []);
    const botId = useMemo(() => getTelegramBotId(), []);
    const authOrigin = useMemo(() => getTelegramAuthOrigin(), []);

    const handleAuthPayload = useCallback(async (payload) => {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setError('');
        setLoading(true);
        try {
            const response = await loginWithTelegramRef.current(payload);
            if (onSuccessRef.current) {
                onSuccessRef.current(response);
            }
        } catch (e) {
            const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Login failed';
            setError(msg);
        } finally {
            setLoading(false);
            inFlightRef.current = false;
        }
    }, []);

    const handleClick = useCallback(() => {
        if (inFlightRef.current) return;
        if (typeof window === 'undefined') return;
        if (!botId) {
            setError('Telegram login unavailable');
            return;
        }

        const returnTo = window.location.href.split('#')[0];
        const url = buildAuthUrl({ botId, authOrigin, returnTo });

        const width = Math.min(640, Math.max(420, Math.round(window.innerWidth * 0.6)));
        const height = Math.min(560, Math.round(width * 0.72));
        const top = Math.max(0, Math.round((window.innerHeight - height) / 2));
        const left = Math.max(0, Math.round((window.innerWidth - width) / 2));

        let popup = null;
        try {
            popup = window.open(url, 'earflow_tg_auth', `width=${width},height=${height},top=${top},left=${left}`);
        } catch {
            popup = null;
        }

        if (!popup) {
            setError('Разрешите всплывающие окна для входа через Telegram');
            return;
        }

        setError('');
        setLoading(true);
        let settled = false;

        const finish = (payload) => {
            if (settled) return;
            settled = true;
            window.clearInterval(pollTimer);
            window.clearTimeout(timeoutTimer);
            try {
                popup.close();
            } catch {
            }
            if (payload) {
                handleAuthPayload(payload);
            } else {
                setLoading(false);
            }
        };

        const pollTimer = window.setInterval(() => {
            if (settled) return;
            let href = '';
            try {
                href = popup.location.href || '';
            } catch {
                // cross-origin (oauth.telegram.org) — ignore until it lands back on returnTo
            }
            if (!href || href.indexOf('tgAuthResult') === -1) {
                if (popup.closed) {
                    finish(null);
                }
                return;
            }
            let raw = '';
            try {
                const urlObj = new URL(href);
                raw = urlObj.searchParams.get('tgAuthResult') || urlObj.hashParams?.get?.('tgAuthResult') || '';
            } catch {
                raw = '';
            }
            if (!raw) {
                const hashMatch = href.match(/tgAuthResult=([^&]+)/);
                raw = hashMatch ? hashMatch[1] : '';
            }
            if (!raw) return;
            let payload = null;
            try {
                payload = JSON.parse(decodeURIComponent(raw));
            } catch {
                payload = null;
            }
            if (payload && typeof payload === 'object') {
                finish(payload);
            }
        }, POLL_MS);

        const timeoutTimer = window.setTimeout(() => {
            finish(null);
        }, POLL_TIMEOUT_MS);
    }, [authOrigin, botId, handleAuthPayload]);

    if (!botUsername || !botId) {
        return null;
    }

    return (
        <Root>
            <Button type="button" onClick={handleClick} disabled={loading}>
                <TelegramIcon />
                {loading ? 'Вход...' : 'Войти через Telegram'}
            </Button>
            {error ? (
                <div style={{ color: 'rgba(255, 107, 122, 0.95)', fontSize: 13, fontWeight: 500 }}>{error}</div>
            ) : null}
        </Root>
    );
};

export default TelegramLoginButton;
