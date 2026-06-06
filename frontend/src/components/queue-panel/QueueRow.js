import React from 'react';
import { FaPause, FaPlay } from 'react-icons/fa';
import apiClient from '../../api/client';
import {
    Row, IndexCell, Cover, Info, TrackName, ArtistName,
    TrailingCell, PlayingBars,
} from './queuePanel.styles';

const coverUrlFor = (track) => {
    try {
        return apiClient.getCoverUrl(track, false) || '';
    } catch {
        return '';
    }
};

const QueueRow = React.memo(function QueueRow({ track, index, isActive, isPlaying, onClick }) {
    if (!track || typeof track !== 'object') return null;
    const id = track.id;
    if (id == null) return null;

    const title = typeof track.title === 'string' && track.title.trim() ? track.title : 'Без названия';
    const artist = typeof track.artist === 'string' && track.artist.trim() ? track.artist : 'Неизвестный исполнитель';
    const cover = coverUrlFor(track);

    const handleClick = () => {
        if (typeof onClick === 'function') onClick(track);
    };

    const handleKey = (e) => {
        if (!e) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
        }
    };

    return (
        <Row
            type="button"
            $active={!!isActive}
            onClick={handleClick}
            onKeyDown={handleKey}
            aria-current={isActive ? 'true' : undefined}
            aria-label={`${title} — ${artist}`}
            whileTap={{ scale: 0.985 }}
        >
            <IndexCell aria-hidden="true">
                {isActive && isPlaying ? (
                    <PlayingBars aria-hidden="true">
                        <span />
                        <span />
                        <span />
                    </PlayingBars>
                ) : (
                    <span>{index + 1}</span>
                )}
            </IndexCell>

            <Cover>
                {cover
                    ? <img src={cover} alt="" loading="lazy" decoding="async" />
                    : <div aria-hidden="true" />}
            </Cover>

            <Info>
                <TrackName title={title}>{title}</TrackName>
                <ArtistName title={artist}>{artist}</ArtistName>
            </Info>

            <TrailingCell aria-hidden="true">
                {isActive
                    ? (isPlaying ? <FaPause size={12} /> : <FaPlay size={12} />)
                    : <FaPlay size={12} style={{ opacity: 0.55 }} />}
            </TrailingCell>
        </Row>
    );
});

QueueRow.displayName = 'QueueRow';

export default QueueRow;
