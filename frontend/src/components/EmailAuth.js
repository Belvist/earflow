import React, { useEffect, useMemo, useState, useCallback } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaLock, FaTimes, FaEye, FaEyeSlash } from 'react-icons/fa';

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
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  font-weight: 500;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
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
    radial-gradient(1200px 600px at 50% -10%, rgba(255, 255, 255, 0.05), transparent 60%),
    #0d0d0d;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 24px 18px;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
`;

const AuthCard = styled(motion.div)`
  background: #161616;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 32px 36px 24px;
  max-width: 400px;
  width: min(400px, 100%);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.55);
  max-height: calc(var(--auth-viewport-height, 100dvh) - 48px);
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;

  @media (max-width: 520px) {
    padding: 26px 22px 20px;
  }
`;

const CloseButton = styled(motion.button)`
  position: absolute;
  top: 16px;
  right: 16px;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.18s ease, color 0.18s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
`;

const AuthHeader = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 24px;
  text-align: center;
`;

const Title = styled.h2`
  margin: 10px 0 0;
  color: rgba(255, 255, 255, 0.97);
  font-family: 'Unbounded', sans-serif;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.2px;
  line-height: 1.2;
`;

const Subtitle = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.52);
  font-size: 13px;
  font-weight: 450;
  line-height: 1.45;
  max-width: 300px;
`;

const TabsContainer = styled.div`
  display: flex;
  gap: 4px;
  margin: 0 0 20px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 10px;
`;

const Tab = styled(motion.button)`
  flex: 1;
  min-height: 40px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: ${props => props.$active ? 'rgba(255, 255, 255, 0.95)' : 'transparent'};
  color: ${props => props.$active ? '#0d0d0d' : 'rgba(255, 255, 255, 0.6)'};
  font-size: 13px;
  font-weight: 650;
  font-family: 'Unbounded', sans-serif;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: ${props => props.$active ? '#fff' : 'rgba(255, 255, 255, 0.08)'};
    color: ${props => props.$active ? '#0d0d0d' : 'rgba(255, 255, 255, 0.9)'};
  }
`;

const StepIndicator = styled.div`
  display: flex;
  gap: 6px;
  margin: -4px 0 2px;
`;

const StepPill = styled.div`
  flex: 1;
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: ${props => props.$active ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.03)'};
  color: ${props => props.$active ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.35)'};
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
`;

const FormSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const SectionLabel = styled.div`
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 16px;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Field = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
`;

const FieldLabel = styled.label`
  margin-bottom: 6px;
  color: rgba(255, 255, 255, 0.62);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.2px;
`;

const Input = styled.input`
  width: 100%;
  height: 48px;
  padding: 0 16px;
  padding-right: ${props => (props.$hasTrailingAction ? '52px' : '16px')};
  background: rgba(255, 255, 255, 0.045);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  font-family: inherit;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;

  @media (max-width: 520px) {
    height: 46px;
    font-size: 16px;
  }

  &::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.45);
    background: rgba(255, 255, 255, 0.07);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.06);
  }

  &[aria-invalid='true'] {
    border-color: rgba(255, 107, 122, 0.6);
    box-shadow: 0 0 0 3px rgba(255, 68, 88, 0.08);
  }
`;

const PasswordToggleBtn = styled.button`
  position: absolute;
  right: 10px;
  top: calc(50% + 12px);
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;

  &:hover {
    color: rgba(255, 255, 255, 0.9);
    background: rgba(255, 255, 255, 0.06);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.4);
    outline-offset: 2px;
  }
`;

const FieldMessage = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: ${props => props.$tone === 'error' ? '#ff8a94' : 'rgba(255, 255, 255, 0.5)'};
  line-height: 1.4;
`;

const PasswordStrength = styled.div`
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
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
  color: ${props => strengthTone[props.$tone] || 'rgba(255,255,255,0.45)'};
  white-space: nowrap;
  min-width: 56px;
  text-align: right;
`;

const Button = styled(motion.button)`
  width: 100%;
  flex: 1 1 auto;
  min-height: 50px;
  padding: 0 24px;
  background: rgba(255, 255, 255, 0.95);
  border: none;
  border-radius: 999px;
  color: #0d0d0d;
  font-size: 14px;
  font-weight: 700;
  font-family: 'Unbounded', sans-serif;
  cursor: pointer;
  transition: background 0.15s ease, opacity 0.15s ease, transform 0.15s ease;

  &:hover:not(:disabled) {
    background: #fff;
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

const BackButton = styled.button`
  flex: 0 0 auto;
  min-height: 50px;
  padding: 0 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.07);
    color: #fff;
  }
`;

const ErrorMessage = styled(motion.div)`
  border: 1px solid rgba(255, 107, 122, 0.4);
  background: rgba(255, 68, 88, 0.1);
  border-radius: 10px;
  padding: 11px 14px;
  color: #ff8a94;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  position: relative;
  z-index: 1;
`;

const SuccessMessage = styled(motion.div)`
  border: 1px solid rgba(76, 217, 100, 0.4);
  background: rgba(76, 217, 100, 0.1);
  border-radius: 10px;
  padding: 11px 14px;
  color: #5fff8d;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  position: relative;
  z-index: 1;
`;

const SafetyLine = styled.div`
  margin-top: 18px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 7px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;

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
    let timer = null;
    let raf = null;

    const applyHeight = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      if (height > 0) {
        root.style.setProperty('--auth-viewport-height', `${Math.round(height)}px`);
      }
    };

    const schedule = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        raf = window.requestAnimationFrame(applyHeight);
      }, 140);
    };

    applyHeight();
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);

    return () => {
      if (timer) window.clearTimeout(timer);
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
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

  const handleTelegramSuccess = useCallback((data) => {
    if (onSuccess) onSuccess(data);
  }, [onSuccess]);

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
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
      >
        {canClose ? (
          <CloseButton
            onClick={onClose}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            type="button"
            aria-label="Закрыть"
          >
            <FaTimes />
          </CloseButton>
        ) : null}

        <AuthHeader>
          <BrandLink size="lg" title="Earflow" />
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
            <TelegramLoginButton onSuccess={handleTelegramSuccess} />
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
              <Field>
                <FieldLabel htmlFor="auth-first-name">Имя</FieldLabel>
                <Input
                  id="auth-first-name"
                  type="text"
                  placeholder="Иван"
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
              </Field>

              <Field>
                <FieldLabel htmlFor="auth-username">Username</FieldLabel>
                <Input
                  id="auth-username"
                  type="text"
                  placeholder="yourname"
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
              </Field>
            </FormSection>
          ) : (
            <FormSection>
              {isRegister && <SectionLabel>Email и пароль</SectionLabel>}
              <Field>
                <FieldLabel htmlFor="auth-email">Email</FieldLabel>
                <Input
                  id="auth-email"
                  type="email"
                  placeholder="you@example.com"
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
              </Field>

              <Field>
                <FieldLabel htmlFor="auth-password">Пароль</FieldLabel>
                <Input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isRegister ? `Минимум ${PASSWORD_MIN_LENGTH} символов` : 'Пароль'}
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
              </Field>

              {isRegister && (
                <Field>
                  <FieldLabel htmlFor="auth-confirm">Подтвердите пароль</FieldLabel>
                  <Input
                    id="auth-confirm"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Повторите пароль"
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
                </Field>
              )}
            </FormSection>
          )}

          <AnimatePresence>
            {error && (
              <ErrorMessage
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                role="alert"
              >
                {error}
              </ErrorMessage>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {success && (
              <SuccessMessage
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                role="status"
              >
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
              whileHover={canSubmit ? { scale: 1.01 } : undefined}
              whileTap={canSubmit ? { scale: 0.99 } : undefined}
            >
              {loading ? 'Загрузка...' : isRegister && registerStep === 1 ? 'Продолжить' : isRegister ? 'Создать аккаунт' : 'Войти'}
            </Button>
          </ActionRow>
        </Form>
        <SafetyLine>
          <FaLock />
          Защищенная cookie-сессия Earflow
        </SafetyLine>
      </AuthCard>
    </AuthContainer>
  );
};

export default EmailAuth;
