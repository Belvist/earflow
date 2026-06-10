import React, { useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
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
import useMobileBottomNavSwipe from './useMobileBottomNavSwipe';

const NAV_PILL_H_PX = MOBILE_NAV_PILL_HEIGHT_PX;

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

/** Edge-to-edge pill (minus chrome side inset) — sync with floating mini-bar margins */
const NavPill = styled(motion.div)`
  pointer-events: auto;
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: ${NAV_PILL_H_PX}px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  padding: 0 2px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px) saturate(1.15);
  -webkit-backdrop-filter: blur(20px) saturate(1.15);
  border: none;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
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
    opacity: 0.9;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 12px;
  }
`;

/** Active highlight — lighter fill, no border/outline */
const IconChip = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 30px;
  padding: 0 10px;
  border-radius: 999px;

  @media (max-width: 360px) {
    min-width: 32px;
    padding: 0 8px;

    svg {
      width: 20px;
      height: 20px;
    }
  }
  border: none;
  box-shadow: none;
  outline: none;
  color: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.5)')};
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.28)' : 'transparent')};
  transition: background 0.18s ease, color 0.18s ease;

  svg {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
`;

function NavTab({ active, label, onClick, onSuppressTap, children }) {
  return (
    <TabButton
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={(e) => {
        if (onSuppressTap?.()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick();
      }}
    >
      <IconChip $active={active} aria-hidden="true">
        {children}
      </IconChip>
    </TabButton>
  );
}

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

  const {
    handlers: navSwipeHandlers,
    pillShift,
    gestureSurfaceAttr,
    suppressTapIfSwipeCommitted,
  } = useMobileBottomNavSwipe({
    activeTab: active,
    onSelectTab: selectTab,
  });

  return (
    <Nav aria-label="Навигация" data-testid="mobile-bottom-nav">
      <NavPill
        data-testid="mobile-bottom-nav-pill"
        style={pillShift}
        {...gestureSurfaceAttr}
        onPointerDown={navSwipeHandlers.onPointerDown}
        onPointerMove={navSwipeHandlers.onPointerMove}
        onPointerUp={navSwipeHandlers.onPointerUp}
        onPointerCancel={navSwipeHandlers.onPointerCancel}
      >
        <NavTab
          active={active === 'home'}
          label="Главная"
          onSuppressTap={suppressTapIfSwipeCommitted}
          onClick={() => navigate('/')}
        >
          <HiOutlineHome />
        </NavTab>
        <NavTab
          active={active === 'social'}
          label="Соцсеть"
          onSuppressTap={suppressTapIfSwipeCommitted}
          onClick={() => navigate('/social')}
        >
          <HiOutlineUserGroup />
        </NavTab>
        <NavTab
          active={active === 'search'}
          label="Поиск"
          onSuppressTap={suppressTapIfSwipeCommitted}
          onClick={() => navigate('/search')}
        >
          <HiOutlineMagnifyingGlass />
        </NavTab>
        <NavTab
          active={active === 'profile'}
          label="Аккаунт"
          onSuppressTap={suppressTapIfSwipeCommitted}
          onClick={goProfile}
        >
          <HiOutlineUser />
        </NavTab>
      </NavPill>
    </Nav>
  );
}
