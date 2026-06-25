import React, { useMemo } from 'react';
import styled from 'styled-components';
import {
  FaDesktop,
  FaMobileAlt,
  FaHeadphones,
  FaTv,
  FaQuestionCircle,
  FaEllipsisH,
  FaExchangeAlt,
  FaTrashAlt,
} from 'react-icons/fa';
import { filterPresentDevices } from '../../utils/devicePresence';

/**
 * DevicesPanel — Spotify Connect-like presentational list.
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

const ACCENT = '#1db954';

function formatRelativeSeconds(ts) {
  if (!ts) return '';
  const delta = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (delta < 10) return 'только что';
  if (delta < 60) return `${delta} с назад`;
  if (delta < 3600) return `${Math.floor(delta / 60)} мин назад`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} ч назад`;
  return `${Math.floor(delta / 86400)} д назад`;
}

function resolveHeroSubtitle(device, currentDeviceId) {
  if (!device) return '';
  const isMe = currentDeviceId && device.id === currentDeviceId;
  if (device.isActive && isMe) return 'Сейчас играет здесь';
  if (device.isActive && !isMe) return 'Управление с этого устройства';
  if (isMe) return 'Это устройство';
  return device.lastSeenAt ? formatRelativeSeconds(device.lastSeenAt) : 'Подключено';
}

function DeviceMenu({ deviceId, onTransfer, onRemove, canTransfer, canRemove }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (!canTransfer && !canRemove) return null;

  return (
    <MenuWrap ref={ref}>
      <MenuBtn
        type="button"
        aria-label="Действия с устройством"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <FaEllipsisH size={14} />
      </MenuBtn>
      {open ? (
        <MenuPopover>
          {canTransfer ? (
            <MenuItem
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onTransfer(deviceId);
              }}
            >
              <FaExchangeAlt size={12} aria-hidden />
              Передать воспроизведение
            </MenuItem>
          ) : null}
          {canRemove ? (
            <MenuItem
              type="button"
              $danger
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onRemove(deviceId);
              }}
            >
              <FaTrashAlt size={12} aria-hidden />
              Отключить
            </MenuItem>
          ) : null}
        </MenuPopover>
      ) : null}
    </MenuWrap>
  );
}

export default function DevicesPanel({
  devices = [],
  nowPlaying = null,
  currentDeviceId = null,
  connectionState = 'disconnected',
  onTransfer,
  onRemove,
  onReconnect,
  embedded = false,
  showTitle = false,
}) {
  const raw = Array.isArray(devices) ? devices : [];
  const list = useMemo(
    () => filterPresentDevices(raw, currentDeviceId),
    [raw, currentDeviceId],
  );
  const allStale = raw.length > 0 && list.length === 0;

  const activeDevice = useMemo(
    () => list.find((d) => d.isActive) || null,
    [list],
  );
  const thisDevice = useMemo(
    () => list.find((d) => currentDeviceId && d.id === currentDeviceId) || null,
    [list, currentDeviceId],
  );
  const heroDevice = activeDevice || thisDevice || list[0] || null;
  const otherDevices = useMemo(
    () => (heroDevice ? list.filter((d) => d.id !== heroDevice.id) : list),
    [list, heroDevice],
  );

  const handleRowClick = (device) => {
    if (!device || device.isActive) return;
    if (typeof onTransfer === 'function') onTransfer(device.id);
  };

  const renderDeviceRow = (device, { compact = false } = {}) => {
    const Icon = KIND_ICON[device.kind] || FaQuestionCircle;
    const isMe = currentDeviceId && device.id === currentDeviceId;
    const isActive = !!device.isActive;
    const canTransfer = !isActive && typeof onTransfer === 'function';
    const canRemove = !isMe && typeof onRemove === 'function';

    return (
      <DeviceRow
        key={device.id}
        type="button"
        $compact={compact}
        $active={isActive}
        $clickable={canTransfer}
        disabled={!canTransfer}
        onClick={() => handleRowClick(device)}
      >
        <RowIcon $active={isActive} aria-hidden>
          <Icon size={compact ? 16 : 18} />
        </RowIcon>
        <RowText>
          <RowName $active={isActive}>{device.name || 'Устройство'}</RowName>
          <RowSub>
            {isActive ? 'Сейчас играет' : isMe ? 'Это устройство' : 'Нажмите, чтобы передать'}
            {device.lastSeenAt && !isActive
              ? ` • ${formatRelativeSeconds(device.lastSeenAt)}`
              : null}
          </RowSub>
        </RowText>
        <DeviceMenu
          deviceId={device.id}
          onTransfer={onTransfer}
          onRemove={onRemove}
          canTransfer={canTransfer}
          canRemove={canRemove}
        />
      </DeviceRow>
    );
  };

  if (connectionState === 'disabled') {
    return (
      <Wrapper $embedded={embedded}>
        {showTitle ? <PanelTitle>Подключить</PanelTitle> : null}
        <EmptyBlock>
          <EmptyTitle>Синхронизация недоступна</EmptyTitle>
          <EmptyText>Функция отключена в этой сборке.</EmptyText>
        </EmptyBlock>
      </Wrapper>
    );
  }

  return (
    <Wrapper $embedded={embedded}>
      {showTitle ? <PanelTitle>Подключить</PanelTitle> : null}

      {heroDevice ? (
        <HeroCard $active={!!heroDevice.isActive}>
          <HeroTop>
            {(() => {
              const Icon = KIND_ICON[heroDevice.kind] || FaQuestionCircle;
              return (
                <>
                  <HeroIcon $active={!!heroDevice.isActive} aria-hidden>
                    <Icon size={22} />
                  </HeroIcon>
                  <HeroText>
                    <HeroName $active={!!heroDevice.isActive}>
                      {heroDevice.name || 'Устройство'}
                    </HeroName>
                    <HeroSub>{resolveHeroSubtitle(heroDevice, currentDeviceId)}</HeroSub>
                  </HeroText>
                </>
              );
            })()}
          </HeroTop>
          {nowPlaying && (nowPlaying.title || nowPlaying.trackId) && heroDevice.isActive ? (
            <NowPlayingStrip>
              {nowPlaying.cover ? (
                <NowPlayingCover src={nowPlaying.cover} alt="" />
              ) : (
                <NowPlayingCoverPlaceholder />
              )}
              <NowPlayingCopy>
                <NowPlayingTitle>{nowPlaying.title || 'Без названия'}</NowPlayingTitle>
                <NowPlayingArtist>{nowPlaying.artist || '—'}</NowPlayingArtist>
              </NowPlayingCopy>
            </NowPlayingStrip>
          ) : null}
        </HeroCard>
      ) : null}

      {list.length === 0 ? (
        <Section>
          <SectionLabel>
            {allStale
              ? 'Сейчас в сети устройства не найдены'
              : 'В этой сети устройства не найдены'}
          </SectionLabel>
          <EmptyBlock>
            <EmptyText>
              {allStale
                ? 'Откройте Earflow на другом телефоне или компьютере — оно появится здесь.'
                : 'Когда вы войдёте на другом устройстве, оно отобразится в этом списке.'}
            </EmptyText>
            {typeof onReconnect === 'function' && connectionState !== 'connected' ? (
              <SecondaryBtn type="button" onClick={onReconnect}>
                Переподключиться
              </SecondaryBtn>
            ) : null}
          </EmptyBlock>
        </Section>
      ) : null}

      {otherDevices.length === 0 && list.length > 0 ? (
        <Section>
          <SectionLabel>В этой сети других устройств нет</SectionLabel>
        </Section>
      ) : null}

      {otherDevices.length > 0 ? (
        <Section>
          <SectionLabel>Другие устройства</SectionLabel>
          <GroupCard>
            {otherDevices.map((d) => renderDeviceRow(d, { compact: true }))}
          </GroupCard>
        </Section>
      ) : null}

      <FooterNote>
        {embedded
          ? 'Это синхронизация воспроизведения, не входы в аккаунт.'
          : 'Устройства не видны? Откройте Earflow там и обновите список.'}
      </FooterNote>
    </Wrapper>
  );
}

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${(p) => (p.$embedded ? '16px' : '18px')};
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  color: #fff;
  font-family: inherit;
`;

const PanelTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
`;

const HeroCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border-radius: 12px;
  background: #282828;
  border: 1px solid ${(p) => (p.$active ? 'rgba(29, 185, 84, 0.35)' : 'rgba(255, 255, 255, 0.06)')};
`;

const HeroTop = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
`;

const HeroIcon = styled.div`
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(p) => (p.$active ? ACCENT : 'rgba(255, 255, 255, 0.88)')};
`;

const HeroText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`;

const HeroName = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: ${(p) => (p.$active ? ACCENT : '#fff')};
  line-height: 1.25;
`;

const HeroSub = styled.div`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.35;
`;

const NowPlayingStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
`;

const NowPlayingCover = styled.img`
  width: 40px;
  height: 40px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
`;

const NowPlayingCoverPlaceholder = styled.div`
  width: 40px;
  height: 40px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
`;

const NowPlayingCopy = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SectionLabel = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.55);
  line-height: 1.35;
`;

const GroupCard = styled.div`
  border-radius: 12px;
  background: #282828;
  overflow: hidden;
`;

const DeviceRow = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: ${(p) => (p.$compact ? '12px 14px' : '14px 16px')};
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: ${(p) => (p.$clickable ? 'pointer' : 'default')};
  transition: background 0.15s ease;

  & + & {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  &:hover:not(:disabled) {
    background: ${(p) => (p.$clickable ? 'rgba(255, 255, 255, 0.06)' : 'transparent')};
  }

  &:disabled {
    cursor: default;
  }
`;

const RowIcon = styled.div`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${(p) => (p.$active ? ACCENT : 'rgba(255, 255, 255, 0.85)')};
`;

const RowText = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const RowName = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${(p) => (p.$active ? ACCENT : '#fff')};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RowSub = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MenuWrap = styled.div`
  position: relative;
  flex-shrink: 0;
`;

const MenuBtn = styled.button`
  appearance: none;
  border: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }
`;

const MenuPopover = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 210px;
  padding: 6px;
  border-radius: 10px;
  background: #282828;
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
  z-index: 20;
`;

const MenuItem = styled.button`
  appearance: none;
  border: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: transparent;
  color: ${(p) => (p.$danger ? '#ff8a84' : '#fff')};
  font-size: 13px;
  font-family: inherit;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const EmptyBlock = styled.div`
  padding: 18px 16px;
  border-radius: 12px;
  background: #282828;
  text-align: center;
`;

const EmptyTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 6px;
`;

const EmptyText = styled.p`
  margin: 0 auto 12px;
  max-width: 320px;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.55);
`;

const SecondaryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  color: #fff;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 999px;
  cursor: pointer;

  &:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.4);
  }
`;

const FooterNote = styled.p`
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.45;
  color: rgba(255, 255, 255, 0.42);
`;
