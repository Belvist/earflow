import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HiOutlineHome,
  HiOutlineMagnifyingGlass,
  HiOutlineUser,
  HiOutlineUserGroup,
} from 'react-icons/hi2';
import useAuth from '../hooks/useAuth';
import { clearRecentLogout, redirectToAuth, sanitizeReturnTo } from '../utils/authRedirect';

const NAV_BAR_PX = 48;

const Nav = styled.nav`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: calc(${NAV_BAR_PX}px + env(safe-area-inset-bottom, 0px));
  padding-bottom: env(safe-area-inset-bottom, 0px);
  box-sizing: border-box;
  background: transparent;
  border-top: none;
  z-index: var(--z-bottom-nav, 9997);
  transform: translate3d(0, 0, 0);
  transition: opacity 0.16s ease, transform 0.16s ease;

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
  height: ${NAV_BAR_PX}px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  align-items: center;
  max-width: 520px;
  margin: 0 auto;
  padding: 0 max(10px, env(safe-area-inset-left, 0px)) 0 max(10px, env(safe-area-inset-right, 0px));
`;

const TabButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;

  &:active {
    opacity: 0.88;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 12px;
  }
`;

const IconChip = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  color: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.5)')};
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.1)' : 'transparent')};
  transition: background 0.18s ease, color 0.18s ease;

  svg {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
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

  const goProfile = () => {
    if (isAuthenticated) {
      navigate('/profile');
      return;
    }
    clearRecentLogout();
    const href = typeof window === 'undefined' ? 'https://earflow.ru/' : window.location.href;
    redirectToAuth({ reason: 'login', returnTo: sanitizeReturnTo(href), replace: true });
  };

  return (
    <Nav aria-label="Навигация" data-testid="mobile-bottom-nav">
      <Inner data-testid="mobile-bottom-nav-bar">
        <TabButton
          type="button"
          aria-current={active === 'home' ? 'page' : undefined}
          aria-label="Главная"
          onClick={() => navigate('/')}
        >
          <IconChip $active={active === 'home'} aria-hidden="true">
            <HiOutlineHome />
          </IconChip>
        </TabButton>

        <TabButton
          type="button"
          aria-current={active === 'social' ? 'page' : undefined}
          aria-label="Соцсеть"
          onClick={() => navigate('/social')}
        >
          <IconChip $active={active === 'social'} aria-hidden="true">
            <HiOutlineUserGroup />
          </IconChip>
        </TabButton>

        <TabButton
          type="button"
          aria-current={active === 'search' ? 'page' : undefined}
          aria-label="Поиск"
          onClick={() => navigate('/search')}
        >
          <IconChip $active={active === 'search'} aria-hidden="true">
            <HiOutlineMagnifyingGlass />
          </IconChip>
        </TabButton>

        <TabButton
          type="button"
          aria-current={active === 'profile' ? 'page' : undefined}
          aria-label="Аккаунт"
          onClick={goProfile}
        >
          <IconChip $active={active === 'profile'} aria-hidden="true">
            <HiOutlineUser />
          </IconChip>
        </TabButton>
      </Inner>
    </Nav>
  );
}
