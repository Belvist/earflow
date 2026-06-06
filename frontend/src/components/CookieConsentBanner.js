import React from 'react';
import styled from 'styled-components';

const STORAGE_KEY = 'earflow_cookie_consent_v1';

const Banner = styled.section`
  position: fixed;
  left: 0;
  right: 0;
  /* Mobile: всегда учитываем MobileBottomNav (56px + safe-area).
     Если играет трек — дополнительно MobilePlayerBar (var --player-bar-height-safe).
     z-index выше MobileBottomNav (9997) и MobilePlayerBar (9998), чтобы банер
     не прятался под ними и кнопки "Принять/Отклонить" оставались кликабельными. */
  bottom: ${p => (p.$reserveBottom
    ? 'calc(var(--player-bar-height-safe, 64px) + 56px + env(safe-area-inset-bottom, 0px))'
    : 'calc(56px + env(safe-area-inset-bottom, 0px))')};
  z-index: 9999;
  padding: 10px 12px 10px;
  background: rgba(0, 0, 0, 0.96);
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);

  @media (min-width: 768px) {
    bottom: ${p => (p.$reserveBottom ? 'var(--desktop-player-bar-height, 0px)' : '0')};
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
  }
`;

const Inner = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;

  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const Text = styled.div`
  color: rgba(255, 255, 255, 0.82);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  line-height: 1.45;

  @media (max-width: 640px) {
    font-size: 11px;
    line-height: 1.4;
  }
`;

const LinksRow = styled.div`
  margin-top: 6px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const Link = styled.a`
  color: rgba(255, 255, 255, 0.9);
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.25);

  &:hover {
    border-bottom-color: rgba(255, 255, 255, 0.8);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.65);
    outline-offset: 2px;
    border-radius: 6px;
  }
`;

const Buttons = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;

  @media (max-width: 640px) {
    justify-content: stretch;
    gap: 8px;
  }
`;

const Button = styled.button`
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-family: 'Unbounded', sans-serif;
  font-weight: 700;
  cursor: pointer;

  @media (max-width: 640px) {
    width: 100%;
    height: 36px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.14);
  }

  &:active {
    transform: scale(0.98);
  }
`;

const PrimaryButton = styled(Button)`
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.35);

  &:hover {
    background: rgba(255, 255, 255, 0.24);
  }
`;

function readConsent() {
  try {
    const w = typeof window === 'undefined' ? null : window;
    const storage = w?.localStorage || null;
    if (storage == null) return null;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.status !== 'accepted' && parsed.status !== 'declined') return null;
    if (typeof parsed.ts !== 'number' || !Number.isFinite(parsed.ts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeConsent(status) {
  try {
    const w = typeof window === 'undefined' ? null : window;
    const storage = w?.localStorage || null;
    if (storage == null) return;
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status, ts: Date.now() })
    );
  } catch {
  }
}

function normalizeUrl(url) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

export default function CookieConsentBanner({ reserveBottom = false }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const existing = readConsent();
    if (!existing) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const privacyUrl = normalizeUrl(process.env.REACT_APP_PRIVACY_POLICY_URL) || '/privacy';
  const cookiesUrl = normalizeUrl(process.env.REACT_APP_COOKIES_POLICY_URL) || '/cookies';

  return (
    <Banner $reserveBottom={reserveBottom} role="region" aria-label="Уведомление о cookies">
      <Inner>
        <Text>
          Мы используем cookies и схожие технологии для работы сервиса, повышения безопасности и улучшения пользовательского опыта.
          Продолжая пользоваться сайтом, вы соглашаетесь с использованием cookies в соответствии с законодательством РФ и международными стандартами.
          <LinksRow>
            <Link href={cookiesUrl} rel="noopener noreferrer">Политика cookies</Link>
            <Link href={privacyUrl} rel="noopener noreferrer">Политика конфиденциальности</Link>
          </LinksRow>
        </Text>
        <Buttons>
          <Button
            type="button"
            onClick={() => {
              writeConsent('declined');
              setVisible(false);
            }}
          >
            Отклонить
          </Button>
          <PrimaryButton
            type="button"
            onClick={() => {
              writeConsent('accepted');
              setVisible(false);
            }}
          >
            Принять
          </PrimaryButton>
        </Buttons>
      </Inner>
    </Banner>
  );
}
