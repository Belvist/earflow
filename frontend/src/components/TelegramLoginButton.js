import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import useAuth from '../hooks/useAuth';
import { isAuthDomain, sanitizeReturnTo } from '../utils/authRedirect';

const Root = styled.div`
  width: 100%;
`;

const WidgetContainer = styled.div`
  width: 100%;
  min-height: 44px;
  display: flex;
  justify-content: center;
  overflow: visible;

  iframe {
    border: 0;
  }
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

export const getTelegramBotUsername = () => {
    const runtimeVal = (() => {
        try {
            if (typeof window === 'undefined') return '';
            const cfg = window.__EARFLOW_RUNTIME_CONFIG__;
            if (!cfg || typeof cfg !== 'object') return '';
            const v = cfg.telegramBotUsername;
            return typeof v === 'string' ? v : '';
        } catch {
            return '';
        }
    })();

    const envVal = (() => {
        try {
            return typeof process !== 'undefined' ? process.env.REACT_APP_TELEGRAM_BOT_USERNAME : '';
        } catch {
            return '';
        }
    })();

    return normalizeBotUsername(runtimeVal || envVal);
};

const getAuthOrigin = () => {
    try {
        if (typeof window === 'undefined') return 'https://auth.earflow.ru';
        const cfg = window.__EARFLOW_RUNTIME_CONFIG__;
        if (cfg && typeof cfg === 'object' && typeof cfg.telegramAuthOrigin === 'string' && cfg.telegramAuthOrigin) {
            return cfg.telegramAuthOrigin;
        }
    } catch {
    }
    try {
        const v = typeof process !== 'undefined' ? process.env.REACT_APP_TELEGRAM_AUTH_ORIGIN : '';
        if (typeof v === 'string' && v) return v;
    } catch {
    }
    return 'https://auth.earflow.ru';
};

const createTelegramWidgetScript = ({ botUsername, onAuthCallbackName }) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', botUsername);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-userpic', 'false');
    s.setAttribute('data-radius', '14');
    s.setAttribute('data-lang', 'ru');
    s.setAttribute('data-request-access', 'write');
    s.setAttribute('data-onauth', `${onAuthCallbackName}(user)`);
    return s;
};

const TelegramLoginButton = ({ onSuccess }) => {
    const { loginWithTelegram } = useAuth();
    const containerRef = useRef(null);
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
    const onAuthDomain = useMemo(() => isAuthDomain(), []);

    // The official widget only runs on origins registered for the bot
    // (@BotFather -> auth.earflow.ru). On any other origin (earflow.ru,
    // localhost) Telegram refuses with "Bot domain invalid". Instead of a
    // fragile cross-domain oauth popup, send the user to the auth domain,
    // where the proven widget lives; return_to brings them back after login.
    const handleRedirectToAuth = useCallback(() => {
        if (typeof window === 'undefined') return;
        try {
            const url = new URL('/login', getAuthOrigin());
            url.searchParams.set('return_to', sanitizeReturnTo(window.location.href));
            window.location.assign(url.toString());
        } catch {
            // ignore
        }
    }, []);

    useEffect(() => {
        if (!onAuthDomain) return;
        if (!botUsername) return;
        if (!containerRef.current) return;

        let cancelled = false;
        const timers = [];
        let resizeObserver = null;

        const callbackName = '__earflowTelegramAuth';

        const fitToContainer = () => {
            if (cancelled) return;
            const container = containerRef.current;
            if (!container) return;
            const iframe = container.querySelector('iframe');
            if (!iframe) return;
            const cw = container.clientWidth;
            const iw = iframe.offsetWidth || 238;
            const ih = iframe.offsetHeight || 40;
            if (!cw || !iw) return;
            const scale = Math.min(1, cw / iw);
            iframe.style.width = `${iw}px`;
            iframe.style.height = `${ih}px`;
            iframe.style.transformOrigin = 'center';
            iframe.style.transform = `scale(${scale})`;
            container.style.height = `${Math.round(ih * scale)}px`;
        };

        const renderWidget = async () => {
            const onTelegramAuth = async (payload) => {
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
            };

            if (typeof window === 'undefined') {
                throw new Error('TELEGRAM_WIDGET_UNAVAILABLE');
            }

            window[callbackName] = onTelegramAuth;

            const container = containerRef.current;
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }

            const script = createTelegramWidgetScript({ botUsername, onAuthCallbackName: callbackName });
            container.appendChild(script);

            const containerEl = containerRef.current;
            if (typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(() => fitToContainer());
                resizeObserver.observe(containerEl);
            }

            const onWindowResize = () => fitToContainer();
            window.addEventListener('resize', onWindowResize);
            timers.push({ cancel: () => window.removeEventListener('resize', onWindowResize) });

            [0, 150, 350, 700, 1200, 1800].forEach((ms) => {
                const tid = window.setTimeout(fitToContainer, ms);
                timers.push({ cancel: () => window.clearTimeout(tid) });
            });
        };

        renderWidget().catch((e) => {
            const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Telegram login unavailable';
            setError(msg);
        });

        return () => {
            cancelled = true;
            if (resizeObserver) {
                resizeObserver.disconnect();
            }
            timers.forEach((t) => {
                if (t && typeof t.cancel === 'function') t.cancel();
            });

            try {
                if (typeof window !== 'undefined' && window[callbackName]) {
                    delete window[callbackName];
                }
            } catch {
            }
        };
    }, [botUsername, onAuthDomain, loginWithTelegram]);

    if (!botUsername) {
        return null;
    }

    if (!onAuthDomain) {
        return (
            <Root>
                <Button type="button" onClick={handleRedirectToAuth}>
                    <TelegramIcon />
                    Войти через Telegram
                </Button>
            </Root>
        );
    }

    return (
        <Root>
            <WidgetContainer ref={containerRef} />
            {error ? (
                <div style={{ marginTop: 10, color: 'rgba(255, 107, 122, 0.95)', fontSize: 13, fontWeight: 500 }}>
                    {error}
                </div>
            ) : null}
            {loading ? (
                <div style={{ marginTop: 10, color: 'rgba(255, 255, 255, 0.7)', fontSize: 13, fontWeight: 500 }}>
                    Подключение...
                </div>
            ) : null}
        </Root>
    );
};

export default TelegramLoginButton;
