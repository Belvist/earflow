import React, { useCallback, useMemo, useRef } from 'react';
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
const NAV_INNER_PAD_PX = 4;

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
  overflow: hidden;

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

/** Liquid Glass pill — scale on drag; chip clipped inside */
const NavPill = styled(motion.div)`
  pointer-events: auto;
  flex: 1;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  height: ${NAV_PILL_H_PX}px;
  position: relative;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px) saturate(1.15);
  -webkit-backdrop-filter: blur(20px) saturate(1.15);
  border: none;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.32);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  transform-origin: center center;
  overflow: hidden;
`;

const NavPillTrack = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0 ${NAV_INNER_PAD_PX}px;
  box-sizing: border-box;
  overflow: hidden;
`;

const TabGrid = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  align-items: center;
  height: 100%;
  width: 100%;
`;

/** Sliding active glass chip — clipped inside pill */
const ActiveIndicator = styled(motion.div)`
  position: absolute;
  top: ${NAV_INNER_PAD_PX}px;
  bottom: ${NAV_INNER_PAD_PX}px;
  left: ${NAV_INNER_PAD_PX}px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.28);
  pointer-events: none;
  z-index: 0;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
  will-change: transform, width;
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
  touch-action: none;
  color: ${(p) => (p.$lit ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.5)')};
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
  active, lit, label, onClick, onSuppressTap, children,
}) {
  return (
    <TabButton
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      $lit={lit}
      onClick={(e) => {
        if (onSuppressTap?.()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick();
      }}
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
  const trackRef = useRef(null);
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
    captureHandlers: navSwipeHandlers,
    dragVisual,
    segmentWidthPx,
    litTabIndex,
    indicatorX,
    gestureSurfaceAttr,
    suppressTapIfSwipeCommitted,
  } = useMobileBottomNavSwipe({
    trackRef,
    activeTab: active,
    onSelectTab: selectTab,
    innerPadPx: NAV_INNER_PAD_PX,
  });

  const indicatorWidth = Math.max(0, segmentWidthPx);

  return (
    <Nav aria-label="Навигация" data-testid="mobile-bottom-nav">
      <NavPill
        data-testid="mobile-bottom-nav-pill"
        {...gestureSurfaceAttr}
        animate={{ scale: dragVisual.scale }}
        transition={
          dragVisual.active
            ? { duration: 0 }
            : { type: 'spring', stiffness: 520, damping: 34, mass: 0.82 }
        }
        onPointerDownCapture={navSwipeHandlers.onPointerDownCapture}
        onPointerMoveCapture={navSwipeHandlers.onPointerMoveCapture}
        onPointerUpCapture={navSwipeHandlers.onPointerUpCapture}
        onPointerCancelCapture={navSwipeHandlers.onPointerCancelCapture}
      >
        <NavPillTrack ref={trackRef}>
          {indicatorWidth > 0 ? (
            <ActiveIndicator
              data-testid="mobile-bottom-nav-indicator"
              animate={{ x: indicatorX, width: indicatorWidth }}
              transition={
                dragVisual.active
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 480, damping: 32, mass: 0.78 }
              }
            />
          ) : null}
          <TabGrid>
            {NAV_TABS.map((tab, index) => {
              const Icon = tab.icon;
              return (
                <NavTab
                  key={tab.id}
                  active={active === tab.id}
                  lit={litTabIndex === index}
                  label={tab.label}
                  onSuppressTap={suppressTapIfSwipeCommitted}
                  onClick={() => selectTab(tab.id)}
                >
                  <Icon />
                </NavTab>
              );
            })}
          </TabGrid>
        </NavPillTrack>
      </NavPill>
    </Nav>
  );
}
