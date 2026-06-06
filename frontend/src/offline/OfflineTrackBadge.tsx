import React from 'react';
import styled from 'styled-components';
import { FaCheckCircle, FaSpinner } from 'react-icons/fa';
import { asIcon } from '../utils/tsxIcons';
import { useOfflineOptional } from './OfflineContext';

const CheckIcon = asIcon(FaCheckCircle);
const SpinnerIcon = asIcon(FaSpinner);

const Badge = styled.span<{ $downloading?: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
    border-radius: 4px;
    background: ${({ $downloading }) => ($downloading ? 'rgba(79, 140, 255, 0.2)' : 'rgba(29, 185, 84, 0.2)')};
    color: ${({ $downloading }) => ($downloading ? '#6fa3ff' : '#1db954')};
    text-transform: uppercase;
    line-height: 1;

    svg {
        font-size: 11px;
    }
`;

const SpinWrap = styled.span`
    display: inline-flex;
    animation: spin 1s linear infinite;
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;

interface OfflineTrackBadgeProps {
    trackId: string | number;
    compact?: boolean;
}

/**
 * Компактный бейдж, отображающий состояние офлайн-загрузки трека.
 * Безопасно работает без OfflineProvider (рендерит null).
 */
const OfflineTrackBadge: React.FC<OfflineTrackBadgeProps> = ({ trackId, compact }) => {
    const offline = useOfflineOptional();
    if (!offline) return null;

    const idStr = String(trackId || '');
    if (!idStr) return null;

    const isSaved = offline.offlineIds.has(idStr);
    const isActive = offline.active?.trackId === idStr;
    const isQueued = offline.queue.some((q) => String(q.id) === idStr);

    if (isActive) {
        const pct = offline.active && offline.active.total > 0
            ? Math.min(99, Math.floor((offline.active.loaded / offline.active.total) * 100))
            : 0;
        return (
            <Badge $downloading title={`Скачивание: ${pct}%`}>
                <SpinWrap><SpinnerIcon /></SpinWrap>
                {!compact && <span>{pct}%</span>}
            </Badge>
        );
    }

    if (isQueued) {
        return (
            <Badge $downloading title="В очереди на скачивание">
                <SpinWrap><SpinnerIcon /></SpinWrap>
                {!compact && <span>Ожидание</span>}
            </Badge>
        );
    }

    if (isSaved) {
        return (
            <Badge title="Доступно офлайн">
                <CheckIcon />
                {!compact && <span>Офлайн</span>}
            </Badge>
        );
    }

    return null;
};

export default OfflineTrackBadge;
