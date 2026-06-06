import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { FaSearch } from 'react-icons/fa';
import BrandLink from './BrandLink';
import useAuth from '../hooks/useAuth';
import { clearRecentLogout, redirectToAuth, sanitizeReturnTo } from '../utils/authRedirect';

const HeaderWrapper = styled.header`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  display: flex;
  align-items: center;
  padding: calc(8px + env(safe-area-inset-top, 0px)) 16px 8px;
  background: rgba(0,0,0,0.82);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255,255,255,0.08);
  z-index: 80;

  @media (min-width: 768px) {
    padding: calc(10px + env(safe-area-inset-top, 0px)) 20px 10px;
  }
`;

const HeaderInner = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;

  @media (max-width: 767px) {
    justify-content: center;
  }
`;

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;

  @media (max-width: 767px) {
    display: none;
  }
`;

const ProfileButton = styled.button`
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: white;
  padding: 0;
  border-radius: 50%;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.35);
  }
  
  &:active {
    transform: scale(0.95);
  }

  @media (min-width: 768px) {
    width: 34px;
    height: 34px;
  }
`;

const ProfileAvatar = styled.img`
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
`;

const ProfileInitial = styled.span`
  font-size: 14px;
  font-weight: 600;
`;

const LoginButton = styled.button`
  height: 34px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-family: 'Unbounded', sans-serif;
  font-weight: 700;
  cursor: pointer;
`;

const SearchButton = styled.button`
  height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255,255,255,0.92);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 800;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.26);
  }

  &:active {
    transform: scale(0.98);
  }
`;

const SearchLabel = styled.span`
  font-size: 12px;
  letter-spacing: 0.01em;
`;

const Header = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [avatarFailed, setAvatarFailed] = useState(false);

  const initial = useMemo(() => {
    return (user?.firstName?.[0] || user?.username?.[0] || '?').toString().toUpperCase();
  }, [user?.firstName, user?.username]);

  const avatarUrl = useMemo(() => {
    if (avatarFailed) return null;
    if (!user || !user.photoUrl) return null;
    const url = String(user.photoUrl);
    if (/^https?:\/\/t\.me\/i\/userpic\//i.test(url)) return null;
    return url;
  }, [avatarFailed, user]);

  return (
    <HeaderWrapper>
      <HeaderInner>
        <BrandLink size="sm" />
        <HeaderActions>
          <SearchButton type="button" onClick={() => navigate('/search')} aria-label="Поиск">
            <FaSearch size={14} />
            <SearchLabel>Поиск</SearchLabel>
          </SearchButton>
          {isAuthenticated ? (
            <ProfileButton onClick={() => navigate('/profile')} aria-label="Профиль">
              {avatarUrl ? (
                <ProfileAvatar
                  src={avatarUrl}
                  alt={user?.username || user?.firstName || 'Profile'}
                  onError={() => setAvatarFailed(true)}
                />
              ) : (
                <ProfileInitial>{initial}</ProfileInitial>
              )}
            </ProfileButton>
          ) : (
            <LoginButton
              type="button"
              onClick={() => {
                clearRecentLogout();
                const href = typeof window === 'undefined' ? 'https://earflow.ru/' : window.location.href;
                redirectToAuth({ reason: 'login', returnTo: sanitizeReturnTo(href), replace: true });
              }}
            >
              Войти
            </LoginButton>
          )}
        </HeaderActions>
      </HeaderInner>
    </HeaderWrapper>
  );
};

export default Header;
