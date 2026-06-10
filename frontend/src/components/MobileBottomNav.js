import React, { useCallback, useMemo } from 'react';
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
import {
  MOBILE_CHROME_SIDE_INSET_PX,
  MOBILE_NAV_BOTTOM_GAP_PX,
  MOBILE_NAV_PILL_HEIGHT_PX,
} from './mobileChromeTokens';

const NAV_PILL_H_PX = MOBILE_NAV_PILL_HEIGHT_PX;
const NAV_SOLID_BG = '#0D0D0D';

const Nav = styled.nav`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: calc(${NAV_PILL_H_PX}px + ${MOBILE_NAV_BOTTOM_GAP_PX}px + env(safe-area-inset-bottom, 0px));
  padding:
    0
    max(${MOBILE_CHROME_SIDE_INSET_PX}px, env(safe-area-inset-right, 0px))
    calc(${MOBILE_NAV_BOTTOM_GAP_PX}px + env(safe-area-inset-bottom, 0px))
    max(${MOBILE_CHROME_SIDE_INSET_PX}px, env(safe-area-inset-left, 0px));
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: stretch;
  background: transparent;
  border: none;
  pointer-events: none;
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

const NavPill = styled.div`
  pointer-events: auto;
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: ${NAV_PILL_H_PX}px;
  position: relative;
  border-radius: 999px;
  background: ${NAV_SOLID_BG};
  border: none;
  box-shadow: none;
`;

const TabGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  height: 100%;
  width: 100%;
`;

const TabButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  color: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.45)')};
  transition: color 0.14s ease;

  svg {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }

  @media (max-width: 360px) {
    svg {
      width: 20px;
      height: 20px;
    }
  }

  &:active {
    opacity: 0.9;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 12px;
  }
`;

function NavTab({
  active, label, onClick, children,
}) {
  return (
    <TabButton
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      $active={active}
      onClick={onClick}
    >
      {children}
    </TabButton>
  );
}

const NAV_TABS = [
  { id: 'home', label: 'Главная', icon: HiOutlineHome },
  { id: 'social', label: 'Соцсеть', icon: HiOutlineUserGroup },
  { id: 'search', label: 'Поиск', icon: HiOutlineMagnifyingGlass },
  { id: 'profile', label: 'Аккаунт', icon: HiOutlineUser },
];

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

  const goProfile = useCallback(() => {
    if (isAuthenticated) {
      navigate('/profile');
      return;
    }
    clearRecentLogout();
    const href = typeof window === 'undefined' ? 'https://earflow.ru/' : window.location.href;
    redirectToAuth({ reason: 'login', returnTo: sanitizeReturnTo(href), replace: true });
  }, [isAuthenticated, navigate]);

  const selectTab = useCallback((tab) => {
    if (tab === 'home') navigate('/');
    else if (tab === 'social') navigate('/social');
    else if (tab === 'search') navigate('/search');
    else if (tab === 'profile') goProfile();
  }, [goProfile, navigate]);

  return (
    <Nav aria-label="Навигация" data-testid="mobile-bottom-nav">
      <NavPill
        data-testid="mobile-bottom-nav-pill"
        data-mobile-nav-ui="2026-06-v68-solid-nav"
      >
        <TabGrid>
          {NAV_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavTab
                key={tab.id}
                active={active === tab.id}
                label={tab.label}
                onClick={() => selectTab(tab.id)}
              >
                <Icon />
              </NavTab>
            );
          })}
        </TabGrid>
      </NavPill>
    </Nav>
  );
}
