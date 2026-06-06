import React from 'react';
import styled from 'styled-components';
import { FaSignOutAlt, FaCircle, FaSync } from 'react-icons/fa';

import { resolveDeviceIcon } from './iconMap';

export default function SecuritySessionsCard({
  sessions,
  capability,
  loading,
  onRefresh,
  onRevokeOthers,
  submitting,
  error,
}) {
  const items = Array.isArray(sessions) ? sessions : [];
  const canRevoke = capability?.canRevokeOthers === true && !submitting;
  const otherCount = Number.isFinite(Number(capability?.otherCount)) ? Number(capability.otherCount) : 0;

  return (
    <Card>
      <Head>
        <TitleGroup>
          <Eyebrow>Активные устройства</Eyebrow>
          <Title>Сессии</Title>
          <Sub>
            Список устройств, на которых открыт кабинет.
            Если видите незнакомое устройство — смените пароль и завершите чужие сессии.
          </Sub>
        </TitleGroup>

        <HeadActions>
          <IconButton
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Обновить список"
          >
            <FaSync size={12} aria-hidden="true" />
            <span>Обновить</span>
          </IconButton>
        </HeadActions>
      </Head>

      {error ? <ErrorStrip>{error}</ErrorStrip> : null}

      {loading && items.length === 0 ? (
        <EmptyState>Загружаем сессии…</EmptyState>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <EmptyState>Активных сессий не обнаружено.</EmptyState>
      ) : null}

      {items.length > 0 ? (
        <List>
          {items.map((s) => {
            const Icon = resolveDeviceIcon(s.deviceType);
            return (
              <Row key={s.sid} $current={s.current === true}>
                <DeviceIcon $current={s.current === true} aria-hidden="true">
                  <Icon size={16} />
                </DeviceIcon>
                <Info>
                  <DeviceName>{s.device || 'Неизвестное устройство'}</DeviceName>
                  <Meta>
                    {s.current ? (
                      <CurrentBadge>
                        <FaCircle size={7} aria-hidden="true" />
                        Это устройство
                      </CurrentBadge>
                    ) : null}
                    {s.ip ? <MetaChip>{s.ip}</MetaChip> : null}
                    {s.lastSeenLabel ? <MetaChip>Активность: {s.lastSeenLabel}</MetaChip> : null}
                    {s.createdAtLabel ? <MetaChip>Вход: {s.createdAtLabel}</MetaChip> : null}
                    {s.expiresLabel ? <MetaChip $dim>{s.expiresLabel}</MetaChip> : null}
                  </Meta>
                </Info>
              </Row>
            );
          })}
        </List>
      ) : null}

      {otherCount > 0 ? (
        <Bottom>
          <DangerButton type="button" onClick={onRevokeOthers} disabled={!canRevoke}>
            <FaSignOutAlt size={12} style={{ marginRight: 8 }} aria-hidden="true" />
            {submitting ? 'Завершаем…' : `Завершить другие сессии (${otherCount})`}
          </DangerButton>
        </Bottom>
      ) : null}
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
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const HeadActions = styled.div`
  display: flex;
  gap: 8px;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const Title = styled.h2`
  font-size: 22px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;

  @media (max-width: 720px) {
    font-size: 19px;
  }
`;

const Sub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.55;
  max-width: 600px;
`;

const IconButton = styled.button`
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  font-size: 11.5px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.28);
  }

  &:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 14px;
  align-items: center;
  padding: 14px;
  border-radius: 16px;
  background: ${(p) => (p.$current ? '#101010' : '#080808')};
  border: 0;
`;

const DeviceIcon = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.82);
`;

const Info = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const DeviceName = styled.div`
  font-size: 14px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.95);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const MetaChip = styled.div`
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  background: ${(p) => (p.$dim ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.05)')};
  border: 0;
  color: ${(p) => (p.$dim ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.7)')};
  font-weight: 700;
  letter-spacing: 0.02em;
`;

const CurrentBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: #181818;
  border: 0;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 800;
  letter-spacing: 0.04em;

  svg {
    color: rgba(255, 255, 255, 0.9);
  }
`;

const EmptyState = styled.div`
  padding: 20px;
  text-align: center;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  border-radius: 14px;
  border: 0;
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
