import React, { useCallback, useEffect, useState } from 'react';
import styled from 'styled-components';
import { FaDesktop, FaMobileAlt, FaTabletAlt } from 'react-icons/fa';
import apiClient from '../../api/client';

const DEVICE_ICONS = {
  desktop: FaDesktop,
  mobile: FaMobileAlt,
  tablet: FaTabletAlt,
};

function resolveDeviceIcon(type) {
  return DEVICE_ICONS[type] || FaDesktop;
}

export default function AuthDevicesSection() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const data = await apiClient.getAuthDevices();
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
    } catch (e) {
      setDevices([]);
      setError(e?.message || 'Не удалось загрузить устройства');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Wrap>
      <Header>
        <Title>Ключи устройств (PoP)</Title>
        <Refresh type="button" onClick={load} disabled={loading}>
          Обновить
        </Refresh>
      </Header>
      <Hint>
        Это браузеры и клиенты с зарегистрированным ключом подписи — не путать с Device Sync «динамиками».
      </Hint>

      {loading ? <Muted>Загрузка…</Muted> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}

      {!loading && !error && devices.length === 0 ? (
        <Muted>Нет активных PoP-устройств в базе сессий.</Muted>
      ) : null}

      <List>
        {devices.map((d) => {
          const Icon = resolveDeviceIcon(d.deviceType);
          return (
            <Item key={d.authDeviceId} $current={d.current === true}>
              <Icon />
              <Meta>
                <Name>
                  {d.device || 'Устройство'}
                  {d.current ? <Badge>это устройство</Badge> : null}
                  {d.sessionCurrent ? <Badge $muted>текущая сессия</Badge> : null}
                </Name>
                <Sub>
                  {d.lastSeenLabel || 'давно'}
                  {d.createdAtLabel ? ` · с ${d.createdAtLabel}` : ''}
                </Sub>
              </Meta>
            </Item>
          );
        })}
      </List>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
`;

const Refresh = styled.button`
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: inherit;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.8rem;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const Hint = styled.p`
  margin: 0;
  font-size: 0.82rem;
  opacity: 0.72;
  line-height: 1.35;
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Item = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.12)' : 'rgba(255,255,255,0.04)')};
  border: 1px solid ${(p) => (p.$current ? 'rgba(29, 185, 84, 0.35)' : 'rgba(255,255,255,0.08)')};
  svg {
    margin-top: 2px;
    opacity: 0.85;
  }
`;

const Meta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const Name = styled.div`
  font-weight: 600;
  font-size: 0.9rem;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
`;

const Sub = styled.div`
  font-size: 0.78rem;
  opacity: 0.72;
`;

const Badge = styled.span`
  font-size: 0.68rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 999px;
  background: ${(p) => (p.$muted ? 'rgba(255,255,255,0.1)' : 'rgba(29, 185, 84, 0.25)')};
`;

const Muted = styled.div`
  font-size: 0.85rem;
  opacity: 0.7;
`;

const ErrorText = styled.div`
  color: #f5b7b1;
  font-size: 0.85rem;
`;
