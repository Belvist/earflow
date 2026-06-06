import React from 'react';
import styled, { keyframes } from 'styled-components';
import { FaWifi } from 'react-icons/fa';
import { asIcon } from '../utils/tsxIcons';
import { useOnlineStatus } from './useOnlineStatus';

const WifiIcon = asIcon(FaWifi);

const slideIn = keyframes`
  from { transform: translateY(-100%); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
`;

const Banner = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 8px 14px;
    background: rgba(239, 68, 68, 0.96);
    color: #fff;
    font-size: 13px;
    font-family: 'Unbounded', sans-serif;
    font-weight: 500;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
    animation: ${slideIn} 0.2s ease-out;

    svg {
        flex-shrink: 0;
        font-size: 14px;
        opacity: 0.8;
    }
`;

/**
 * Глобальный баннер «офлайн-режим» — показывается только когда navigator.onLine === false.
 * Не закрывается пользователем: пропадает автоматически при восстановлении сети.
 */
const OfflineBanner: React.FC = () => {
    const online = useOnlineStatus();
    if (online) return null;
    return (
        <Banner role="status" aria-live="polite">
            <WifiIcon style={{ textDecoration: 'line-through' }} />
            <span>Офлайн-режим — доступны только скачанные треки</span>
        </Banner>
    );
};

export default OfflineBanner;
