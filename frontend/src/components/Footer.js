import React from 'react';
import styled from 'styled-components';

const FooterWrapper = styled.footer`
  width: 100%;
  padding: 18px 16px calc(18px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(12px);
  position: relative;
  z-index: 1;
`;

const FooterInner = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: nowrap;
  gap: 8px;
  white-space: nowrap;
  font-family: 'Unbounded', sans-serif;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.78);

  @media (max-width: 520px) {
    flex-wrap: wrap;
    white-space: normal;
    row-gap: 8px;
    column-gap: 10px;
    font-size: 10px;
    letter-spacing: 0.06em;
  }
`;

const FooterLink = styled.a`
  color: rgba(255, 255, 255, 0.82);
  text-decoration: none;
  transition: color 0.15s ease;

  &:hover {
    color: rgba(255, 255, 255, 1);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.65);
    outline-offset: 2px;
    border-radius: 6px;
  }
`;

const Separator = styled.span`
  font-weight: 800;
  color: rgba(255, 255, 255, 0.95);
`;

function normalizeUrl(url) {
  const s = typeof url === 'string' ? url.trim() : '';
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  return s;
}

export default function Footer() {
  const privacyUrl = normalizeUrl(process.env.REACT_APP_PRIVACY_POLICY_URL) || '/privacy';
  const cookiesUrl = normalizeUrl(process.env.REACT_APP_COOKIES_POLICY_URL) || '/cookies';
  const securityUrl = normalizeUrl(process.env.REACT_APP_SECURITY_POLICY_URL) || '/security';
  const artistPortalUrl = normalizeUrl(process.env.REACT_APP_ARTIST_PORTAL_URL) || 'https://artists.earflow.ru/';
  const aboutUrl = normalizeUrl(process.env.REACT_APP_ABOUT_URL) || '/about';
  const musicUrl = '/music';

  return (
    <FooterWrapper>
      <FooterInner>
        <FooterLink href={artistPortalUrl} target="_blank" rel="noopener noreferrer">Для артистов</FooterLink>
        <Separator>YEP</Separator>
        <FooterLink href={musicUrl}>Музыка</FooterLink>
        <Separator>YEP</Separator>
        <FooterLink href={aboutUrl} rel="noopener noreferrer">О нас</FooterLink>
        <Separator>YEP</Separator>
        <FooterLink href={securityUrl} rel="noopener noreferrer">Политика безопасности</FooterLink>
        <Separator>YEP</Separator>
        <FooterLink href={privacyUrl} rel="noopener noreferrer">Политика конфиденциальности</FooterLink>
        <Separator>YEP</Separator>
        <FooterLink href={cookiesUrl} rel="noopener noreferrer">Политика cookies</FooterLink>
      </FooterInner>
    </FooterWrapper>
  );
}
