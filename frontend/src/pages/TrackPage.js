import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { FaPlay, FaClock, FaCalendar, FaCompactDisc } from 'react-icons/fa';
import apiClient from '../api/client';
import { usePlayer } from '../context/PlayerContext';
import { setPageMeta } from '../utils/seo';
import { parseTrackRouteParam, buildTrackRoutePath } from '../utils/trackRoute';

const Page = styled.div`
  min-height: 0;
  width: 100%;
  background: var(--ef-surface-main, #0d0d0d);
  color: #fff;
  font-family: 'Unbounded', sans-serif;
`;

const Inner = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 16px 40px;
  @media (min-width: 768px) { padding: 44px 24px 56px; }
`;

const Hero = styled.div`
  display: flex; gap: 20px; align-items: flex-end; margin-bottom: 24px;
  @media (max-width: 640px) { flex-direction: column; align-items: flex-start; }
`;

const Cover = styled.img`
  width: 180px; height: 180px; border-radius: 12px; object-fit: cover;
  background: #1a1a1a; box-shadow: 0 12px 40px rgba(0,0,0,0.5);
  @media (max-width: 640px) { width: 140px; height: 140px; }
`;

const Title = styled.h1`
  margin: 0 0 6px; font-size: 22px; line-height: 1.15; font-weight: 900;
  @media (min-width: 768px) { font-size: 32px; }
`;

const Sub = styled.div` color: rgba(255,255,255,0.65); font-size: 14px; margin-bottom: 4px; `;
const ArtistLink = styled(Link)` color: rgba(255,255,255,0.85); text-decoration: none; &:hover { text-decoration: underline; } `;

const Meta = styled.div` display: flex; flex-wrap: wrap; gap: 14px; color: rgba(255,255,255,0.6); font-size: 12.5px; margin-top: 10px; `;
const MetaItem = styled.span` display: inline-flex; gap: 6px; align-items: center; `;

const PlayBtn = styled.button`
  display: inline-flex; align-items: center; gap: 10px;
  margin-top: 16px; padding: 13px 22px; border-radius: 999px;
  background: #fff; color: #000; border: none; cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 700;
  transition: transform 0.12s ease, background 0.15s ease;
  &:hover { background: #eee; } &:active { transform: scale(0.97); }
`;

const Section = styled.section` margin-top: 36px; `;
const SectionTitle = styled.h2` font-size: 16px; font-weight: 800; margin: 0 0 12px; `;
const Center = styled.div` padding: 40px; text-align: center; color: rgba(255,255,255,0.55); `;
const Desc = styled.p` color: rgba(255,255,255,0.7); font-size: 14px; line-height: 1.7; max-width: 720px; `;

function formatDuration(sec) {
  const s = Number(sec) || 0; const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function safeText(v) { return (v ?? '').toString().trim(); }

export default function TrackPage() {
  const { trackId } = useParams();
  const player = usePlayer();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const songRef = useMemo(() => {
    // Публичные маршруты трека (по образцу альбомов /album/{pid}-{slug}):
    // /track/{16-hex public_id}-{slug}. Numeric serial id — только legacy
    // (см. docs/DECISIONS.md 2026-08-13); nginx 301 заворачивает чистые numeric
    // до SPA, но клиент тоже канонизирует на slug-форму после загрузки.
    const parsed = parseTrackRouteParam(trackId);
    if (!parsed) return null;
    return parsed.kind === 'publicId'
      ? { kind: 'publicId', value: parsed.publicId }
      : { kind: 'numeric', value: parsed.id };
  }, [trackId]);

  // Ключевой SEO-момент: не полагаемся на один fetch. CSRF в prerender (без cookie)
  // приводит к 403 → ретрай зацикливается. Делаем 2 попытки с явными логами (в консоли prerender'а).
  useEffect(() => {
    if (!songRef) { setError('Трек не найден'); setLoading(false); return; }
    const ctrl = new AbortController();
    let cancelled = false;
    setLoading(true); setError(null);

    const path = songRef.kind === 'publicId'
      ? `/api/songs/by-public-id/${songRef.value}`
      : `/api/songs/${songRef.value}`;

    const tryFetch = async (attempt) => {
      try {
        const data = await apiClient.request(path, { signal: ctrl.signal });
        if (!cancelled && !ctrl.signal.aborted && data && typeof data === 'object') {
          setSong(data);
          setLoading(false);
          return true;
        }
      } catch (e) {
        if (!cancelled && !ctrl.signal.aborted) {
          const msg = e && e.message ? String(e.message) : 'Ошибка загрузки';
          // 403 в prerender — спам; не ретраим бесконечно
          if (msg.includes('403') && attempt === 0) return false;
          if (attempt === 0) return tryFetch(1);
          setError(msg);
          setLoading(false);
        }
      }
      return false;
    };
    void tryFetch(0);
    return () => { cancelled = true; ctrl.abort(); };
  }, [songRef]);

  const coverUrl = useMemo(() => (song && song.cover_path ? apiClient.getCoverUrl({ cover_path: song.cover_path }) : null), [song]);
  const title = safeText(song && song.title) || 'Трек';
  const artist = safeText(song && song.artist) || 'Исполнитель';
  const artistFirst = artist.split(/[;,]/)[0].trim();
  const album = safeText(song && song.album);
  const duration = song && song.duration ? formatDuration(song.duration) : null;
  const year = song && song.year ? String(song.year) : null;

  // SEO meta + обложка — как только данные загружены (для ботов через prerender)
  const canonicalPath = useMemo(() => buildTrackRoutePath(song) || null, [song]);
  useEffect(() => {
    if (!song) return;
    const desc = `Слушать «${title}» — ${artist} онлайн на Earflow${album ? `, альбом «${album}»` : ''}${year ? `, ${year}` : ''}.`;
    setPageMeta({
      title: `${title} — ${artist} слушать онлайн | Earflow`,
      description: desc,
      canonicalPath: canonicalPath || undefined,
      ...(coverUrl ? { image: coverUrl } : {}),
    });

    // Канонизируем URL на slug-форму /track/{public_id}-{slug}. Сюда попадают:
    // legacy numeric (через SPA), и чистый {public_id} без slug.
    if (songRef && canonicalPath && String(window.location.pathname) !== canonicalPath) {
      try { navigate(canonicalPath, { replace: true }); } catch { /* noop */ }
    }
  }, [song, title, artist, album, year, coverUrl, songRef, canonicalPath, navigate]);

  const onPlay = () => {
    if (!song) return;
    try { if (player && typeof player.playFromList === 'function') player.playFromList([song], song.id, artist); } catch { /* noop */ }
  };

  if (loading) return <Page><Center>Загрузка…</Center></Page>;
  if (error || !song) return <Page><Center>{error || 'Трек не найден'}</Center></Page>;

  return (
    <Page>
      <Inner>
        <nav aria-label="breadcrumb" style={{ marginBottom: 18 }}>
          <Sub><Link to="/" style={{ color: 'inherit' }}>Earflow</Link> / <Link to="/music" style={{ color: 'inherit' }}>Музыка</Link> / {title}</Sub>
        </nav>
        <Hero>
          {coverUrl ? <Cover src={coverUrl} alt={`${title} — ${artist}`} /> : <Cover as="div" aria-hidden="true" />}
          <div>
            <Title>{title}</Title>
            <Sub><ArtistLink to={`/artist/${encodeURIComponent(artistFirst)}`}>{artist}</ArtistLink></Sub>
            {album && <Sub>Альбом: {album}</Sub>}
            <Meta>
              {duration && <MetaItem><FaClock /> {duration}</MetaItem>}
              {year && <MetaItem><FaCalendar /> {year}</MetaItem>}
              {safeText(song.genre) && <MetaItem><FaCompactDisc /> {safeText(song.genre)}</MetaItem>}
            </Meta>
            <PlayBtn type="button" onClick={onPlay}><FaPlay /> Слушать</PlayBtn>
          </div>
        </Hero>
        <Section>
          <SectionTitle>О треке</SectionTitle>
          <Desc>
            «{title}» — трек исполнителя {artist}{album ? ` из альбома «${album}»` : ''}{year ? `, выпущенный в ${year} году` : ''}.
            Слушайте онлайн в высоком качестве на Earflow — персональной музыкальной платформе с умными рекомендациями.
          </Desc>
        </Section>
      </Inner>
    </Page>
  );
}
