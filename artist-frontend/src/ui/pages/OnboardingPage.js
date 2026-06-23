import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';

import Shell from '../layout/Shell';
import Card from '../components/Card';
import Button from '../components/Button';
import Input from '../components/Input';
import TextArea from '../components/TextArea';
import { artistClaimsUsecase } from '../../usecases/artistClaimsUsecase';
import { useAuth } from '../../state/auth/AuthContext';

const safeText = (v) => {
    if (v === null || v === undefined) return '';
    return String(v);
};

function formatStatus(raw) {
    const s = String(raw || '').toLowerCase();
    if (s === 'approved') return 'одобрено';
    if (s === 'rejected') return 'отклонено';
    if (s === 'pending') return 'в ожидании';
    if (s === 'needs_changes') return 'нужны правки';
    return s || '-';
}

export default function OnboardingPage() {
    const nav = useNavigate();
    const { portal, refresh, logout } = useAuth();

    const [q, setQ] = useState('');
    const [note, setNote] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    const [claims, setClaims] = useState([]);

    const [loadingClaims, setLoadingClaims] = useState(true);
    const [submitting, setSubmitting] = useState(false);

    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const [syncingAccess, setSyncingAccess] = useState(false);
    const autoSyncAttemptedRef = useRef(false);

    const isAlreadyArtist = portal?.isArtist === true;

    useEffect(() => {
        if (isAlreadyArtist) {
            nav('/', { replace: true });
        }
    }, [isAlreadyArtist, nav]);

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            setLoadingClaims(true);
            setError('');
            try {
                const res = await artistClaimsUsecase.listMyClaims();
                if (cancelled) return;
                if (!res.ok) {
                    if (res.error.type === 'unauthorized') {
                        setError('Требуется повторный вход');
                        return;
                    }
                    setError('Не удалось загрузить заявки');
                    return;
                }
                setClaims(res.data);
            } finally {
                if (!cancelled) setLoadingClaims(false);
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const query = q.trim();
        if (query.length < 2) {
            setSuggestions([]);
            setLoadingSuggestions(false);
            return undefined;
        }

        let cancelled = false;
        setLoadingSuggestions(true);
        const timer = window.setTimeout(async () => {
            try {
                const res = await artistClaimsUsecase.searchArtists({ q: query });
                if (cancelled) return;
                setSuggestions(res.ok ? res.data.slice(0, 5) : []);
            } finally {
                if (!cancelled) setLoadingSuggestions(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [q]);

    const onSubmit = async (artistName) => {
        const artist = safeText(artistName).trim() || q.trim();
        if (!artist) return;

        setSubmitting(true);
        setInfo('');
        setError('');
        try {
            const res = await artistClaimsUsecase.createClaim({ artist, note });
            if (!res.ok) {
                if (res.error.status === 403 && String(res.error.code || '').startsWith('CSRF_')) {
                    setError('Запрос отклонен защитой CSRF. Обнови страницу и попробуй снова. Если не помогло — выйди и войди заново.');
                    return;
                }
                if (res.error.status === 409 && res.error.code === 'ALREADY_ARTIST') {
                    await refresh();
                    nav('/', { replace: true });
                    return;
                }
                if (res.error.status === 409 && res.error.code === 'ARTIST_NAME_TAKEN') {
                    setError('Имя артиста уже занято. Выбери другое название.');
                    return;
                }
                if (res.error.status === 400 && res.error.code === 'INVALID_ARTIST') {
                    setError('Укажи корректное имя артиста');
                    return;
                }
                if (res.error.status === 400 && res.error.code === 'EVIDENCE_REQUIRED') {
                    setError('Для артиста без треков на площадке нужны доказательства: добавь в комментарий ссылки на соцсети/стриминги/официальный сайт.');
                    return;
                }
                setError('Не удалось отправить заявку');
                return;
            }

            const next = await artistClaimsUsecase.listMyClaims();
            if (next.ok) {
                setClaims(next.data);
            }
            const createdClaim = res.data && typeof res.data === 'object' ? res.data.claim : null;
            const autoReview = res.data && typeof res.data === 'object' ? res.data.autoReview : null;
            const nextStatus = String(createdClaim?.status || '').toLowerCase();
            const autoReason = safeText(autoReview?.reason || createdClaim?.review_reason || createdClaim?.reviewReason);

            if (nextStatus === 'approved') {
                setInfo('Artist approved automatically. Updating access...');
                setNote('');
                await refresh();
                nav('/', { replace: true });
                return;
            }
            if (nextStatus === 'needs_changes') {
                setInfo(autoReason || 'Need more evidence for this artist.');
                return;
            }
            if (nextStatus === 'pending') {
                setInfo(autoReason || 'Sent to manual review.');
                setNote('');
                return;
            }

            setInfo('Claim sent.');
            setNote('');
        } finally {
            setSubmitting(false);
        }
    };

    const hasPending = useMemo(() => claims.some((c) => String(c.status).toLowerCase() === 'pending'), [claims]);
    const hasApproved = useMemo(() => claims.some((c) => String(c.status).toLowerCase() === 'approved'), [claims]);

    useEffect(() => {
        if (isAlreadyArtist) return;
        if (!hasApproved) return;
        if (autoSyncAttemptedRef.current) return;

        autoSyncAttemptedRef.current = true;
        setSyncingAccess(true);
        setInfo('Заявка одобрена. Обновляем доступ к кабинету...');
        setError('');

        const run = async () => {
            try {
                await refresh();
                nav('/', { replace: true });
            } finally {
                setSyncingAccess(false);
            }
        };

        void run();
    }, [hasApproved, isAlreadyArtist, nav, refresh]);

    const onEnterDashboard = async () => {
        setSyncingAccess(true);
        setInfo('Обновляем доступ...');
        setError('');
        try {
            await refresh();
            nav('/', { replace: true });
        } finally {
            setSyncingAccess(false);
        }
    };

    return (
        <Shell>
            <Top>
                <Brand>Earflow Artists</Brand>
                <Right>
                    <Button type="button" onClick={logout}>Выйти</Button>
                </Right>
            </Top>

            <Main>
                <Wrap>
                    <Card>
                        <Title>Стать артистом</Title>
                        <Sub>
                            Введи название артиста. Новые непопулярные имена подтверждаются автоматически, популярные и уже активные артисты уходят на ручную проверку.
                        </Sub>
                    </Card>

                    <Card>
                        <Title>Заявка на нового артиста</Title>
                        <Grid>
                            <Field>
                                <Label>Имя артиста</Label>
                                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Например: My Artist" />
                                {loadingSuggestions ? <FieldHint>Checking artist name...</FieldHint> : null}
                                {!loadingSuggestions && suggestions.length > 0 ? (
                                    <SuggestionList>
                                        {suggestions.map((item) => {
                                            const name = safeText(item.name || item.artistName);
                                            const trackCount = Number(item.trackCount || item.track_count || 0) || 0;
                                            if (!name) return null;
                                            return (
                                                <SuggestionButton key={name} type="button" onClick={() => setQ(name)}>
                                                    <span>{name}</span>
                                                    <small>{trackCount} tracks</small>
                                                </SuggestionButton>
                                            );
                                        })}
                                    </SuggestionList>
                                ) : null}
                            </Field>
                            <Field>
                                <Label>Комментарий (опционально)</Label>
                                <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ссылка на соцсети, подтверждение прав, контакты" />
                            </Field>
                        </Grid>

                        <Actions>
                            <Button type="button" $variant="primary" onClick={() => onSubmit('')} disabled={submitting || !q.trim() || hasPending}>Отправить заявку</Button>
                        </Actions>

                        {info ? <InfoText>{info}</InfoText> : null}
                        {error ? <ErrorText>{error}</ErrorText> : null}
                    </Card>

                    <Card>
                        <Title>Мои заявки</Title>
                        {loadingClaims ? <Sub>Загрузка...</Sub> : null}
                        {!loadingClaims && claims.length === 0 ? <Sub>Заявок пока нет</Sub> : null}
                        {!loadingClaims && hasApproved && !isAlreadyArtist ? (
                            <Actions>
                                <Button type="button" $variant="primary" onClick={onEnterDashboard} disabled={syncingAccess}>
                                    Перейти в кабинет
                                </Button>
                            </Actions>
                        ) : null}
                        {!loadingClaims && claims.length > 0 ? (
                            <List>
                                {claims.slice(0, 20).map((c) => (
                                    <ListRow key={String(c.id)}>
                                        <div>
                                            <RowTitle>{safeText(c.artist_name || c.artistName || c.artist_name)}</RowTitle>
                                            <RowMeta>Статус: {formatStatus(c.status)}</RowMeta>
                                            {safeText(c.review_reason || c.reviewReason) ? (
                                                <RowMeta>{safeText(c.review_reason || c.reviewReason)}</RowMeta>
                                            ) : null}
                                        </div>
                                    </ListRow>
                                ))}
                            </List>
                        ) : null}
                    </Card>
                </Wrap>
            </Main>
        </Shell>
    );
}

const Top = styled.div`
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  position: sticky;
  top: 0;
  z-index: 10;
`;

const Brand = styled.div`
  font-weight: 900;
  letter-spacing: 0.4px;
`;

const Right = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
`;

const Main = styled.div`
  padding: 18px;
`;

const Wrap = styled.div`
  width: min(900px, 100%);
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

const Grid = styled.div`
  margin-top: 12px;
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
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

const FieldHint = styled.div`
  color: rgba(255, 255, 255, 0.5);
  font-size: 12px;
`;

const SuggestionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SuggestionButton = styled.button`
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-radius: 10px;
  border: 0;
  background: rgba(255, 255, 255, 0.045);
  color: rgba(255, 255, 255, 0.92);
  padding: 0 10px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;

  small {
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
`;

const List = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ListRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.06);
  border: 0;
`;

const RowTitle = styled.div`
  font-weight: 800;
  font-size: 13px;
`;

const RowMeta = styled.div`
  margin-top: 4px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
`;

const InfoText = styled.div`
  margin-top: 10px;
  color: rgba(160, 230, 180, 0.95);
  font-size: 13px;
  line-height: 1.4;
`;

const ErrorText = styled.div`
  margin-top: 10px;
  color: rgba(255, 255, 255, 0.10);
  font-size: 13px;
  line-height: 1.4;
`;
