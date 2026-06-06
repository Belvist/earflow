import React, { useCallback, useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';

import Shell from '../layout/Shell';
import Card from '../components/Card';
import Button from '../components/Button';
import Input from '../components/Input';
import ArtistTopBar from '../components/ArtistTopBar';
import { useAuth } from '../../state/auth/AuthContext';
import { adminClaimsUsecase } from '../../usecases/adminClaimsUsecase';

const safeText = (v) => {
    if (v === null || v === undefined) return '';
    return String(v);
};

const normalizeStatus = (raw) => {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'pending' || s === 'approved' || s === 'rejected' || s === 'needs_changes') return s;
    return 'pending';
};

const formatDateTime = (raw) => {
    const s = safeText(raw).trim();
    if (!s) return '-';
    try {
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return s;
        return d.toLocaleString();
    } catch {
        return s;
    }
};

export default function AdminClaimsPage() {
    const { portal, logout, refresh } = useAuth();

    const isAdmin = portal?.isAdmin === true;

    const [status, setStatus] = useState('pending');
    const [limit, setLimit] = useState('50');

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [reviewingId, setReviewingId] = useState('');
    const [reasonById, setReasonById] = useState({});

    const statusClean = useMemo(() => normalizeStatus(status), [status]);
    const limitClean = useMemo(() => {
        const n = Number(limit);
        if (!Number.isFinite(n) || n <= 0) return 50;
        return Math.max(1, Math.min(200, n));
    }, [limit]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await adminClaimsUsecase.listClaims({ status: statusClean, limit: limitClean, offset: 0 });
            if (!res.ok) {
                if (res.error.status === 403) {
                    setError('Недостаточно прав');
                    return;
                }
                setError('Не удалось загрузить заявки');
                return;
            }
            setItems(res.data);
        } finally {
            setLoading(false);
        }
    }, [limitClean, statusClean]);

    useEffect(() => {
        void load();
    }, [load]);

    const doReview = async ({ id, action }) => {
        const claimId = safeText(id);
        if (!claimId) return;

        setReviewingId(claimId);
        setError('');

        try {
            const reason = safeText(reasonById[claimId]).trim();
            const res = await adminClaimsUsecase.reviewClaim({ id: claimId, action, reason });
            if (!res.ok) {
                if (res.error.status === 403) {
                    setError('Недостаточно прав');
                    return;
                }
                if (res.error.status === 409 && res.error.code === 'ARTIST_ALREADY_HAS_OWNER') {
                    setError('У артиста уже есть владелец. Используй отдельный процесс для выдачи доступа существующему артисту (без смены владельца).');
                    return;
                }
                setError('Не удалось обновить заявку');
                return;
            }
            await load();
            try {
                await refresh();
            } catch {
            }
        } finally {
            setReviewingId('');
        }
    };

    if (!isAdmin) {
        return (
            <Shell>
                <ArtistTopBar portal={portal} onLogout={logout} />
                <Main>
                    <Wrap>
                        <Card>
                            <Title>Доступ ограничен</Title>
                            <Sub>Нужны права администратора.</Sub>
                        </Card>
                    </Wrap>
                </Main>
            </Shell>
        );
    }

    return (
        <Shell>
            <ArtistTopBar portal={portal} onLogout={logout} />
            <Main>
                <Wrap>
                    <Card>
                        <Title>Заявки на привязку артиста</Title>
                        <Controls>
                            <Control>
                                <Label>Статус</Label>
                                <Select value={statusClean} onChange={(e) => setStatus(e.target.value)}>
                                    <option value="pending">pending</option>
                                    <option value="needs_changes">needs_changes</option>
                                    <option value="approved">approved</option>
                                    <option value="rejected">rejected</option>
                                </Select>
                            </Control>
                            <Control>
                                <Label>Лимит</Label>
                                <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" />
                            </Control>
                            <Control>
                                <Label>&nbsp;</Label>
                                <Button type="button" onClick={load} disabled={loading} $variant="primary">Обновить</Button>
                            </Control>
                        </Controls>
                        {error ? <ErrorText>{error}</ErrorText> : null}
                    </Card>

                    {loading ? (
                        <Card><Sub>Загрузка...</Sub></Card>
                    ) : null}

                    {!loading && items.length === 0 ? (
                        <Card><Sub>Заявок нет</Sub></Card>
                    ) : null}

                    {!loading && items.length > 0 ? (
                        <TableCard>
                            <Table>
                                <thead>
                                    <tr>
                                        <Th>ID</Th>
                                        <Th>Артист</Th>
                                        <Th>Пользователь</Th>
                                        <Th>Risk</Th>
                                        <Th>Создано</Th>
                                        <Th>Заметка</Th>
                                        <Th>Действия</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {items.map((c) => {
                                        const id = safeText(c.id);
                                        const artist = safeText(c.artist_name || c.artistName);
                                        const userId = safeText(c.user_id || c.userId);
                                        const username = safeText(c.username);
                                        const note = safeText(c.note);
                                        const reviewReason = safeText(c.review_reason || c.reviewReason);
                                        const artistPopular = c.artist_popular === true || c.artistPopular === true;
                                        const artistVerified = c.artist_is_verified === true || c.artistIsVerified === true;
                                        const artistTrackCount = Number(c.artist_track_count ?? c.artistTrackCount ?? 0) || 0;
                                        const artistTotalPlays = Number(c.artist_total_plays ?? c.artistTotalPlays ?? 0) || 0;
                                        const createdAt = formatDateTime(c.created_at || c.createdAt);
                                        const disabled = reviewingId === id;

                                        return (
                                            <tr key={id || artist + userId}>
                                                <TdMono>{id || '-'}</TdMono>
                                                <Td>
                                                    <RowTitle>{artist || '-'}</RowTitle>
                                                    <RowMeta>artist_id: {safeText(c.artist_id || c.artistId) || '-'}</RowMeta>
                                                    <RowMeta>public_id: {safeText(c.artist_public_id || c.artistPublicId) || '-'}</RowMeta>
                                                </Td>
                                                <Td>
                                                    <RowTitle>{username || `user_id: ${userId || '-'}`}</RowTitle>
                                                    <RowMeta>user_id: {userId || '-'}</RowMeta>
                                                </Td>
                                                <Td>
                                                    <BadgeRow>
                                                        {artistPopular ? <Badge $tone="danger">popular</Badge> : <Badge $tone="ok">not popular</Badge>}
                                                        {artistVerified ? <Badge $tone="warn">verified</Badge> : null}
                                                    </BadgeRow>
                                                    <RowMeta>tracks: {artistTrackCount}</RowMeta>
                                                    <RowMeta>plays: {artistTotalPlays}</RowMeta>
                                                </Td>
                                                <Td>{createdAt}</Td>
                                                <Td>
                                                    {note ? <Note>{note}</Note> : <Muted>-</Muted>}
                                                    {reviewReason ? <RowMeta>{reviewReason}</RowMeta> : null}
                                                    <ReasonInput
                                                        value={safeText(reasonById[id])}
                                                        onChange={(e) => setReasonById((p) => ({ ...p, [id]: e.target.value }))}
                                                        placeholder="Причина (опционально)"
                                                    />
                                                </Td>
                                                <Td>
                                                    <Actions>
                                                        <Button type="button" $variant="primary" disabled={disabled} onClick={() => doReview({ id, action: 'approve' })}>Approve</Button>
                                                        <Button type="button" disabled={disabled} onClick={() => doReview({ id, action: 'needs_changes' })}>Needs changes</Button>
                                                        <Button type="button" disabled={disabled} onClick={() => doReview({ id, action: 'reject' })}>Reject</Button>
                                                    </Actions>
                                                </Td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        </TableCard>
                    ) : null}
                </Wrap>
            </Main>
        </Shell>
    );
}

const Main = styled.div`
  padding: 18px;
`;

const Wrap = styled.div`
  width: min(1100px, 100%);
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Title = styled.h2`
  font-size: 16px;
  font-weight: 900;
  margin-bottom: 8px;
`;

const Sub = styled.div`
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.5;
`;

const Controls = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;

  @media (min-width: 720px) {
    grid-template-columns: 220px 140px 160px;
    align-items: end;
  }
`;

const Control = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const Select = styled.select`
  width: 100%;
  height: 42px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.95);
  padding: 0 12px;
  font-size: 13px;
  outline: none;
`;

const ErrorText = styled.div`
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.10);
  font-size: 13px;
  line-height: 1.4;
`;

const TableCard = styled(Card)`
  padding: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
`;

const Table = styled.table`
  width: 100%;
  min-width: 980px;
  border-collapse: collapse;

  thead th {
    background: rgba(0, 0, 0, 0.85);
  }

  tr {
    border-bottom: 0;
  }

  td, th {
    text-align: left;
    padding: 12px;
    vertical-align: top;
  }
`;

const Th = styled.th`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-weight: 800;
  letter-spacing: 0.4px;
`;

const Td = styled.td`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
`;

const TdMono = styled.td`
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
  padding: 12px;
`;

const RowTitle = styled.div`
  font-weight: 900;
`;

const RowMeta = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const BadgeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.9);
  background: #181818;
  border: 0;
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;

  > button {
    white-space: nowrap;
  }
`;

const Note = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
`;

const Muted = styled.div`
  color: rgba(255, 255, 255, 0.5);
`;

const ReasonInput = styled.input`
  margin-top: 10px;
  width: 100%;
  height: 40px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.95);
  padding: 0 12px;
  font-size: 13px;
  outline: none;
`;
