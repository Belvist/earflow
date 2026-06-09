import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { FaHome, FaSearch, FaUser, FaUsers } from 'react-icons/fa';
import useAuth from '../hooks/useAuth';
import { clearRecentLogout, redirectToAuth, sanitizeReturnTo } from '../utils/authRedirect';

const NAV_BAR_PX = 'var(--mobile-bottom-nav-height, 48px)';

const Nav = styled.nav`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: calc(${NAV_BAR_PX} + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  background: #000000;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: none;
  box-shadow: none;
  z-index: var(--z-bottom-nav, 9997);
  transform: translate3d(0, 0, 0);
  transition: opacity 0.16s ease, transform 0.16s ease;
  will-change: transform, opacity;

  html.keyboard-open & {
    display: none;
    opacity: 0;
    pointer-events: none;
    transform: translate3d(0, calc(100% + 12px), 0);
  }

  @media (min-width: 768px) {
    display: none;
  }
`;

const Inner = styled.div`
  height: ${NAV_BAR_PX};
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: center;
  max-width: 520px;
  margin: 0 auto;
  padding: 0 calc(10px + env(safe-area-inset-left, 0px)) 0 calc(10px + env(safe-area-inset-right, 0px));
`;

const Item = styled.button`
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: ${NAV_BAR_PX};
  border: none;
  background: transparent;
  color: ${p => (p.$active ? 'rgba(255,255,255,0.96)' : 'rgba(255,255,255,0.58)')};
  font-family: 'Unbounded', sans-serif;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;

  &:active {
    opacity: 0.92;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 12px;
  }
`;

const Label = styled.span`
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.01em;
  line-height: 1;
`;

export default function MobileBottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  const path = useMemo(() => String(location?.pathname || ''), [location?.pathname]);

  const active = useMemo(() => {
    if (path === '/') return 'home';
    if (path.startsWith('/social')) return 'social';
    if (path.startsWith('/search')) return 'search';
    if (path.startsWith('/artists')) return 'artists';
    if (path.startsWith('/artist/')) return 'artists';
    if (path.startsWith('/profile') || path.startsWith('/account/')) return 'profile';
    return '';
  }, [path]);

  return (
    <Nav aria-label="Навигация">
      <Inner>
        <Item
          type="button"
          $active={active === 'home'}
          aria-current={active === 'home' ? 'page' : undefined}
          aria-label="Главная"
          onClick={() => navigate('/')}
        >
          <FaHome size={14} />
          <Label>Главная</Label>
        </Item>

        <Item
          type="button"
          $active={active === 'social'}
          aria-current={active === 'social' ? 'page' : undefined}
          aria-label="Соцсеть"
          onClick={() => navigate('/social')}
        >
          <FaUsers size={14} />
          <Label>Соцсеть</Label>
        </Item>

        <Item
          type="button"
          $active={active === 'search'}
          aria-current={active === 'search' ? 'page' : undefined}
          aria-label="Поиск"
          onClick={() => navigate('/search')}
        >
          <FaSearch size={14} />
          <Label>Поиск</Label>
        </Item>

        <Item
          type="button"
          $active={active === 'profile'}
          aria-current={active === 'profile' ? 'page' : undefined}
          aria-label="Профиль"
          onClick={() => {
            if (isAuthenticated) {
              navigate('/profile');
              return;
            }
            clearRecentLogout();
            const href = typeof window === 'undefined' ? 'https://earflow.ru/' : window.location.href;
            redirectToAuth({ reason: 'login', returnTo: sanitizeReturnTo(href), replace: true });
          }}
        >
          <FaUser size={14} />
          <Label>Аккаунт</Label>
        </Item>
      </Inner>
    </Nav>
  );
}
