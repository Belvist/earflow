import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import useAuth from '../hooks/useAuth';

const Root = styled.div`
  width: 100%;
`;

const WidgetContainer = styled.div`
  width: 100%;
  display: flex;
  justify-content: center;

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

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const botUsername = useMemo(() => getTelegramBotUsername(), []);

    useEffect(() => {
        if (!botUsername) return;
        if (!containerRef.current) return;

        let cancelled = false;

        const callbackName = '__earflowTelegramAuth';

        const renderWidget = async () => {
            const onTelegramAuth = async (payload) => {
                if (inFlightRef.current) return;
                inFlightRef.current = true;
                setError('');
                setLoading(true);

                try {
                    const response = await loginWithTelegram(payload);
                    if (onSuccess) {
                        onSuccess(response);
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
        };

        renderWidget().catch((e) => {
            const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : 'Telegram login unavailable';
            setError(msg);
        });

        return () => {
            cancelled = true;

            try {
                if (typeof window !== 'undefined' && window[callbackName]) {
                    delete window[callbackName];
                }
            } catch {
            }
        };
    }, [botUsername, loginWithTelegram, onSuccess]);

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
