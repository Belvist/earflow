import React, { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import Button from './Button';
import TrackActionsMenu from './TrackActionsMenu';
import Input from './Input';
import { coverUrlFromPath } from '../../usecases/publicLinks';

function safeText(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function formatDate(v) {
  const raw = safeText(v).trim();
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString();
}

function formatNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : '—';
}

function statusLabel(track) {
  if (track.is_available) return 'Опубликован';
  return 'Черновик';
}

function statusSubLabel(track) {
  const ebap = safeText(track.ebap_status).trim();
  const hls = safeText(track.hls_status).trim();

  const parts = [];
  if (track.has_ebap === true || ebap) parts.push(`EBAP: ${track.has_ebap === true ? 'готов' : (ebap || 'в работе')}`);
  if (track.has_hls === true || hls) parts.push(`HLS: ${track.has_hls === true ? 'готов' : (hls || 'в работе')}`);
  return parts.length ? parts.join(' · ') : '';
}

export default function TracksTable({ items, onEdit, onPublishToggle, onDelete, onUploadCover, busyId }) {
  const [expandedId, setExpandedId] = useState('');
  const [coverDraft, setCoverDraft] = useState({});
  const fileInputByTrackIdRef = useRef(new Map());
  const [metaDraft, setMetaDraft] = useState(null);

  const rows = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const expandedTrack = useMemo(() => {
    const id = safeText(expandedId);
    if (!id) return null;
    return rows.find((t) => safeText(t.id) === id) || null;
  }, [expandedId, rows]);

  const openRow = (track) => {
    const id = safeText(track?.id);
    if (!id) return;
    setExpandedId((v) => {
      const next = safeText(v) === id ? '' : id;
      if (!next) setMetaDraft(null);
      return next;
    });
    setMetaDraft({
      id,
      title: safeText(track?.title),
      album: safeText(track?.album),
      genre: safeText(track?.genre),
      year: safeText(track?.year),
    });
  };

  const updateMetaDraft = (patch) => {
    setMetaDraft((prev) => {
      const base = prev && typeof prev === 'object' ? prev : null;
      if (!base) return base;
      return { ...base, ...patch };
    });
  };

  const saveMetaDraft = () => {
    if (!expandedTrack || !metaDraft || safeText(metaDraft.id) !== safeText(expandedTrack.id)) return;
    onEdit(expandedTrack.id, {
      title: metaDraft.title,
      album: metaDraft.album,
      genre: metaDraft.genre,
      year: metaDraft.year,
    });
  };

  return (
    <TableWrap>
      <HeadRow>
        <HeadCoverSpacer aria-hidden="true" />
        <Cell>Название</Cell>
        <Cell>Статус</Cell>
        <Cell>Дата</Cell>
        <Cell>Просл.</Cell>
        <Cell>Плейлисты</Cell>
        <Cell>Доход</Cell>
        <Cell $right>Управление</Cell>
      </HeadRow>

      {rows.map((t) => (
        <Row key={t.id}>
          <MainRow>
            <CoverCell>
              {(() => {
                const src = coverUrlFromPath(t.cover_path);
                if (!src) return <CoverThumbEmpty aria-hidden="true" />;
                return <CoverThumbImg src={src} alt="" />;
              })()}
            </CoverCell>
            <Cell>
              <TitleBtn type="button" onClick={() => openRow(t)}>
                {t.title || 'Без названия'}
              </TitleBtn>
              <Sub>{t.artist || '—'}</Sub>
            </Cell>
            <Cell><StatusPill $active={t.is_available}>{statusLabel(t)}</StatusPill></Cell>
            <Cell>{formatDate(t.created_at)}</Cell>
            <Cell>{formatNumber(t.plays)}</Cell>
            <Cell>{formatNumber(t.playlist_adds)}</Cell>
            <Cell>{t.revenue !== undefined && t.revenue !== null ? formatNumber(t.revenue) : '—'}</Cell>
            <Cell $right $noClip>
              <Actions>
                <TrackActionsMenu
                  track={t}
                  busy={busyId === t.id}
                  onEditClick={() => openRow(t)}
                  onPublishToggle={onPublishToggle}
                  onDelete={onDelete}
                />
              </Actions>
            </Cell>
          </MainRow>

          {expandedId === t.id ? (
            <Expanded>
              {statusSubLabel(t) ? <StatusHint>{statusSubLabel(t)}</StatusHint> : null}
              <ExpandedGrid>
                <Field>
                  <Label>Название</Label>
                  <Input
                    value={metaDraft && safeText(metaDraft.id) === safeText(t.id) ? safeText(metaDraft.title) : safeText(t.title)}
                    onChange={(e) => updateMetaDraft({ title: e.target.value })}
                    onBlur={(e) => onEdit(t.id, { title: e.target.value })}
                    placeholder="Название"
                  />
                </Field>
                <Field>
                  <Label>Альбом</Label>
                  <Input
                    value={metaDraft && safeText(metaDraft.id) === safeText(t.id) ? safeText(metaDraft.album) : safeText(t.album)}
                    onChange={(e) => updateMetaDraft({ album: e.target.value })}
                    onBlur={(e) => onEdit(t.id, { album: e.target.value })}
                    placeholder="Альбом"
                  />
                </Field>
                <Field>
                  <Label>Жанр</Label>
                  <Input
                    value={metaDraft && safeText(metaDraft.id) === safeText(t.id) ? safeText(metaDraft.genre) : safeText(t.genre)}
                    onChange={(e) => updateMetaDraft({ genre: e.target.value })}
                    onBlur={(e) => onEdit(t.id, { genre: e.target.value })}
                    placeholder="Жанр"
                  />
                </Field>
                <Field>
                  <Label>Год</Label>
                  <Input
                    value={metaDraft && safeText(metaDraft.id) === safeText(t.id) ? safeText(metaDraft.year) : safeText(t.year)}
                    onChange={(e) => updateMetaDraft({ year: e.target.value })}
                    onBlur={(e) => onEdit(t.id, { year: e.target.value })}
                    placeholder="Год"
                  />
                </Field>
              </ExpandedGrid>

              <ExpandedActions>
                <Button type="button" $variant="primary" $size="sm" onClick={saveMetaDraft} disabled={busyId === t.id}>Сохранить</Button>
                <CoverRow>
                  <CoverPreviewBox>
                    {(() => {
                      const draft = coverDraft && coverDraft[t.id] ? coverDraft[t.id] : null;
                      const src = draft && draft.previewUrl ? draft.previewUrl : coverUrlFromPath(t.cover_path);
                      if (!src) return <CoverEmpty aria-hidden="true" />;
                      return <CoverImg src={src} alt="" />;
                    })()}
                  </CoverPreviewBox>
                  <CoverActions>
                    <HiddenCoverFile
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      ref={(node) => {
                        if (node) fileInputByTrackIdRef.current.set(t.id, node);
                      }}
                      onChange={(e) => {
                        const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
                        setCoverDraft((prev) => {
                          const current = prev && prev[t.id] ? prev[t.id] : null;
                          if (current && current.previewUrl) {
                            try { URL.revokeObjectURL(current.previewUrl); } catch { }
                          }
                          if (!file) {
                            const base = prev && typeof prev === 'object' ? prev : {};
                            const next = { ...base };
                            delete next[t.id];
                            return next;
                          }
                          const url = URL.createObjectURL(file);
                          const base = prev && typeof prev === 'object' ? prev : {};
                          return { ...base, [t.id]: { file, previewUrl: url } };
                        });
                      }}
                    />
                    <Button
                      type="button"
                      $size="sm"
                      onClick={() => {
                        const el = fileInputByTrackIdRef.current.get(t.id);
                        if (!el) return;
                        el.click();
                      }}
                      disabled={busyId === t.id}
                    >
                      Выбрать файл
                    </Button>
                    <CoverFileName aria-live="polite">
                      {(() => {
                        const draft = coverDraft && coverDraft[t.id] ? coverDraft[t.id] : null;
                        const name = draft && draft.file && draft.file.name ? String(draft.file.name) : '';
                        return name || 'Файл не выбран';
                      })()}
                    </CoverFileName>
                    <Button
                      type="button"
                      $size="sm"
                      onClick={() => {
                        const draft = coverDraft && coverDraft[t.id] ? coverDraft[t.id] : null;
                        if (!draft || !draft.file) return;
                        onUploadCover(t.id, draft.file);
                      }}
                      disabled={busyId === t.id || !(coverDraft && coverDraft[t.id] && coverDraft[t.id].file)}
                    >
                      Загрузить обложку
                    </Button>
                  </CoverActions>
                </CoverRow>
              </ExpandedActions>
            </Expanded>
          ) : null}
        </Row>
      ))}
    </TableWrap>
  );
}

const TableWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const GRID_TEMPLATE = '56px minmax(0, 1fr) 120px 110px 80px 100px 70px 120px';

const HeadRow = styled.div`
  display: none;

  @media (min-width: 900px) {
    display: grid;
    grid-template-columns: ${GRID_TEMPLATE};
    gap: 12px;
    padding: 0 12px;
    color: rgba(255, 255, 255, 0.55);
    font-size: 11px;
    letter-spacing: 0.2px;
  }
`;

const HeadCoverSpacer = styled.div`
  width: 100%;
  height: 1px;
`;

const Row = styled.div`
  border: 0;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.03);
`;

const MainRow = styled.div`
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  grid-template-areas:
    'cover title'
    'status status'
    'actions actions';
  column-gap: 12px;
  row-gap: 10px;
  padding: 12px;
  align-items: start;

  > :nth-child(1) { grid-area: cover; }
  > :nth-child(2) { grid-area: title; }
  > :nth-child(3) { grid-area: status; }
  > :nth-child(4) { display: none; }
  > :nth-child(5) { display: none; }
  > :nth-child(6) { display: none; }
  > :nth-child(7) { display: none; }
  > :nth-child(8) { grid-area: actions; justify-self: end; }

  @media (min-width: 900px) {
    display: grid;
    grid-template-columns: ${GRID_TEMPLATE};
    grid-template-areas: none;
    align-items: center;
    gap: 12px;

    > :nth-child(n) { grid-area: auto; display: block; justify-self: auto; }
  }
`;

const CoverCell = styled.div`
  width: 56px;
  height: 70px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
  flex: 0 0 auto;
`;

const CoverThumbImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const CoverThumbEmpty = styled.div`
  width: 100%;
  height: 100%;
`;

const Cell = styled.div`
  min-width: 0;
  text-align: ${(p) => (p.$right ? 'right' : 'left')};
  ${(p) => (p.$noClip
    ? 'overflow: visible;'
    : `
    overflow: hidden;
    text-overflow: ellipsis;
  `)}
`;

const TitleBtn = styled.button`
  background: transparent;
  border: none;
  padding: 0;
  font-weight: 900;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.95);
  cursor: pointer;
  text-align: left;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Sub = styled.div`
  margin-top: 6px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StatusPill = styled.div`
  display: inline-flex;
  padding: 6px 10px;
  border-radius: 999px;
  border: 0;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)')};
  font-size: 11px;
  color: rgba(255, 255, 255, 0.9);
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const Expanded = styled.div`
  border-top: 0;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const StatusHint = styled.div`
  color: rgba(255, 255, 255, 0.65);
  font-size: 12px;
  line-height: 1.4;
`;

const ExpandedGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 680px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const ExpandedActions = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const CoverRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
`;

const CoverPreviewBox = styled.div`
  width: 64px;
  height: 80px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
`;

const CoverImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
`;

const CoverEmpty = styled.div`
  width: 100%;
  height: 100%;
`;

const CoverActions = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
`;

const HiddenCoverFile = styled.input`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;

const CoverFileName = styled.div`
  flex: 1 1 220px;
  min-width: 220px;
  max-width: 360px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.8);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
