import React, { useEffect } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence as AnimatePresenceRaw } from 'framer-motion';
import { FaTimes, FaTrash, FaHdd } from 'react-icons/fa';
import { asIcon } from '../utils/tsxIcons';
import { useOffline } from './OfflineContext';

const AnimatePresence = AnimatePresenceRaw as unknown as React.FC<{ children?: React.ReactNode }>;

const TimesIcon = asIcon(FaTimes);
const TrashIcon = asIcon(FaTrash);
const HddIcon = asIcon(FaHdd);

const Overlay = styled(motion.div)`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    backdrop-filter: blur(10px);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
`;

const Modal = styled(motion.div)`
    width: 100%;
    max-width: 520px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
`;

const Header = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
`;

const Title = styled.h2`
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    color: #fff;
    font-family: 'Unbounded', sans-serif;
`;

const CloseBtn = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    transition: background 0.15s;

    &:hover {
        background: rgba(255, 255, 255, 0.12);
        color: #fff;
    }
`;

const StatsBar = styled.div`
    padding: 14px 20px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 12px;
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    gap: 10px;

    svg {
        font-size: 14px;
        color: var(--color-primary, #1db954);
    }
`;

const TrackList = styled.div`
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
`;

const TrackRow = styled.div`
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
    border-radius: 8px;
    transition: background 0.12s;

    &:hover {
        background: rgba(255, 255, 255, 0.04);
    }

    & + & {
        border-top: 1px solid rgba(255, 255, 255, 0.04);
    }
`;

const TrackInfo = styled.div`
    flex: 1;
    min-width: 0;
`;

const TrackTitle = styled.div`
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
`;

const TrackMeta = styled.div`
    font-size: 11px;
    color: rgba(255, 255, 255, 0.55);
    margin-top: 2px;
`;

const DeleteBtn = styled.button`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
    cursor: pointer;
    transition: background 0.12s;

    &:hover {
        background: rgba(239, 68, 68, 0.2);
    }
`;

const Footer = styled.div`
    padding: 12px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
`;

const FooterBtn = styled.button<{ $danger?: boolean }>`
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid ${({ $danger }) => ($danger ? 'rgba(239, 68, 68, 0.3)' : 'rgba(255, 255, 255, 0.1)')};
    background: ${({ $danger }) => ($danger ? 'rgba(239, 68, 68, 0.08)' : 'transparent')};
    color: ${({ $danger }) => ($danger ? '#ef4444' : 'rgba(255, 255, 255, 0.8)')};
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: 'Unbounded', sans-serif;
    transition: background 0.12s;

    &:hover {
        background: ${({ $danger }) => ($danger ? 'rgba(239, 68, 68, 0.16)' : 'rgba(255, 255, 255, 0.06)')};
    }
`;

const EmptyState = styled.div`
    padding: 40px 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.45);
    font-size: 13px;
`;

interface OfflineManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 МБ';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(0)} КБ`;
    if (mb < 1024) return `${mb.toFixed(1)} МБ`;
    return `${(mb / 1024).toFixed(2)} ГБ`;
}

function formatDuration(sec: number): string {
    if (!Number.isFinite(sec) || sec <= 0) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

const OfflineManagerModal: React.FC<OfflineManagerModalProps> = ({ isOpen, onClose }) => {
    const offline = useOffline();

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    const handleClearAll = async () => {
        if (!window.confirm('Удалить все скачанные треки? Это действие нельзя отменить.')) return;
        await offline.removeAll();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <Overlay
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <Modal
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Header>
                            <Title>Скачанные треки</Title>
                            <CloseBtn onClick={onClose} aria-label="Закрыть">
                                <TimesIcon />
                            </CloseBtn>
                        </Header>

                        <StatsBar>
                            <HddIcon />
                            <span>
                                {offline.tracks.length} {offline.tracks.length === 1 ? 'трек' : 'треков'}
                                {' · '}
                                {formatBytes(offline.totalBytes)}
                                {offline.quota && offline.quota.quota > 0 && (
                                    <> из {formatBytes(offline.quota.quota)} доступно</>
                                )}
                            </span>
                        </StatsBar>

                        <TrackList>
                            {offline.tracks.length === 0 ? (
                                <EmptyState>
                                    Пока нет скачанных треков.
                                    <br />
                                    Нажмите «Сохранить офлайн» в разделе Любимое.
                                </EmptyState>
                            ) : (
                                offline.tracks.map((t) => (
                                    <TrackRow key={t.id}>
                                        <TrackInfo>
                                            <TrackTitle>{t.title}</TrackTitle>
                                            <TrackMeta>
                                                {t.artist} · {formatDuration(t.durationSec)} · {formatBytes(t.sizeBytes)}
                                            </TrackMeta>
                                        </TrackInfo>
                                        <DeleteBtn
                                            onClick={() => offline.removeTrack(t.id)}
                                            aria-label={`Удалить ${t.title}`}
                                            title="Удалить трек"
                                        >
                                            <TrashIcon />
                                        </DeleteBtn>
                                    </TrackRow>
                                ))
                            )}
                        </TrackList>

                        <Footer>
                            {offline.tracks.length > 0 && (
                                <FooterBtn $danger onClick={handleClearAll}>
                                    Очистить всё
                                </FooterBtn>
                            )}
                            <FooterBtn onClick={onClose}>Закрыть</FooterBtn>
                        </Footer>
                    </Modal>
                </Overlay>
            )}
        </AnimatePresence>
    );
};

export default OfflineManagerModal;
