import React, { useCallback, useMemo, useState } from 'react';
import QueueRow from './QueueRow';
import {
    MobileShell, Header, HeaderTitleBlock, NowPlayingEyebrow, NowPlayingTitle,
    CloseIconButton, Tabs, Tab, MetaLine, ScrollArea, List, Empty,
    FooterBar, FooterButton,
} from './queuePanel.styles';

const TAB_UP_NEXT = 'queue';
const TAB_RECENT = 'recent';

function resolveCurrentIndex(list, currentTrackId) {
    if (!Array.isArray(list) || list.length === 0) return -1;
    if (currentTrackId == null) return -1;
    const needle = String(currentTrackId);
    for (let i = 0; i < list.length; i += 1) {
        const item = list[i];
        if (item && item.id != null && String(item.id) === needle) return i;
    }
    return -1;
}

/**
 * Queue panel body — renders header, tabs ("В очереди" / "Недавно"),
 * and a vertical list with the active track highlighted.
 *
 * This component is layout-agnostic: desktop wraps it in PanelShell,
 * mobile wraps it in a BottomSheet. Both pass identical props.
 */
export default function QueuePanel({
    nowPlayingLabel = 'Сейчас играет',
    queueTitle = 'Очередь',
    queueTracks = [],
    recentTracks = [],
    currentTrackId = null,
    isPlaying = false,
    onSelectTrack,
    onClearRecent,
    onClose,
    initialTab = TAB_UP_NEXT,
    showCloseButton = true,
}) {
    const [tab, setTab] = useState(initialTab === TAB_RECENT ? TAB_RECENT : TAB_UP_NEXT);

    const safeQueue = useMemo(
        () => (Array.isArray(queueTracks) ? queueTracks.filter((t) => t && t.id != null) : []),
        [queueTracks]
    );
    const safeRecent = useMemo(
        () => (Array.isArray(recentTracks) ? recentTracks.filter((t) => t && t.id != null) : []),
        [recentTracks]
    );

    const currentIdx = useMemo(
        () => resolveCurrentIndex(safeQueue, currentTrackId),
        [safeQueue, currentTrackId]
    );

    const upNextSlice = useMemo(() => {
        if (safeQueue.length === 0) return [];
        if (currentIdx < 0) return safeQueue.slice(0, 20);
        return safeQueue.slice(currentIdx, currentIdx + 20);
    }, [safeQueue, currentIdx]);

    const headingText = tab === TAB_RECENT
        ? 'Недавно прослушанные'
        : (queueTitle || 'Очередь');

    const metaText = tab === TAB_RECENT
        ? `${safeRecent.length} ${pluralizeTrackCount(safeRecent.length)}`
        : (upNextSlice.length > 0
            ? `Далее: ${upNextSlice.length} ${pluralizeTrackCount(upNextSlice.length)}`
            : 'Очередь пуста');

    const activeList = tab === TAB_RECENT ? safeRecent : upNextSlice;

    const handleSelect = useCallback((track) => {
        if (typeof onSelectTrack === 'function') onSelectTrack(track);
    }, [onSelectTrack]);

    return (
        <MobileShell>
            <Header>
                <HeaderTitleBlock>
                    <NowPlayingEyebrow>{nowPlayingLabel}</NowPlayingEyebrow>
                    <NowPlayingTitle title={headingText}>{headingText}</NowPlayingTitle>
                </HeaderTitleBlock>

                {showCloseButton && typeof onClose === 'function' && (
                    <CloseIconButton
                        type="button"
                        aria-label="Закрыть панель очереди"
                        onClick={onClose}
                    >
                        ×
                    </CloseIconButton>
                )}
            </Header>

            <Tabs role="tablist" aria-label="Переключить очередь и историю">
                <Tab
                    type="button"
                    role="tab"
                    id="queue-tab-upnext"
                    aria-selected={tab === TAB_UP_NEXT}
                    aria-controls="queue-tab-upnext-panel"
                    tabIndex={tab === TAB_UP_NEXT ? 0 : -1}
                    $active={tab === TAB_UP_NEXT}
                    onClick={() => setTab(TAB_UP_NEXT)}
                >
                    В очереди
                </Tab>
                <Tab
                    type="button"
                    role="tab"
                    id="queue-tab-recent"
                    aria-selected={tab === TAB_RECENT}
                    aria-controls="queue-tab-recent-panel"
                    tabIndex={tab === TAB_RECENT ? 0 : -1}
                    $active={tab === TAB_RECENT}
                    onClick={() => setTab(TAB_RECENT)}
                >
                    Недавно
                </Tab>
            </Tabs>

            <MetaLine aria-live="polite">{metaText}</MetaLine>

            <ScrollArea
                data-queue-scrollarea
                role="tabpanel"
                id={tab === TAB_RECENT ? 'queue-tab-recent-panel' : 'queue-tab-upnext-panel'}
                aria-labelledby={tab === TAB_RECENT ? 'queue-tab-recent' : 'queue-tab-upnext'}
            >
                {activeList.length === 0 ? (
                    <Empty>
                        {tab === TAB_RECENT
                            ? 'Пока ничего не прослушано'
                            : 'Очередь пуста'}
                    </Empty>
                ) : (
                    <List>
                        {activeList.map((track, idx) => {
                            const isActive = currentTrackId != null
                                && track.id != null
                                && String(track.id) === String(currentTrackId);
                            return (
                                <QueueRow
                                    key={`${tab}:${track.id}:${idx}`}
                                    track={track}
                                    index={idx}
                                    isActive={isActive}
                                    isPlaying={isPlaying && isActive}
                                    onClick={handleSelect}
                                />
                            );
                        })}
                    </List>
                )}
            </ScrollArea>

            {tab === TAB_RECENT && safeRecent.length > 0 && typeof onClearRecent === 'function' && (
                <FooterBar>
                    <FooterButton type="button" onClick={onClearRecent}>
                        Очистить историю
                    </FooterButton>
                </FooterBar>
            )}
        </MobileShell>
    );
}

function pluralizeTrackCount(n) {
    const num = Number(n) || 0;
    const abs = Math.abs(num);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return 'трек';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'трека';
    return 'треков';
}
