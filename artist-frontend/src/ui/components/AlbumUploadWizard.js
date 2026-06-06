import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import Button from './Button';
import Input from './Input';

import { currentYear, isYearValid, parseFilenameMeta, safeText } from '../../usecases/trackFilenameMeta';
import { uploadAlbumTracks } from '../../usecases/albumUploadUsecase';

function normalizeFileList(files) {
  const list = Array.isArray(files) ? files : Array.from(files || []);
  return list
    .filter((f) => f && typeof f === 'object')
    .filter((f) => typeof f.name === 'string' && f.name.trim())
    .slice(0, 50);
}

function initialTrackFromFile(file) {
  const parsed = parseFilenameMeta(file.name);
  return {
    file,
    meta: {
      title: safeText(parsed.title).trim(),
      artist: safeText(parsed.artist).trim(),
      album: '',
      genre: '',
      year: safeText(parsed.year).trim(),
    },
    state: 'queued',
    error: '',
    uploadedId: '',
  };
}

function getTrackStatusLabel(state, uploading) {
  if (state === 'done') return 'Готово';
  if (state === 'error') return 'Ошибка';
  if (uploading) return '...';
  return 'Ожидает';
}

function mergeTrackMeta(base, patch) {
  const b = base && typeof base === 'object' ? base : null;
  const p = patch && typeof patch === 'object' ? patch : null;
  if (!p) return b || {};
  if (!b) return { ...p };
  return { ...b, ...p };
}

function mergeTracksWithFiles(previous, nextFiles) {
  const prevList = Array.isArray(previous) ? previous : [];
  const prevByKey = new Map(prevList.map((t) => [`${t?.file?.name || ''}:${t?.file?.size || 0}`, t]));
  return nextFiles.map((f) => {
    const key = `${f.name}:${f.size}`;
    const existing = prevByKey.get(key);
    return existing || initialTrackFromFile(f);
  });
}

function applyTrackResult(track, result) {
  if (result && result.ok) {
    const id = safeText(result.data?.id).trim();
    return { ...track, state: 'done', error: '', uploadedId: id };
  }
  const msg = getErrorMessage(result?.error);
  return { ...track, state: 'error', error: msg };
}

function getErrorMessage(error) {
  const type = error && typeof error === 'object' ? error.type : '';
  if (type === 'csrf') return 'Ошибка защиты запроса. Обновите страницу и повторите.';
  if (type === 'forbidden') return 'Доступ к кабинету артиста не подтверждён';
  if (type === 'forbidden_generic') return 'Доступ запрещён';
  if (type === 'unauthorized') return 'Требуется повторный вход';
  return 'Не удалось загрузить трек';
}

export default function AlbumUploadWizard({ disabled, onComplete }) {
  const fileInputRef = useRef(null);
  const cancelRef = useRef({ cancelled: false });

  const [step, setStep] = useState(1);

  const [files, setFiles] = useState([]);
  const [tracks, setTracks] = useState([]);

  const [albumTitle, setAlbumTitle] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [albumGenre, setAlbumGenre] = useState('');
  const [albumYear, setAlbumYear] = useState(currentYear());
  const [albumExplicit, setAlbumExplicit] = useState(false);

  const [yearTouched, setYearTouched] = useState(false);

  const [concurrency, setConcurrency] = useState(2);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const total = tracks.length;
  const doneCount = useMemo(() => tracks.filter((t) => t.state === 'done').length, [tracks]);
  const failedCount = useMemo(() => tracks.filter((t) => t.state === 'error').length, [tracks]);

  const canNext1 = files.length > 0;
  const canNext2 = safeText(albumTitle).trim().length > 0;
  const canStart = total > 0 && canNext2;

  const reset = () => {
    cancelRef.current.cancelled = false;
    setStep(1);
    setFiles([]);
    setTracks([]);
    setAlbumTitle('');
    setAlbumArtist('');
    setAlbumGenre('');
    setAlbumYear(currentYear());
    setAlbumExplicit(false);
    setConcurrency(2);
    setUploading(false);
    setError('');
    setYearTouched(false);
  };

  useEffect(() => {
    const list = normalizeFileList(files);
    if (list.length === 0) {
      setTracks([]);
      return;
    }
    setTracks((prev) => mergeTracksWithFiles(prev, list));
  }, [files]);

  const updateTrackMeta = (idx, patch) => {
    setTracks((prev) => prev.map((t, i) => (i === idx ? { ...t, meta: mergeTrackMeta(t.meta, patch) } : t)));
  };

  const removeTrack = (idx) => {
    setTracks((prev) => prev.filter((_, i) => i !== idx));
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const startUpload = async () => {
    if (disabled || uploading) return;

    setError('');
    cancelRef.current.cancelled = false;
    setUploading(true);

    setTracks((prev) => prev.map((t) => ({ ...t, state: 'queued', error: '' })));

    const albumMeta = {
      album: safeText(albumTitle).trim(),
      artist: safeText(albumArtist).trim(),
      genre: safeText(albumGenre).trim(),
      year: safeText(albumYear).trim(),
      explicit: albumExplicit,
    };

    const res = await uploadAlbumTracks({
      tracks,
      albumMeta,
      concurrency,
      isCancelled: () => cancelRef.current.cancelled === true,
      onTrackUpdate: (r, idx) => {
        setTracks((prev) => prev.map((t, i) => (i === idx ? applyTrackResult(t, r) : t)));
      },
    });

    if (!res.ok) {
      setError('Не удалось загрузить альбом');
      setUploading(false);
      return;
    }

    setUploading(false);

    if (cancelRef.current.cancelled) {
      setError('Загрузка отменена');
      return;
    }

    if (res.summary.failed > 0) {
      setError('Часть треков не загрузилась. Исправьте ошибки и повторите загрузку для них.');
      return;
    }

    setError('');
    if (typeof onComplete === 'function') {
      await onComplete();
    }
    reset();
  };

  const cancelUpload = () => {
    cancelRef.current.cancelled = true;
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));
  const goNext = () => setStep((s) => Math.min(3, s + 1));

  return (
    <Wrap>
      <Header>
        <Title>Загрузка альбома</Title>
        <Steps>
          <StepPill $active={step === 1}>1. Файлы</StepPill>
          <StepPill $active={step === 2}>2. Альбом</StepPill>
          <StepPill $active={step === 3}>3. Треки</StepPill>
        </Steps>
      </Header>

      {step === 1 ? (
        <Block>
          <Label>Аудиофайлы</Label>
          <FilePickerRow>
            <HiddenFileInput
              type="file"
              accept="audio/*"
              multiple
              disabled={disabled || uploading}
              onChange={(e) => setFiles(normalizeFileList(e.target.files))}
              ref={fileInputRef}
            />
            <Button
              type="button"
              onClick={() => {
                const el = fileInputRef.current;
                if (!el || disabled || uploading) return;
                el.click();
              }}
              disabled={disabled || uploading}
            >
              Выбрать файлы
            </Button>
            <FileName aria-live="polite">{files.length ? `${files.length} файлов` : 'Файлы не выбраны'}</FileName>
          </FilePickerRow>
          <Hint>Перетащить сюда нельзя — пока только выбор файлов</Hint>
        </Block>
      ) : null}

      {step === 2 ? (
        <Grid>
          <Field>
            <Label>Название альбома *</Label>
            <Input value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} placeholder="Напр. EP / Альбом" />
          </Field>
          <Field>
            <Label>Исполнитель</Label>
            <Input value={albumArtist} onChange={(e) => setAlbumArtist(e.target.value)} placeholder="Если отличается от профиля" />
          </Field>
          <Field>
            <Label>Жанр</Label>
            <Input value={albumGenre} onChange={(e) => setAlbumGenre(e.target.value)} placeholder="Напр. Pop" />
          </Field>
          <Field>
            <Label>Год</Label>
            <Input
              value={albumYear}
              onChange={(e) => {
                setYearTouched(true);
                setAlbumYear(e.target.value);
              }}
              placeholder={currentYear()}
            />
            {yearTouched && !isYearValid(albumYear) ? <FieldError>Год должен быть в формате YYYY</FieldError> : null}
          </Field>
          <ToggleRow>
            <ToggleInput type="checkbox" checked={albumExplicit} onChange={(e) => setAlbumExplicit(e.target.checked)} />
            <ToggleText>Explicit (по умолчанию для треков)</ToggleText>
          </ToggleRow>
        </Grid>
      ) : null}

      {step === 3 ? (
        <Block>
          <Row>
            <SmallLabel>Параллельных загрузок</SmallLabel>
            <Select
              value={String(concurrency)}
              disabled={disabled || uploading}
              onChange={(e) => setConcurrency(Number.parseInt(String(e.target.value || '2'), 10) || 2)}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </Select>
            <Progress>
              {uploading ? `Загрузка: ${doneCount}/${total}` : total ? `Готово: ${doneCount}/${total}` : '—'}
              {failedCount ? `, ошибок: ${failedCount}` : ''}
            </Progress>
          </Row>

          {!tracks.length ? <Hint>Выберите файлы на шаге 1</Hint> : null}

          {tracks.length ? (
            <TracksGrid>
              {tracks.map((t, idx) => (
                <TrackCard key={`${t.file?.name || 'file'}_${idx}`}>
                  <TrackTop>
                    <TrackName title={safeText(t.file?.name)}>{safeText(t.file?.name) || 'audio'}</TrackName>
                    <TrackState $state={t.state}>{getTrackStatusLabel(t.state, uploading)}</TrackState>
                  </TrackTop>

                  <TrackFields>
                    <Field>
                      <SmallLabel>Название *</SmallLabel>
                      <Input
                        value={safeText(t.meta?.title)}
                        onChange={(e) => updateTrackMeta(idx, { title: e.target.value })}
                        disabled={disabled || uploading}
                        placeholder="Название трека"
                      />
                    </Field>
                    <Field>
                      <SmallLabel>Исполнитель</SmallLabel>
                      <Input
                        value={safeText(t.meta?.artist)}
                        onChange={(e) => updateTrackMeta(idx, { artist: e.target.value })}
                        disabled={disabled || uploading}
                        placeholder="Опционально"
                      />
                    </Field>
                  </TrackFields>

                  {t.error ? <TrackError>{t.error}</TrackError> : null}

                  <TrackActions>
                    <Button type="button" onClick={() => removeTrack(idx)} disabled={disabled || uploading}>Удалить</Button>
                  </TrackActions>
                </TrackCard>
              ))}
            </TracksGrid>
          ) : null}
        </Block>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Actions>
        <Button type="button" onClick={reset} disabled={disabled || uploading}>Сбросить</Button>
        <Nav>
          <Button type="button" onClick={goBack} disabled={disabled || uploading || step === 1}>Назад</Button>
          {step < 3 ? (
            <Button type="button" $variant="primary" onClick={goNext} disabled={disabled || uploading || (step === 1 ? !canNext1 : !canNext2)}>
              Далее
            </Button>
          ) : (
            <>
              <Button type="button" onClick={cancelUpload} disabled={!uploading}>Отменить</Button>
              <Button type="button" $variant="primary" onClick={startUpload} disabled={disabled || uploading || !canStart}>
                Загрузить альбом
              </Button>
            </>
          )}
        </Nav>
      </Actions>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Header = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Title = styled.div`
  font-weight: 900;
  font-size: 16px;
`;

const Steps = styled.div`
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
`;

const StepPill = styled.div`
  padding: 6px 10px;
  border-radius: 999px;
  border: 0;
  background: ${(p) => (p.$active ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)')};
  font-size: 12px;
  color: rgba(255, 255, 255, 0.9);
`;

const Grid = styled.div`
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

const SmallLabel = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
`;

const FieldError = styled.div`
  color: rgba(255, 255, 255, 0.10);
  font-size: 12px;
  line-height: 1.4;
`;

const Block = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Hint = styled.div`
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  line-height: 1.4;
`;

const HiddenFileInput = styled.input`
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

const FilePickerRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
`;

const FileName = styled.div`
  flex: 1 1 220px;
  min-width: 220px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.8);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ToggleRow = styled.label`
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-top: 10px;
`;

const ToggleInput = styled.input`
  margin-top: 2px;
`;

const ToggleText = styled.div`
  font-size: 13px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.9);
`;

const Actions = styled.div`
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  align-items: center;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const Nav = styled.div`
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-wrap: wrap;
`;

const ErrorText = styled.div`
  color: rgba(255, 255, 255, 0.10);
  font-size: 13px;
  line-height: 1.4;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const Select = styled.select`
  padding: 8px 10px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.9);
`;

const Progress = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
`;

const TracksGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;

  @media (max-width: 780px) {
    grid-template-columns: 1fr;
  }
`;

const TrackCard = styled.div`
  padding: 12px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const TrackTop = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
`;

const TrackName = styled.div`
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TrackState = styled.div`
  font-size: 12px;
  color: ${(p) => (p.$state === 'done' ? 'rgba(160,255,190,0.95)' : p.$state === 'error' ? 'rgba(255, 255, 255, 0.10)' : 'rgba(255,255,255,0.55)')};
`;

const TrackFields = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
`;

const TrackError = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.10);
  line-height: 1.4;
`;

const TrackActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
`;
