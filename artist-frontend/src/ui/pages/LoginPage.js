import React, { useMemo, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import styled from 'styled-components';

import { useAuth } from '../../state/auth/AuthContext';
import Shell from '../layout/Shell';
import Card from '../components/Card';
import Input from '../components/Input';
import Button from '../components/Button';

const normalizeEmail = (v) => String(v || '').trim().toLowerCase();

const getErrorMessage = (e) => {
  const msg = e?.data?.error;
  if (typeof msg === 'string' && msg.trim()) return msg.trim();
  return 'Неверные учетные данные или ошибка сервиса';
};

export default function LoginPage() {
  const { status, login } = useAuth();
  const loc = useLocation();

  const params = useMemo(() => new URLSearchParams(loc.search || ''), [loc.search]);
  const next = String(params.get('next') || '/').trim() || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (status === 'authenticated') {
    return <Navigate to={next} replace />;
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    const safeEmail = normalizeEmail(email);
    if (!safeEmail || !password) {
      setError('Введите email и пароль');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await login({ email: safeEmail, password });
    } catch (error_) {
      setError(getErrorMessage(error_));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell>
      <Center>
        <Wrap>
          <Title>Earflow Artists</Title>
          <SubTitle>Вход для артистов</SubTitle>
          <Card>
            <form onSubmit={onSubmit}>
              <Field>
                <Label>Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  inputMode="email"
                  placeholder="artist@domain.com"
                />
              </Field>
              <Field>
                <Label>Пароль</Label>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  type="password"
                  placeholder="********"
                />
              </Field>
              {error ? <ErrorText>{error}</ErrorText> : null}
              <ButtonRow>
                <Button type="submit" $variant="primary" disabled={submitting}>Войти</Button>
              </ButtonRow>
            </form>
          </Card>

          <FootRow>
            <FootText>
              Нет аккаунта? <FootLink to={`/signup?next=${encodeURIComponent(next)}`}>Создать</FootLink>
            </FootText>
          </FootRow>
        </Wrap>
      </Center>
    </Shell>
  );
}

const Center = styled.div`
  width: 100%;
  min-height: calc(100vh - env(safe-area-inset-bottom, 0px));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px 18px;
`;

const Wrap = styled.div`
  width: min(520px, 100%);
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Title = styled.h1`
  text-align: center;
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0.6px;
`;

const SubTitle = styled.p`
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  line-height: 1.5;
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 14px;
`;

const Label = styled.label`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.3px;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 12px;
  justify-content: stretch;
`;

const ErrorText = styled.div`
  margin: 8px 0 14px;
  color: rgba(255, 255, 255, 0.10);
  font-size: 13px;
  line-height: 1.4;
`;

const FootRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 6px 0 0;
`;

const FootText = styled.div`
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  line-height: 1.4;
`;

const FootLink = styled(Link)`
  color: rgba(255, 255, 255, 0.92);
  text-decoration: none;
  font-weight: 700;

  &:hover {
    text-decoration: underline;
  }
`;
