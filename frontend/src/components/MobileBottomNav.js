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

const NAV_SHELL_PX = 52;
/** Gray ring around active pill — uniform gap (3–5px) */
const ACTIVE_SHELL_INSET_PX = 4;
const ICON_CHIP_H_PX = 28;
const ICON_CHIP_MIN_W_PX = 36;

const Nav = styled.nav`
  position: fixed;
  bottom: 0;
  left: 0;
  width: 100%;
  height: calc(${NAV_SHELL_PX}px + env(safe-area-inset-bottom, 0px));
  padding:
    0
    max(12px, env(safe-area-inset-right, 0px))
    calc(8px + env(safe-area-inset-bottom, 0px))
    max(12px, env(safe-area-inset-left, 0px));
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  justify-content: center;
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

/** Compact oval: 50% bg tint + blur inside, no border */
const NavOval = styled.div`
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 5px 8px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px) saturate(1.15);
  -webkit-backdrop-filter: blur(20px) saturate(1.15);
  border: none;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.38);
`;

const TabButton = styled.button`
  display: inline-flex;
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

/** Gray ring — only on active tab, +4px around pill evenly */
const TabShell = styled.span`
  display: ${(p) => (p.$active ? 'inline-flex' : 'contents')};
  align-items: center;
  justify-content: center;
  padding: ${(p) => (p.$active ? `${ACTIVE_SHELL_INSET_PX}px` : '0')};
  border-radius: 999px;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.1)' : 'transparent')};
  transition: background 0.18s ease;
`;

/** Active highlight pill */
const IconChip = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: ${ICON_CHIP_MIN_W_PX}px;
  height: ${ICON_CHIP_H_PX}px;
  padding: 0 10px;
  border-radius: 999px;
  color: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.52)')};
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.18)' : 'transparent')};
  transition: background 0.18s ease, color 0.18s ease;

  svg {
    width: 22px;
    height: 22px;
    flex-shrink: 0;
  }
`;

function NavTab({ active, label, onClick, children }) {
  return (
    <TabButton
      type="button"
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      onClick={onClick}
    >
      <TabShell $active={active} aria-hidden="true">
        <IconChip $active={active}>
          {children}
        </IconChip>
      </TabShell>
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
      <NavOval data-testid="mobile-bottom-nav-oval">
        <NavTab active={active === 'home'} label="Главная" onClick={() => navigate('/')}>
          <HiOutlineHome />
        </NavTab>
        <NavTab active={active === 'social'} label="Соцсеть" onClick={() => navigate('/social')}>
          <HiOutlineUserGroup />
        </NavTab>
        <NavTab active={active === 'search'} label="Поиск" onClick={() => navigate('/search')}>
          <HiOutlineMagnifyingGlass />
        </NavTab>
        <NavTab active={active === 'profile'} label="Аккаунт" onClick={goProfile}>
          <HiOutlineUser />
        </NavTab>
      </NavOval>
    </Nav>
  );
}
