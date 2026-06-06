import React from 'react';
import styled from 'styled-components';
import { FaTelegramPlane, FaLink, FaUnlink } from 'react-icons/fa';

export default function SecurityTelegramCard({
  account,
  capability,
  onUnlink,
  submitting,
  error,
}) {
  const linked = account?.hasTelegram === true;
  const canUnlink = capability?.canUnlink === true && !submitting;
  const blockReason = capability?.blockReason?.message || '';

  return (
    <Card>
      <Head>
        <IconBox aria-hidden="true">
          <FaTelegramPlane size={20} />
        </IconBox>
        <TitleGroup>
          <Eyebrow>Привязанные входы</Eyebrow>
          <Title>Telegram</Title>
          <Sub>
            {linked
              ? 'Аккаунт Telegram привязан и может использоваться для входа.'
              : 'Telegram не привязан к этому аккаунту.'}
          </Sub>
        </TitleGroup>

        <StatusBadge $on={linked}>
          <FaLink size={11} aria-hidden="true" />
          {linked ? 'Привязан' : 'Не привязан'}
        </StatusBadge>
      </Head>

      {linked ? (
        <>
          {blockReason && !canUnlink ? (
            <Warning>
              <FaUnlink size={12} aria-hidden="true" />
              <span>{blockReason}</span>
            </Warning>
          ) : null}

          {error ? <ErrorStrip>{error}</ErrorStrip> : null}

          <Bottom>
            <DangerButton
              type="button"
              onClick={onUnlink}
              disabled={!canUnlink}
              title={blockReason || ''}
            >
              <FaUnlink size={12} style={{ marginRight: 8 }} aria-hidden="true" />
              {submitting ? 'Отвязываем…' : 'Отвязать Telegram'}
            </DangerButton>
          </Bottom>
        </>
      ) : (
        <Placeholder>
          Привязка Telegram выполняется из модального окна входа
          по кнопке «Telegram Login» на главной странице.
        </Placeholder>
      )}
    </Card>
  );
}

const Card = styled.section`
  border-radius: 22px;
  border: 0;
  background: #080808;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 18px;
  }
`;

const Head = styled.div`
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: 14px;
  align-items: flex-start;

  @media (max-width: 540px) {
    grid-template-columns: 44px 1fr;
    & > :last-child {
      grid-column: 1 / -1;
    }
  }
`;

const IconBox = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(36, 140, 210, 0.15);
  border: 0;
  color: rgba(180, 220, 245, 0.98);
`;

const TitleGroup = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const Title = styled.h2`
  font-size: 20px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;
`;

const Sub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.5;
  max-width: 560px;
`;

const StatusBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  height: fit-content;
  font-size: 11.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.88);
`;

const Warning = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.78);
  font-size: 12.5px;

  & > span {
    flex: 1;
    min-width: 0;
  }
`;

const Placeholder = styled.div`
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  line-height: 1.5;
`;

const ErrorStrip = styled.div`
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.10);
  border: 0;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12.5px;
`;

const Bottom = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const DangerButton = styled.button`
  appearance: none;
  border: 0;
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.78);
  border-radius: 14px;
  padding: 12px 18px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.10);
    border-color: transparent;
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.72);
    outline-offset: 2px;
  }
`;
