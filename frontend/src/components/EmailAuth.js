import React, { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaEnvelope, FaLock, FaUser, FaTimes, FaCheck, FaEye, FaEyeSlash } from 'react-icons/fa';

import useAuth from '../hooks/useAuth';
import BrandLink from './BrandLink';
import TelegramLoginButton, { getTelegramBotUsername } from './TelegramLoginButton';

// Контракт должен точно совпадать с backend auth-service/server.js handleEmailRegister:
// email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// username: 3-32 символа, буквы/цифры/._-
// password: length>=8, должна содержать букву и цифру.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[A-Za-zА-Яа-яЁё0-9._-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;

const normalizeUsernameInput = (value) => (
  typeof value === 'string' ? value.trim().replace(/^@+/, '').replace(/\s+/g, '') : ''
);

const evaluatePasswordStrength = (password) => {
    const pwd = typeof password === 'string' ? password : '';
    if (!pwd) {
        return { score: 0, label: '', percent: 0, tone: 'idle', meetsPolicy: false };
    }

    let score = 0;
    if (pwd.length >= PASSWORD_MIN_LENGTH) score += 1;
    if (pwd.length >= 12) score += 1;
    if (/[A-Za-zА-Яа-яЁё]/.test(pwd)) score += 1;
    if (/[0-9]/.test(pwd)) score += 1;
    if (/[^A-Za-z0-9А-Яа-яЁё]/.test(pwd)) score += 1;

    const normalized = Math.min(score, 4);
    const percent = Math.round((normalized / 4) * 100);

    const meetsPolicy =
        pwd.length >= PASSWORD_MIN_LENGTH &&
        /[A-Za-zА-Яа-яЁё]/.test(pwd) &&
        /[0-9]/.test(pwd);

    if (normalized <= 1) return { score: normalized, label: 'Слабый', percent, tone: 'weak', meetsPolicy };
    if (normalized === 2) return { score: normalized, label: 'Средний', percent, tone: 'medium', meetsPolicy };
    if (normalized === 3) return { score: normalized, label: 'Хороший', percent, tone: 'good', meetsPolicy };
    return { score: normalized, label: 'Сильный', percent, tone: 'strong', meetsPolicy };
};

const Divider = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0;
  color: rgba(255, 255, 255, 0.42);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.6px;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.12);
  }
`;

const AuthContainer = styled(motion.div)`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--auth-viewport-height, 100dvh);
  min-height: var(--auth-viewport-height, 100dvh);
  background:
    linear-gradient(180deg, rgba(12, 12, 12, 0.98) 0%, rgba(0, 0, 0, 0.98) 62%),
    #000;
  backdrop-filter: blur(18px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 32px 18px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scroll-padding: 24px 0 max(24px, env(safe-area-inset-bottom, 0px));

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  @media (max-width: 520px) {
    align-items: center;
    justify-content: center;
    padding:
      max(14px, env(safe-area-inset-top, 0px))
      12px
      max(14px, env(safe-area-inset-bottom, 0px));
  }
`;

const AuthCard = styled(motion.div)`
  background:
    linear-gradient(180deg, rgba(28, 28, 28, 0.98) 0%, rgba(12, 12, 12, 0.99) 100%);
  backdrop-filter: blur(34px);
  border-radius: 22px;
  padding: 0;
  max-width: 456px;
  width: min(456px, 100%);
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 
    0 32px 90px rgba(0, 0, 0, 0.82),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
  position: relative;
  max-height: calc(var(--auth-viewport-height, 100dvh) - 36px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, transparent 34%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.035) 0%, transparent 30%);
  }
  
  @media (max-width: 520px) {
    border-radius: 18px;
    max-height: calc(var(--auth-viewport-height, 100dvh) - 28px);
  }
`;

const CardInner = styled.div`
  position: relative;
  z-index: 1;
  padding: 28px 32px 26px;

  @media (max-width: 520px) {
    padding: 15px 14px 14px;
  }
`;

const AuthHeader = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  margin-bottom: 18px;
  text-align: left;

  @media (max-width: 520px) {
    align-items: center;
    gap: 7px;
    margin-bottom: 12px;
    text-align: center;
  }
`;

const HeaderTop = styled.div`
  width: 100%;
  min-height: 32px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;

  @media (max-width: 520px) {
    justify-content: center;
    min-height: 28px;
  }
`;

const AuthBrand = styled(BrandLink)`
  flex: 0 0 auto;

  @media (max-width: 520px) {
    transform: scale(0.92);
    transform-origin: center;
  }
`;

const SecureBadge = styled.div`
  flex: 0 0 auto;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.68);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;

  svg {
    font-size: 10px;
  }

  @media (max-width: 520px) {
    display: none;
  }
`;

const Title = styled.h2`
  margin: 0;
  padding: 0;
  color: rgba(255, 255, 255, 0.96);
  font-family: 'Unbounded', sans-serif;
  font-size: 24px;
  font-weight: 760;
  letter-spacing: 0;
  text-align: left;
  line-height: 1.15;

  @media (max-width: 520px) {
    font-size: 19px;
    text-align: center;
  }
`;


const CloseButton = styled(motion.button)`
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.8);
  width: 38px;
  height: 38px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.3s ease;
  z-index: 10;
  font-size: 15px;
  
  &:hover {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.2);
    color: white;
    transform: rotate(90deg);
  }
`;

const Subtitle = styled.p`
  color: rgba(255, 255, 255, 0.58);
  font-size: 13px;
  text-align: left;
  margin: -1px 0 0;
  font-weight: 580;
  line-height: 1.42;
  max-width: 390px;

  @media (max-width: 520px) {
    font-size: 11px;
    line-height: 1.35;
    text-align: center;
    max-width: 300px;
  }
`;

const TabsContainer = styled.div`
  display: flex;
  gap: 4px;
  margin: 0 0 20px;
  background: rgba(255, 255, 255, 0.045);
  border-radius: 999px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  position: relative;
  z-index: 1;

  @media (max-width: 520px) {
    margin-bottom: 12px;
    padding: 4px;
  }
`;

const Tab = styled(motion.button)`
  flex: 1;
  min-height: 44px;
  padding: 0 18px;
  background: ${props => props.$active ?
    'rgba(255, 255, 255, 0.94)' :
    'transparent'
  };
  color: ${props => props.$active ? 'black' : 'rgba(255, 255, 255, 0.7)'};
  border: none;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, transform 0.18s ease;
  text-transform: uppercase;
  font-family: 'Unbounded', sans-serif;
  letter-spacing: 0.4px;
  box-shadow: ${props => props.$active ?
    '0 8px 20px rgba(0, 0, 0, 0.28)' :
    'none'
  };
  
  &:hover {
    background: ${props => props.$active ?
    'rgba(255, 255, 255, 0.98)' :
    'rgba(255, 255, 255, 0.075)'
  };
    color: ${props => props.$active ? 'black' : 'white'};
  }

  @media (max-width: 520px) {
    min-height: 38px;
    padding: 0 12px;
    font-size: 11px;
  }
`;

const StepIndicator = styled.div`
  display: flex;
  gap: 8px;
  margin: -4px 0 4px;
`;

const StepPill = styled.div`
  flex: 1;
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid ${props => props.$active ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.09)'};
  background: ${props => props.$active ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.035)'};
  color: ${props => props.$active ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.42)'};
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.4px;

  @media (max-width: 520px) {
    min-height: 24px;
    font-size: 9px;
  }
`;

const FormSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;

  & + & {
    margin-top: 4px;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  @media (max-width: 520px) {
    gap: 8px;

    & + & {
      padding-top: 10px;
    }
  }
`;

const SectionLabel = styled.div`
  color: rgba(255, 255, 255, 0.48);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  @media (max-width: 520px) {
    font-size: 9px;
  }
`;

const ActionRow = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 10px;

  @media (max-width: 520px) {
    gap: 8px;
    margin-top: 8px;
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 13px;

  @media (max-width: 520px) {
    gap: 10px;
  }
`;

const InputIcon = styled.div`
  position: absolute;
  left: 17px;
  top: 50%;
  transform: translateY(-50%);
  color: rgba(255, 255, 255, 0.44);
  font-size: 15px;
  transition: color 0.18s ease;
  z-index: 2;

  @media (max-width: 520px) {
    left: 15px;
    font-size: 13px;
  }
`;

const InputGroup = styled.div`
  position: relative;
  z-index: 1;

  &:focus-within ${InputIcon} {
    color: rgba(255, 255, 255, 0.82);
  }
`;

const Input = styled.input`
  width: 100%;
  height: 56px;
  padding: 0 18px 0 50px;
  padding-right: ${props => (props.$hasTrailingAction ? '52px' : '20px')};
  background: rgba(255, 255, 255, 0.065);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  color: white;
  font-size: 14px;
  font-weight: 700;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  font-family: inherit;

  @media (max-width: 520px) {
    height: 46px;
    border-radius: 14px;
    font-size: 16px;
  }

  &::placeholder {
    color: rgba(255, 255, 255, 0.38);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.34);
    background: rgba(255, 255, 255, 0.095);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.055);
  }

  &[aria-invalid='true'] {
    border-color: rgba(255, 107, 122, 0.55);
    box-shadow: 0 0 0 3px rgba(255, 68, 88, 0.08);
  }
`;

const PasswordToggleBtn = styled.button`
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.62);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, transform 0.1s ease;
  z-index: 3;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.85);
  }

  &:active {
    transform: translateY(-50%) scale(0.92);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.4);
    outline-offset: 2px;
  }

  @media (max-width: 520px) {
    right: 10px;
    width: 32px;
    height: 32px;
  }
`;

const FieldMessage = styled.div`
  margin-top: 6px;
  margin-left: 6px;
  font-size: 12px;
  color: ${props => props.$tone === 'error' ? '#ff6b7a' : 'rgba(255, 255, 255, 0.55)'};
  line-height: 1.4;
`;

const PasswordStrength = styled.div`
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;

  @media (max-width: 520px) {
    margin-top: 6px;
  }
`;

const PasswordStrengthTrack = styled.div`
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
  position: relative;
`;

const strengthTone = {
  idle: 'rgba(255,255,255,0.15)',
  weak: '#ff6b7a',
  medium: '#f0b740',
  good: '#74d27b',
  strong: '#2fd37c',
};

const PasswordStrengthFill = styled.div`
  height: 100%;
  width: ${props => (props.$percent ? `${props.$percent}%` : '0%')};
  background: ${props => strengthTone[props.$tone] || strengthTone.idle};
  transition: width 0.2s ease, background 0.2s ease;
  border-radius: 2px;
`;

const PasswordStrengthLabel = styled.span`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: ${props => strengthTone[props.$tone] || 'rgba(255,255,255,0.5)'};
  white-space: nowrap;
  min-width: 56px;
  text-align: right;
`;

const Button = styled(motion.button)`
  width: 100%;
  flex: 1 1 auto;
  min-height: 54px;
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.94);
  border: none;
  border-radius: 16px;
  color: black;
  font-size: 14px;
  font-weight: 820;
  cursor: pointer;
  text-transform: uppercase;
  margin-top: 0;
  font-family: 'Unbounded', sans-serif;
  letter-spacing: 0.9px;
  box-shadow: 
    0 8px 20px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
  transition: background 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, opacity 0.18s ease;
  position: relative;
  z-index: 1;

  @media (max-width: 520px) {
    min-height: 46px;
    border-radius: 14px;
    font-size: 12px;
    padding: 0 16px;
  }
  
  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 1);
    box-shadow: 
      0 12px 28px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.6);
  }
  
  &:active:not(:disabled) {
    transform: translateY(2px);
    box-shadow: 
      0 4px 12px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }
  
  &:disabled {
    opacity: 1;
    background: rgba(255, 255, 255, 0.2);
    color: rgba(255, 255, 255, 0.38);
    box-shadow: none;
    cursor: not-allowed;
    transform: none;
  }
`;

const BackButton = styled.button`
  flex: 0 0 116px;
  min-height: 54px;
  padding: 0 18px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.055);
  color: rgba(255, 255, 255, 0.78);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 760;
  text-transform: uppercase;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.09);
    color: white;
  }

  @media (max-width: 520px) {
    flex-basis: 92px;
    min-height: 46px;
    border-radius: 14px;
    font-size: 10px;
    padding: 0 12px;
  }
`;

const ErrorMessage = styled(motion.div)`
  background: linear-gradient(135deg, 
    rgba(255, 68, 88, 0.15) 0%, 
    rgba(200, 50, 70, 0.1) 100%
  );
  border: 1px solid rgba(255, 68, 88, 0.4);
  border-radius: 14px;
  padding: 14px 18px;
  color: #ff6b7a;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(255, 68, 88, 0.1);
  position: relative;
  z-index: 1;
`;

const SuccessMessage = styled(motion.div)`
  background: linear-gradient(135deg, 
    rgba(76, 217, 100, 0.15) 0%, 
    rgba(60, 180, 80, 0.1) 100%
  );
  border: 1px solid rgba(76, 217, 100, 0.4);
  border-radius: 14px;
  padding: 14px 18px;
  color: #5fff8d;
  font-size: 14px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(76, 217, 100, 0.1);
  position: relative;
  z-index: 1;
`;

const SafetyLine = styled.div`
  margin-top: 16px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.46);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;

  @media (max-width: 520px) {
    margin-top: 12px;
  }

  svg {
    font-size: 10px;
  }
`;

const EmailAuth = ({ onClose, onSuccess, initialMode = 'login', canClose = true }) => {
  const { loginWithEmail, registerWithEmail } = useAuth();
  const [mode, setMode] = useState(initialMode); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [username, setUsername] = useState('');
  const [registerStep, setRegisterStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [touchedFirstName, setTouchedFirstName] = useState(false);
  const [touchedUsername, setTouchedUsername] = useState(false);

  const hasTelegramLogin = useMemo(() => Boolean(getTelegramBotUsername()), []);
  const isRegister = mode === 'register';

  const trimmedEmail = email.trim();
  const trimmedFirstName = firstName.trim();
  const normalizedUsername = normalizeUsernameInput(username);
  const isEmailValid = EMAIL_REGEX.test(trimmedEmail);
  const isUsernameValid = USERNAME_REGEX.test(normalizedUsername);
  const passwordStrength = useMemo(
    () => evaluatePasswordStrength(password),
    [password]
  );

  const emailError = touchedEmail && trimmedEmail && !isEmailValid
    ? 'Похоже, это не email. Проверьте адрес.'
    : '';

  const firstNameError = isRegister && touchedFirstName && !trimmedFirstName
    ? 'Введите имя.'
    : '';

  const usernameError = (() => {
    if (!isRegister || !touchedUsername) return '';
    if (!normalizedUsername) return 'Введите username.';
    if (!isUsernameValid) return 'Username: 3-32 символа, буквы, цифры, точка, дефис или _.';
    return '';
  })();

  const passwordError = (() => {
    if (!touchedPassword || !password) return '';
    if (isRegister && !passwordStrength.meetsPolicy) {
      return `Минимум ${PASSWORD_MIN_LENGTH} символов, хотя бы одна буква и цифра.`;
    }
    return '';
  })();

  const confirmPasswordError = isRegister && touchedConfirm && confirmPassword && password !== confirmPassword
    ? 'Пароли не совпадают.'
    : '';

  const canSubmit = (() => {
    if (loading) return false;
    if (isRegister && registerStep === 1) {
      return Boolean(trimmedFirstName) && isUsernameValid;
    }
    if (!isEmailValid) return false;
    if (!password) return false;
    if (isRegister) {
      if (!passwordStrength.meetsPolicy) return false;
      if (password !== confirmPassword) return false;
    }
    return true;
  })();

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyPaddingRight = document.body.style.paddingRight;

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.paddingRight = prevBodyPaddingRight;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const setAuthViewportHeight = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      if (height > 0) {
        root.style.setProperty('--auth-viewport-height', `${Math.round(height)}px`);
      }
    };

    setAuthViewportHeight();
    window.addEventListener('resize', setAuthViewportHeight);
    window.visualViewport?.addEventListener('resize', setAuthViewportHeight);
    window.visualViewport?.addEventListener('scroll', setAuthViewportHeight);

    return () => {
      window.removeEventListener('resize', setAuthViewportHeight);
      window.visualViewport?.removeEventListener('resize', setAuthViewportHeight);
      window.visualViewport?.removeEventListener('scroll', setAuthViewportHeight);
      root.style.removeProperty('--auth-viewport-height');
    };
  }, []);

  const handleModeChange = useCallback((nextMode) => {
    if (mode === nextMode) return;
    setMode(nextMode);
    setError('');
    setSuccess('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setTouchedConfirm(false);
    setTouchedFirstName(false);
    setTouchedUsername(false);
    setRegisterStep(1);
    if (nextMode === 'login') {
      setConfirmPassword('');
    }
  }, [mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (isRegister && registerStep === 1) {
      setTouchedFirstName(true);
      setTouchedUsername(true);

      if (!trimmedFirstName) {
        setError('Введите имя');
        return;
      }
      if (!normalizedUsername) {
        setError('Введите username');
        return;
      }
      if (!isUsernameValid) {
        setError('Username должен быть 3-32 символа: буквы, цифры, точка, дефис или _');
        return;
      }

      setRegisterStep(2);
      return;
    }

    setTouchedEmail(true);
    setTouchedPassword(true);
    if (isRegister) {
      setTouchedConfirm(true);
      setTouchedFirstName(true);
      setTouchedUsername(true);
    }

    if (!isEmailValid) {
      setError('Неверный формат email');
      return;
    }
    if (!password) {
      setError('Введите пароль');
      return;
    }
    if (isRegister) {
      if (!trimmedFirstName) {
        setError('Введите имя');
        setRegisterStep(1);
        return;
      }
      if (!isUsernameValid) {
        setError('Проверьте username');
        setRegisterStep(1);
        return;
      }
      if (!passwordStrength.meetsPolicy) {
        setError(`Пароль должен быть минимум ${PASSWORD_MIN_LENGTH} символов и содержать хотя бы одну букву и цифру`);
        return;
      }
      if (password !== confirmPassword) {
        setError('Пароли не совпадают');
        return;
      }
    }

    setLoading(true);
    try {
      if (isRegister) {
        const data = await registerWithEmail(trimmedEmail, password, trimmedFirstName, normalizedUsername);
        setSuccess('Регистрация успешна! Перенаправление...');
        setTimeout(() => {
          if (onSuccess) onSuccess(data);
        }, 1000);
      } else {
        const data = await loginWithEmail(trimmedEmail, password);
        setSuccess('Вход выполнен! Загрузка...');
        setTimeout(() => {
          if (onSuccess) onSuccess(data);
        }, 1000);
      }
    } catch (err) {
      const msg = err && typeof err === 'object' && err.message ? String(err.message) : 'Ошибка авторизации';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContainer
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={canClose ? onClose : undefined}
    >
      <AuthCard
        initial={{ scale: 0.9, y: 50 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 50 }}
        onClick={(e) => e.stopPropagation()}
      >
        <CardInner>
          {canClose ? (
            <CloseButton
              onClick={onClose}
              whileHover={{ scale: 1.1, rotate: 90 }}
              whileTap={{ scale: 0.9 }}
              type="button"
              aria-label="Закрыть"
            >
              <FaTimes />
            </CloseButton>
          ) : null}

          <AuthHeader>
            <HeaderTop>
              <AuthBrand size="lg" title="Earflow" />
              <SecureBadge>
                <FaLock />
                защищенный вход
              </SecureBadge>
            </HeaderTop>
            <Title>{isRegister ? 'Создать аккаунт' : 'Войти в Earflow'}</Title>
            <Subtitle>
              {isRegister ? (
                registerStep === 1
                  ? 'Сначала имя и username. Потом email и пароль.'
                  : 'Email и пароль защищают вход в аккаунт.'
              ) : 'Продолжайте слушать с того места, где остановились.'}
            </Subtitle>
          </AuthHeader>

          <TabsContainer>
            <Tab $active={!isRegister} onClick={() => handleModeChange('login')} type="button">
              Вход
            </Tab>
            <Tab $active={isRegister} onClick={() => handleModeChange('register')} type="button">
              Регистрация
            </Tab>
          </TabsContainer>

          {!isRegister && hasTelegramLogin ? (
            <>
              <TelegramLoginButton
                onSuccess={(data) => {
                  if (onSuccess) onSuccess(data);
                }}
              />
              <Divider>или</Divider>
            </>
          ) : null}

          <Form onSubmit={handleSubmit} noValidate>
            {isRegister && (
              <StepIndicator aria-label="Шаг регистрации">
                <StepPill $active={registerStep === 1}>Профиль</StepPill>
                <StepPill $active={registerStep === 2}>Вход</StepPill>
              </StepIndicator>
            )}

            {isRegister && registerStep === 1 ? (
              <FormSection>
                <SectionLabel>Профиль</SectionLabel>
                <InputGroup>
                  <InputIcon><FaUser /></InputIcon>
                  <Input
                    type="text"
                    placeholder="Имя"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    onBlur={() => setTouchedFirstName(true)}
                    autoComplete="given-name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    maxLength={64}
                    required
                    aria-invalid={firstNameError ? 'true' : 'false'}
                    aria-describedby={firstNameError ? 'first-name-error' : undefined}
                  />
                  {firstNameError && (
                    <FieldMessage id="first-name-error" $tone="error">{firstNameError}</FieldMessage>
                  )}
                </InputGroup>

                <InputGroup>
                  <InputIcon><FaUser /></InputIcon>
                  <Input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(normalizeUsernameInput(e.target.value))}
                    onBlur={() => setTouchedUsername(true)}
                    autoComplete="username"
                    autoCapitalize="none"
                    enterKeyHint="next"
                    inputMode="text"
                    spellCheck={false}
                    maxLength={32}
                    required
                    aria-invalid={usernameError ? 'true' : 'false'}
                    aria-describedby={usernameError ? 'username-error' : undefined}
                  />
                  {usernameError && (
                    <FieldMessage id="username-error" $tone="error">{usernameError}</FieldMessage>
                  )}
                </InputGroup>
              </FormSection>
            ) : (
              <FormSection>
                {isRegister && <SectionLabel>Email и пароль</SectionLabel>}
                <InputGroup>
                  <InputIcon><FaEnvelope /></InputIcon>
                  <Input
                    type="email"
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() => setTouchedEmail(true)}
                    inputMode="email"
                    autoComplete={isRegister ? 'email' : 'username'}
                    autoCapitalize="none"
                    enterKeyHint="next"
                    spellCheck={false}
                    maxLength={254}
                    required
                    aria-invalid={emailError ? 'true' : 'false'}
                    aria-describedby={emailError ? 'email-error' : undefined}
                  />
                  {emailError && (
                    <FieldMessage id="email-error" $tone="error">{emailError}</FieldMessage>
                  )}
                </InputGroup>

                <InputGroup>
                  <InputIcon><FaLock /></InputIcon>
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isRegister ? `Пароль (минимум ${PASSWORD_MIN_LENGTH})` : 'Пароль'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouchedPassword(true)}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    autoCapitalize="none"
                    enterKeyHint={isRegister ? 'next' : 'done'}
                    required
                    minLength={isRegister ? PASSWORD_MIN_LENGTH : 1}
                    maxLength={256}
                    $hasTrailingAction
                    aria-invalid={passwordError ? 'true' : 'false'}
                    aria-describedby={passwordError ? 'password-error' : undefined}
                  />
                  <PasswordToggleBtn
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                    aria-pressed={showPassword}
                    tabIndex={0}
                  >
                    {showPassword ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
                  </PasswordToggleBtn>
                  {isRegister ? (
                    <PasswordStrength aria-live="polite">
                      <PasswordStrengthTrack>
                        <PasswordStrengthFill
                          $percent={passwordStrength.percent}
                          $tone={passwordStrength.tone}
                        />
                      </PasswordStrengthTrack>
                      <PasswordStrengthLabel $tone={passwordStrength.tone}>
                        {passwordStrength.label || 'Сложность'}
                      </PasswordStrengthLabel>
                    </PasswordStrength>
                  ) : null}
                  {passwordError && (
                    <FieldMessage id="password-error" $tone="error">{passwordError}</FieldMessage>
                  )}
                </InputGroup>

                {isRegister && (
                  <InputGroup>
                    <InputIcon><FaLock /></InputIcon>
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Подтвердите пароль"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      onBlur={() => setTouchedConfirm(true)}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      enterKeyHint="done"
                      required
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={256}
                      $hasTrailingAction
                      aria-invalid={confirmPasswordError ? 'true' : 'false'}
                      aria-describedby={confirmPasswordError ? 'confirm-error' : undefined}
                    />
                    <PasswordToggleBtn
                      type="button"
                      onClick={() => setShowConfirmPassword(v => !v)}
                      aria-label={showConfirmPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      aria-pressed={showConfirmPassword}
                      tabIndex={0}
                    >
                      {showConfirmPassword ? <FaEyeSlash size={14} /> : <FaEye size={14} />}
                    </PasswordToggleBtn>
                    {confirmPasswordError && (
                      <FieldMessage id="confirm-error" $tone="error">{confirmPasswordError}</FieldMessage>
                    )}
                  </InputGroup>
                )}
              </FormSection>
            )}

            <AnimatePresence>
              {error && (
                <ErrorMessage
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  role="alert"
                >
                  <FaTimes />
                  {error}
                </ErrorMessage>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {success && (
                <SuccessMessage
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  role="status"
                >
                  <FaCheck />
                  {success}
                </SuccessMessage>
              )}
            </AnimatePresence>

            <ActionRow>
              {isRegister && registerStep === 2 ? (
                <BackButton
                  type="button"
                  onClick={() => {
                    setError('');
                    setSuccess('');
                    setRegisterStep(1);
                  }}
                >
                  Назад
                </BackButton>
              ) : null}
              <Button
                type="submit"
                disabled={!canSubmit}
                aria-busy={loading ? 'true' : 'false'}
                whileHover={canSubmit ? { scale: 1.02 } : undefined}
                whileTap={canSubmit ? { scale: 0.98 } : undefined}
              >
                {loading ? 'Загрузка...' : isRegister && registerStep === 1 ? 'Продолжить' : isRegister ? 'Создать аккаунт' : 'Войти'}
              </Button>
            </ActionRow>
          </Form>
          <SafetyLine>
            <FaLock />
            Защищенная cookie-сессия Earflow
          </SafetyLine>
        </CardInner>
      </AuthCard>
    </AuthContainer>
  );
};

export default EmailAuth;
