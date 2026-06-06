import React from 'react';
import styled from 'styled-components';
import {
  FaShieldAlt,
  FaCheckCircle,
  FaExclamationTriangle,
  FaLock,
} from 'react-icons/fa';

import { resolveSeverityIcon } from './iconMap';

export default function SecurityHero({
  level,
  issues,
  account,
  mfa,
  stepUp,
  artistName,
}) {
  const levelLabel = typeof level?.label === 'string' ? level.label : '—';
  const levelTone = typeof level?.tone === 'string' ? level.tone : 'neutral';
  const levelIcon = levelTone === 'ok' ? <FaCheckCircle size={12} aria-hidden="true" /> : <FaExclamationTriangle size={12} aria-hidden="true" />;

  const identityParts = [];
  if (typeof artistName === 'string' && artistName.trim()) identityParts.push(artistName.trim());
  if (account?.email) identityParts.push(String(account.email));
  const identity = identityParts.length > 0 ? identityParts.join(' · ') : 'Аккаунт';

  const issueList = Array.isArray(issues) ? issues : [];

  return (
    <Wrap>
      <HeroBg aria-hidden="true">
        <BgOverlay $tone={levelTone} />
      </HeroBg>

      <Content>
        <ShieldBox $tone={levelTone} aria-hidden="true">
          <FaShieldAlt size={44} />
        </ShieldBox>

        <Info>
          <Eyebrow>Безопасность</Eyebrow>
          <Title>Защита аккаунта</Title>
          <Identity>{identity}</Identity>

          <BadgeRow>
            <LevelBadge $tone={levelTone}>
              {levelIcon}
              Уровень защиты: {levelLabel}
            </LevelBadge>
            {stepUp?.active ? (
              <StatusChip $tone="ok">
                <FaLock size={11} aria-hidden="true" />
                Сессия step-up активна
              </StatusChip>
            ) : null}
            {mfa?.enabled ? (
              <StatusChip $tone="ok">
                <FaCheckCircle size={11} aria-hidden="true" />
                2FA включена
              </StatusChip>
            ) : (
              <StatusChip $tone="warn">
                <FaExclamationTriangle size={11} aria-hidden="true" />
                2FA выключена
              </StatusChip>
            )}
            {account?.hasTelegram ? (
              <StatusChip $tone="neutral">Telegram привязан</StatusChip>
            ) : null}
          </BadgeRow>

          {issueList.length > 0 ? (
            <IssueList>
              {issueList.map((issue) => {
                const Icon = resolveSeverityIcon(issue?.severity);
                return (
                  <IssueItem key={issue?.id || issue?.title} $severity={issue?.severity}>
                    <Icon size={11} aria-hidden="true" />
                    <IssueTextGroup>
                      <IssueTitle>{issue?.title || ''}</IssueTitle>
                      {issue?.message ? <IssueMsg>{issue.message}</IssueMsg> : null}
                    </IssueTextGroup>
                  </IssueItem>
                );
              })}
            </IssueList>
          ) : null}
        </Info>
      </Content>
    </Wrap>
  );
}

const Wrap = styled.div`
  position: relative;
  width: 100%;
  border-radius: 22px;
  overflow: hidden;
  background: #080808;
  border: 0;
  box-shadow: none;
`;

const HeroBg = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
`;

const BgOverlay = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.82);
`;

const Content = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 22px;
  align-items: center;
  padding: 24px;

  @media (max-width: 720px) {
    grid-template-columns: 72px 1fr;
    gap: 16px;
    padding: 18px;
  }
`;

const ShieldBox = styled.div`
  width: 110px;
  height: 110px;
  border-radius: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #181818;
  border: 0;
  color: ${(p) => {
    if (p.$tone === 'danger') return 'rgba(255, 255, 255, 0.95)';
    return 'rgba(255, 255, 255, 0.9)';
  }};
  box-shadow: none;

  @media (max-width: 720px) {
    width: 72px;
    height: 72px;
    border-radius: 20px;

    svg {
      width: 30px;
      height: 30px;
    }
  }
`;

const Info = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
`;

const Title = styled.h1`
  margin: 0;
  font-size: 42px;
  font-weight: 900;
  line-height: 1.02;
  letter-spacing: -0.03em;
  color: #fff;
  word-break: break-word;

  @media (max-width: 900px) {
    font-size: 32px;
  }

  @media (max-width: 720px) {
    font-size: 24px;
  }
`;

const Identity = styled.div`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.65);
  word-break: break-word;
`;

const BadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 2px;
`;

const LevelBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.04em;

  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.88);
`;

const StatusChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;

  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.82);
`;

const IssueList = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const IssueItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 0;
  background: #101010;
  color: rgba(255, 255, 255, 0.82);

  svg {
    flex-shrink: 0;
    margin-top: 2px;
  }
`;

const IssueTextGroup = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const IssueTitle = styled.div`
  font-size: 12.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
`;

const IssueMsg = styled.div`
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.55);
`;
