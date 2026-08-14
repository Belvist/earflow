import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import useAuth from '../hooks/useAuth';

const Root = styled.div`
  width: 100%;
`;

const WidgetContainer = styled.div`
  width: 100%;
  min-height: 54px;
  display: flex;
  justify-content: center;
  overflow: visible;

  iframe {
    border: 0;
  }
`;

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

    useEffect(() => {
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
            const scale = cw / iw;
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
    }, [botUsername]);

    if (!botUsername) {
        return null;
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
