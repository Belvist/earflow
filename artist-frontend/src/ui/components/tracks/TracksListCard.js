import React, { useMemo, useState } from 'react';
import styled from 'styled-components';
import { FaSearch } from 'react-icons/fa';

import TracksTable from '../TracksTable';
import { safeText } from '../dashboard/formatters';

const SORT_OPTIONS = [
    { value: 'new', label: 'Сначала новые' },
    { value: 'old', label: 'Сначала старые' },
    { value: 'title', label: 'По названию' },
    { value: 'plays', label: 'По прослушиваниям' },
];

const FILTER_OPTIONS = [
    { value: 'all', label: 'Все' },
    { value: 'published', label: 'Опубликованные' },
    { value: 'draft', label: 'Черновики' },
];

function parsePlays(track) {
    const raw = track?.plays ?? track?.play_count ?? track?.playCount ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseCreatedAt(track) {
    const raw = safeText(track?.created_at).trim();
    if (!raw) return 0;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : 0;
}

export default function TracksListCard({
    items,
    loading,
    busyId,
    onEdit,
    onPublishToggle,
    onDelete,
    onUploadCover,
}) {
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState('new');
    const [filter, setFilter] = useState('all');

    const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

    const visible = useMemo(() => {
        const q = safeText(query).trim().toLowerCase();
        const filtered = safeItems.filter((t) => {
            if (filter === 'published' && !t?.is_available) return false;
            if (filter === 'draft' && t?.is_available) return false;
            if (!q) return true;
            const title = safeText(t?.title).toLowerCase();
            const album = safeText(t?.album).toLowerCase();
            const artist = safeText(t?.artist).toLowerCase();
            return title.includes(q) || album.includes(q) || artist.includes(q);
        });

        const sorted = filtered.slice();
        sorted.sort((a, b) => {
            if (sort === 'title') {
                return safeText(a?.title).localeCompare(safeText(b?.title), 'ru');
            }
            if (sort === 'plays') {
                return parsePlays(b) - parsePlays(a);
            }
            const at = parseCreatedAt(a);
            const bt = parseCreatedAt(b);
            return sort === 'old' ? at - bt : bt - at;
        });
        return sorted;
    }, [safeItems, query, sort, filter]);

    const totalCount = safeItems.length;
    const visibleCount = visible.length;
    const isFiltered = query.trim().length > 0 || filter !== 'all';

    return (
        <Card>
            <Head>
                <TitleGroup>
                    <Title>Твои треки</Title>
                    <Sub>
                        {isFiltered
                            ? `Найдено ${visibleCount} из ${totalCount}`
                            : `Всего ${totalCount}`}
                    </Sub>
                </TitleGroup>
                <Controls>
                    <SearchBox>
                        <FaSearch size={12} aria-hidden="true" />
                        <SearchInput
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Поиск по треку, альбому, артисту"
                            aria-label="Поиск по трекам"
                        />
                    </SearchBox>
                    <Select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        aria-label="Фильтр по статусу"
                    >
                        {FILTER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </Select>
                    <Select
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                        aria-label="Сортировка"
                    >
                        {SORT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </Select>
                </Controls>
            </Head>

            {loading ? (
                <Placeholder>Загрузка каталога…</Placeholder>
            ) : totalCount === 0 ? (
                <Placeholder>
                    Пока нет треков. Загрузите первый — он появится здесь.
                </Placeholder>
            ) : visible.length === 0 ? (
                <Placeholder>
                    Ничего не найдено. Попробуйте изменить запрос или фильтр.
                </Placeholder>
            ) : (
                <TableSlot>
                    <TracksTable
                        items={visible}
                        busyId={busyId}
                        onEdit={onEdit}
                        onPublishToggle={onPublishToggle}
                        onDelete={onDelete}
                        onUploadCover={onUploadCover}
                    />
                </TableSlot>
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
  gap: 18px;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 18px;
    gap: 14px;
  }
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  min-width: 0;
  flex: 0 1 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Title = styled.h2`
  font-size: 14px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.015em;
  margin: 0;
`;

const Sub = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const Controls = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1 1 360px;
  justify-content: flex-end;
`;

const SearchBox = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 12px;
  border: 0;
  background: rgba(0, 0, 0, 0.4);
  min-width: 220px;
  flex: 1 1 240px;
  color: rgba(255, 255, 255, 0.45);

  &:focus-within {
    border-color: rgba(255, 255, 255, 0.28);
    color: rgba(255, 255, 255, 0.7);
  }
`;

const SearchInput = styled.input`
  appearance: none;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 11px;
  font-family: inherit;
  flex: 1;
  min-width: 0;
  outline: none;

  &::placeholder {
    color: rgba(255, 255, 255, 0.4);
  }
`;

const Select = styled.select`
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: rgba(0, 0, 0, 0.4);
  color: rgba(255, 255, 255, 0.9);
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  &:focus {
    outline: 2px solid rgba(255, 255, 255, 0.25);
    outline-offset: 2px;
  }

  option {
    background: #0a0a0a;
    color: #fff;
  }
`;

const Placeholder = styled.div`
  padding: 36px 18px;
  border-radius: 16px;
  border: 0;
  background: rgba(255, 255, 255, 0.02);
  text-align: center;
  color: rgba(255, 255, 255, 0.55);
  font-size: 11px;
`;

const TableSlot = styled.div`
  display: flex;
  flex-direction: column;
`;
