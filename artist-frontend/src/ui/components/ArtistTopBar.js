import React, { useMemo } from 'react';
import styled from 'styled-components';
import { useLocation, useNavigate } from 'react-router-dom';
import { FaSignOutAlt } from 'react-icons/fa';

import { buildPublicArtistUrl, isSafePublicArtistUrl } from '../../usecases/publicLinks';

const safeText = (v) => {
  if (v === null || v === undefined) return '';
  return String(v);
};

function isPathActive(activePath, targetPath) {
  if (targetPath === '/') return activePath === '/';
  return activePath === targetPath || activePath.startsWith(`${targetPath}/`);
}

export default function ArtistTopBar({ portal, onLogout }) {
  const nav = useNavigate();
  const loc = useLocation();

  const artistName = safeText(portal?.artistName || portal?.artist_name).trim();
  const artistPublicId = safeText(portal?.artistPublicId || portal?.artist_public_id || portal?.publicId || portal?.public_id).trim();

  const publicArtistUrl = useMemo(() => {
    const url = buildPublicArtistUrl({ artistPublicId, artistName });
    return isSafePublicArtistUrl(url) ? url : '';
  }, [artistName, artistPublicId]);

  const activePath = safeText(loc?.pathname);

  const openPublicPage = () => {
    if (!publicArtistUrl) return;
    window.open(publicArtistUrl, '_blank', 'noopener,noreferrer');
  };

  const logout = () => {
    if (typeof onLogout === 'function') onLogout();
  };

  return (
    <Header>
      <HeaderInner>
        <LeftBlock>
          <LogoButton type="button" onClick={() => nav('/')}>
            EARFLOW ARTISTS
          </LogoButton>

          <NavLine aria-label="Навигация артиста">
            <NavItem
              type="button"
              $active={isPathActive(activePath, '/')}
              onClick={() => nav('/')}
              aria-current={isPathActive(activePath, '/') ? 'page' : undefined}
            >
              {isPathActive(activePath, '/') ? <SmallSquare /> : null}
              КАБИНЕТ
            </NavItem>

            <NavItem
              type="button"
              $active={isPathActive(activePath, '/manage')}
              onClick={() => nav('/manage')}
              aria-current={isPathActive(activePath, '/manage') ? 'page' : undefined}
            >
              {isPathActive(activePath, '/manage') ? <SmallSquare /> : null}
              УПРАВЛЕНИЕ
            </NavItem>

            <NavItem
              type="button"
              $active={isPathActive(activePath, '/tracks')}
              onClick={() => nav('/tracks')}
              aria-current={isPathActive(activePath, '/tracks') ? 'page' : undefined}
            >
              {isPathActive(activePath, '/tracks') ? <SmallSquare /> : null}
              ТРЕКИ
            </NavItem>

            <NavItem
              type="button"
              $active={isPathActive(activePath, '/analytics')}
              onClick={() => nav('/analytics')}
              aria-current={isPathActive(activePath, '/analytics') ? 'page' : undefined}
            >
              {isPathActive(activePath, '/analytics') ? <SmallSquare /> : null}
              АНАЛИТИКА
            </NavItem>
          </NavLine>
        </LeftBlock>

        <RightBlock>
          <TopAction
            type="button"
            onClick={openPublicPage}
            disabled={!publicArtistUrl}
            aria-disabled={!publicArtistUrl}
          >
            ТВОЯ СТРАНИЦА
          </TopAction>

          <TopAction type="button" onClick={logout}>
            ВЫЙТИ
            <ExitIcon />
          </TopAction>
        </RightBlock>
      </HeaderInner>
    </Header>
  );
}

const Header = styled.header`
  width: 100%;
  min-height: 66px;
  background: #000;
  color: #fff;
  padding: 13px 18px 10px;
  box-sizing: border-box;
  border: 0;
  position: sticky;
  top: 0;
  z-index: 50;

  @media (max-width: 720px) {
    min-height: 92px;
    padding: 12px 14px 11px;
  }
`;

const HeaderInner = styled.div`
  width: min(1080px, 100%);
  margin: 0 auto;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;

  @media (max-width: 720px) {
    flex-direction: column;
    gap: 12px;
  }
`;

const LeftBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
`;

const LogoButton = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  color: #fff;
  font-family: 'Unbounded', Arial Black, Impact, system-ui, sans-serif;
  font-size: clamp(18px, 1.7vw, 22px);
  line-height: 22px;
  font-weight: 900;
  letter-spacing: -0.8px;
  text-transform: uppercase;
  cursor: pointer;
  white-space: nowrap;

  &:focus-visible {
    outline: 1px solid #fff;
    outline-offset: 3px;
  }
`;

const NavLine = styled.nav`
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 13px;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (max-width: 720px) {
    gap: 12px;
    margin-top: 11px;
    width: calc(100vw - 28px);
  }
`;

const NavItem = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  color: ${(p) => (p.$active ? '#fff' : 'rgba(255,255,255,0.82)')};
  font-family: 'Unbounded', Arial, Helvetica, sans-serif;
  font-size: 9.5px;
  line-height: 12px;
  font-weight: 900;
  letter-spacing: 0.15px;
  text-transform: uppercase;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
  opacity: ${(p) => (p.$active ? 1 : 0.88)};

  &:hover {
    color: #fff;
    opacity: 1;
  }

  &:focus-visible {
    outline: 1px solid #fff;
    outline-offset: 3px;
  }
`;

const SmallSquare = styled.span`
  width: 10px;
  height: 10px;
  border-radius: 1px;
  background: #fff;
  display: inline-block;
  flex-shrink: 0;
`;

const RightBlock = styled.div`
  display: flex;
  align-items: center;
  gap: 34px;
  padding-top: 6px;
  flex-shrink: 0;

  @media (max-width: 720px) {
    align-self: stretch;
    justify-content: space-between;
    gap: 18px;
    padding-top: 0;
  }
`;

const TopAction = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  color: #fff;
  font-family: 'Unbounded', Arial, Helvetica, sans-serif;
  font-size: 9.5px;
  line-height: 12px;
  font-weight: 900;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;

  &:hover:not(:disabled) {
    color: rgba(255,255,255,0.78);
  }

  &:disabled {
    color: rgba(255,255,255,0.32);
    cursor: default;
  }

  &:focus-visible {
    outline: 1px solid #fff;
    outline-offset: 3px;
  }
`;

const ExitIcon = styled(FaSignOutAlt)`
  width: 10px;
  height: 10px;
  color: currentColor;
`;