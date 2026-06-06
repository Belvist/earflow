import React, { useMemo } from 'react';
import styled from 'styled-components';
import { FaDesktop, FaMobileAlt, FaHeadphones, FaTv, FaQuestionCircle, FaCircle, FaTrashAlt, FaExchangeAlt } from 'react-icons/fa';
import { filterPresentDevices } from '../../utils/devicePresence';

/**
 * DevicesPanel — presentational.
 *
 * Список «сейчас в сети» — filterPresentDevices (как у Spotify: не тянуть
 * выключенные ТВ/ПК, пока приложение снова не пинганёт).
 */

const KIND_ICON = {
    desktop: FaDesktop,
    web: FaDesktop,
    'mobile-web': FaMobileAlt,
    android: FaMobileAlt,
    ios: FaMobileAlt,
    tv: FaTv,
    speaker: FaHeadphones,
    other: FaQuestionCircle,
};

function formatRelativeSeconds(ts) {
    if (!ts) return '';
    const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (delta < 10) return 'только что';
    if (delta < 60) return `${delta}с назад`;
    if (delta < 3600) return `${Math.floor(delta / 60)}м назад`;
    if (delta < 86400) return `${Math.floor(delta / 3600)}ч назад`;
    return `${Math.floor(delta / 86400)}д назад`;
}

export default function DevicesPanel({
    devices = [],
    nowPlaying = null,
    currentDeviceId = null,
    connectionState = 'disconnected',
    onTransfer,
    onRemove,
    onReconnect,
}) {
    const raw = Array.isArray(devices) ? devices : [];
    const list = useMemo(
        () => filterPresentDevices(raw, currentDeviceId),
        [raw, currentDeviceId]
    );
    const allStale = raw.length > 0 && list.length === 0;

    return (
        <Wrapper>
            <Header>
                <Title>Устройства</Title>
                <ConnectionPill $state={connectionState}>
                    <PillIcon aria-hidden><FaCircle size={6} /></PillIcon>
                    <PillLabel>
                        {connectionState === 'connected' && 'В сети'}
                        {connectionState === 'standby' && 'Ожидание 2-го'}
                        {connectionState === 'connecting' && 'Соединяем…'}
                        {connectionState === 'reconnecting' && 'Соединяем…'}
                        {connectionState === 'disconnected' && 'Нет сети'}
                        {connectionState === 'error' && 'Сбой'}
                        {connectionState === 'disabled' && 'Выкл.'}
                    </PillLabel>
                </ConnectionPill>
            </Header>

            {nowPlaying && (nowPlaying.title || nowPlaying.trackId) ? (
                <NowPlayingCard>
                    {nowPlaying.cover
                        ? <NowPlayingCover src={nowPlaying.cover} alt="" />
                        : <NowPlayingCoverPlaceholder />}
                    <NowPlayingInfo>
                        <NowPlayingTitle>{nowPlaying.title || 'Без названия'}</NowPlayingTitle>
                        <NowPlayingArtist>{nowPlaying.artist || '—'}</NowPlayingArtist>
                        <NowPlayingMeta>
                            {nowPlaying.isPlaying ? 'играет' : 'на паузе'}
                            {nowPlaying.updatedAtMs ? ` • обновлено ${formatRelativeSeconds(nowPlaying.updatedAtMs)}` : null}
                        </NowPlayingMeta>
                    </NowPlayingInfo>
                </NowPlayingCard>
            ) : null}

            {connectionState === 'disabled' ? (
                <EmptyState>
                    <EmptyTitle>Синхронизация отключена</EmptyTitle>
                    <EmptyText>
                        Функция пока недоступна в этой сборке. Проверка состояния происходит на сервере —
                        вручную ничего делать не нужно.
                    </EmptyText>
                </EmptyState>
            ) : list.length === 0 ? (
                <EmptyState>
                    <EmptyTitle>
                        {allStale ? 'Сейчас в сети никого' : 'Ни одного активного устройства'}
                    </EmptyTitle>
                    <EmptyText>
                        {allStale
                            ? 'Старые устройства не показываем — откройте на них Earflow, чтобы снова появились (как в Spotify Connect).'
                            : 'Как только вы войдёте в Earflow на другом устройстве — оно появится здесь.'}
                    </EmptyText>
                    {typeof onReconnect === 'function' && connectionState !== 'connected' ? (
                        <SecondaryBtn type="button" onClick={onReconnect}>Переподключиться</SecondaryBtn>
                    ) : null}
                </EmptyState>
            ) : (
                <List>
                    {list.map((d) => {
                        const Icon = KIND_ICON[d.kind] || FaQuestionCircle;
                        const isMe = currentDeviceId && d.id === currentDeviceId;
                        return (
                            <DeviceRow key={d.id} $active={!!d.isActive}>
                                <DeviceLeft>
                                    <IconCircle $active={!!d.isActive}>
                                        <Icon size={14} />
                                    </IconCircle>
                                    <DeviceMeta>
                                        <DeviceName>
                                            {d.name || 'Устройство'}
                                            {isMe ? <ThisDeviceTag>это устройство</ThisDeviceTag> : null}
                                        </DeviceName>
                                        <DeviceSub>
                                            {d.isActive ? 'активно' : 'подключено'}
                                            {d.lastSeenAt ? ` • ${formatRelativeSeconds(d.lastSeenAt)}` : null}
                                        </DeviceSub>
                                    </DeviceMeta>
                                </DeviceLeft>
                                <DeviceActions>
                                    {!d.isActive && typeof onTransfer === 'function' ? (
                                        <ActionBtn
                                            type="button"
                                            onClick={() => onTransfer(d.id)}
                                            aria-label="Передать воспроизведение"
                                            title="Передать воспроизведение"
                                        >
                                            <FaExchangeAlt size={12} />
                                        </ActionBtn>
                                    ) : null}
                                    {typeof onRemove === 'function' && !isMe ? (
                                        <ActionBtn
                                            $danger
                                            type="button"
                                            onClick={() => onRemove(d.id)}
                                            aria-label="Отключить устройство"
                                            title="Отключить устройство"
                                        >
                                            <FaTrashAlt size={12} />
                                        </ActionBtn>
                                    ) : null}
                                </DeviceActions>
                            </DeviceRow>
                        );
                    })}
                </List>
            )}
        </Wrapper>
    );
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  font-family: 'Unbounded', sans-serif;
  color: #fff;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
`;

const Title = styled.h3`
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 4px;
`;

const connectionTone = {
    connected: '#32d74b',
    standby: '#64d2ff',
    connecting: '#ffd60a',
    reconnecting: '#ffd60a',
    disconnected: 'rgba(255,255,255,0.45)',
    error: '#ff453a',
    disabled: 'rgba(255,255,255,0.35)',
};

const PillIcon = styled.span`
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  line-height: 0;
`;

const PillLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ConnectionPill = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 500;
  max-width: min(58%, 200px);
  min-width: 0;
  flex-shrink: 1;
  color: ${p => connectionTone[p.$state] || connectionTone.disconnected};
  background: ${p => (
        p.$state === 'connected' ? 'rgba(50, 215, 75, 0.12)' :
            p.$state === 'standby' ? 'rgba(100, 210, 255, 0.1)' :
                (p.$state === 'connecting' || p.$state === 'reconnecting') ? 'rgba(255, 214, 10, 0.12)' :
                    p.$state === 'error' ? 'rgba(255, 69, 58, 0.12)' :
                        'rgba(255, 255, 255, 0.05)')};
  border: 1px solid rgba(255, 255, 255, 0.06);
`;

const NowPlayingCard = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.06);
`;

const NowPlayingCover = styled.img`
  width: 44px;
  height: 44px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
`;

const NowPlayingCoverPlaceholder = styled.div`
  width: 44px;
  height: 44px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
`;

const NowPlayingInfo = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const NowPlayingTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const NowPlayingArtist = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const NowPlayingMeta = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 2px;
`;

const EmptyState = styled.div`
  padding: 22px 16px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px dashed rgba(255, 255, 255, 0.08);
  text-align: center;
`;

const EmptyTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
`;

const EmptyText = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.5;
  margin: 0 auto 10px;
  max-width: 320px;
`;

const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 8px 14px;
  font-size: 12px;
  font-family: inherit;
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  cursor: pointer;

  &:hover { background: rgba(255, 255, 255, 0.14); }
  &:active { transform: scale(0.98); }
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const DeviceRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: ${p => (p.$active ? 'rgba(50, 215, 75, 0.07)' : 'rgba(255, 255, 255, 0.04)')};
  border: 1px solid ${p => (p.$active ? 'rgba(50, 215, 75, 0.22)' : 'rgba(255, 255, 255, 0.06)')};
`;

const DeviceLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
`;

const IconCircle = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${p => (p.$active ? 'rgba(50, 215, 75, 0.18)' : 'rgba(255, 255, 255, 0.08)')};
  color: ${p => (p.$active ? '#32d74b' : 'rgba(255, 255, 255, 0.8)')};
  flex-shrink: 0;
`;

const DeviceMeta = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const DeviceName = styled.div`
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ThisDeviceTag = styled.span`
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.7);
  font-weight: 500;
  text-transform: lowercase;
  letter-spacing: 0.2px;
`;

const DeviceSub = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 1px;
`;

const DeviceActions = styled.div`
  display: flex;
  gap: 6px;
  flex-shrink: 0;
`;

const ActionBtn = styled.button`
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid ${p => (p.$danger ? 'rgba(255, 69, 58, 0.35)' : 'rgba(255, 255, 255, 0.12)')};
  background: ${p => (p.$danger ? 'rgba(255, 69, 58, 0.1)' : 'rgba(255, 255, 255, 0.06)')};
  color: ${p => (p.$danger ? '#ff453a' : '#fff')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;

  &:hover {
    background: ${p => (p.$danger ? 'rgba(255, 69, 58, 0.18)' : 'rgba(255, 255, 255, 0.12)')};
  }

  &:active { transform: scale(0.94); }
`;
