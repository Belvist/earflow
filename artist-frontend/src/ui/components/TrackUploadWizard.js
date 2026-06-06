import React, { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';

import Button from './Button';
import Input from './Input';

import { currentYear, isYearValid, parseFilenameMeta, safeText } from '../../usecases/trackFilenameMeta';

export default function TrackUploadWizard({ disabled, onSubmit, error }) {
  const [step, setStep] = useState(1);

  const fileInputRef = useRef(null);

  const [file, setFile] = useState(null);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  const [genre, setGenre] = useState('');
  const [year, setYear] = useState(currentYear());
  const [explicit, setExplicit] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);

  const [yearTouched, setYearTouched] = useState(false);

  const fileName = useMemo(() => (file ? safeText(file.name) : ''), [file]);
  const canNextFrom1 = !!file;
  const canNextFrom2 = safeText(title).trim().length > 0;
  const canNextFrom3 = rightsConfirmed;
  const canNext = useMemo(() => {
    if (step === 1) return canNextFrom1;
    if (step === 2) return canNextFrom2;
    return canNextFrom3;
  }, [canNextFrom1, canNextFrom2, canNextFrom3, step]);

  const reset = () => {
    setStep(1);
    setFile(null);
    setArtist('');
    setTitle('');
    setAlbum('');
    setGenre('');
    setYear(currentYear());
    setExplicit(false);
    setRightsConfirmed(false);
    setYearTouched(false);
  };

  useEffect(() => {
    if (!file) return;
    const parsed = parseFilenameMeta(file.name);
    if (!safeText(title).trim() && parsed.title) {
      setTitle(parsed.title);
    }
    if (!safeText(artist).trim() && parsed.artist) {
      setArtist(parsed.artist);
    }
    if (!yearTouched && parsed.year) {
      setYear(parsed.year);
    }
  }, [artist, file, title, yearTouched]);

  const submit = async () => {
    if (!file) return;
    const payload = {
      artist: safeText(artist).trim(),
      title: safeText(title).trim(),
      album: safeText(album).trim(),
      genre: safeText(genre).trim(),
      year: safeText(year).trim(),
      explicit,
    };
    const ok = await onSubmit({ file, meta: payload, reset });
    if (ok === true) reset();
  };

  const goBack = () => setStep((s) => Math.max(1, s - 1));
  const goNext = () => setStep((s) => Math.min(4, s + 1));
  const nextDisabled = disabled || !canNext;
  const submitDisabled = disabled || !file || !canNextFrom2 || !canNextFrom3;

  return (
    <Wrap>
      <Header>
        <Title>Загрузка трека</Title>
        <Steps>
          <StepPill $active={step === 1}>1. Файл</StepPill>
          <StepPill $active={step === 2}>2. Метаданные</StepPill>
          <StepPill $active={step === 3}>3. Права</StepPill>
          <StepPill $active={step === 4}>4. Предпросмотр</StepPill>
        </Steps>
      </Header>

      {step === 1 ? (
        <Block>
          <Label>Аудиофайл</Label>
          <FilePickerRow>
            <HiddenFileInput
              type="file"
              accept="audio/*"
              disabled={disabled}
              onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
              ref={fileInputRef}
            />
            <Button
              type="button"
              onClick={() => {
                const el = fileInputRef.current;
                if (!el || disabled) return;
                el.click();
              }}
              disabled={disabled}
            >
              Выбрать файл
            </Button>
            <FileName aria-live="polite">{fileName || 'Файл не выбран'}</FileName>
          </FilePickerRow>
          <Hint>Перетащить сюда нельзя — пока только выбор файла</Hint>
          {fileName ? (
            <Hint>
              Подсказка: имя файла можно в формате <HintStrong>Artist - Title (feat. Name) 2025</HintStrong>
            </Hint>
          ) : null}
        </Block>
      ) : null}

      {step === 2 ? (
        <Grid>
          <Field>
            <Label>Название *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название трека" />
          </Field>
          <Field>
            <Label>Исполнитель</Label>
            <Input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Если отличается от профиля" />
          </Field>
          <Field>
            <Label>Альбом</Label>
            <Input value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Опционально" />
          </Field>
          <Field>
            <Label>Жанр</Label>
            <Input value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="Напр. Pop" />
          </Field>
          <Field>
            <Label>Год</Label>
            <Input
              value={year}
              onChange={(e) => {
                setYearTouched(true);
                setYear(e.target.value);
              }}
              placeholder={currentYear()}
            />
            {yearTouched && !isYearValid(year) ? <FieldError>Год должен быть в формате YYYY</FieldError> : null}
          </Field>
          <ToggleRow>
            <ToggleInput
              type="checkbox"
              checked={explicit}
              onChange={(e) => setExplicit(e.target.checked)}
            />
            <ToggleText>Explicit</ToggleText>
          </ToggleRow>
          <MetaHint>
            Поля без * можно оставить пустыми. Если что-то не уверены — загрузите трек, метаданные можно поправить после.
          </MetaHint>
        </Grid>
      ) : null}

      {step === 3 ? (
        <Block>
          <Label>Права</Label>
          <ToggleRow>
            <ToggleInput
              type="checkbox"
              checked={rightsConfirmed}
              onChange={(e) => setRightsConfirmed(e.target.checked)}
            />
            <ToggleText>Я подтверждаю, что обладаю правами и понимаю ответственность</ToggleText>
          </ToggleRow>
        </Block>
      ) : null}

      {step === 4 ? (
        <Preview>
          <PreviewRow>
            <PreviewLabel>Файл</PreviewLabel>
            <PreviewValue>{fileName || '—'}</PreviewValue>
          </PreviewRow>
          <PreviewRow>
            <PreviewLabel>Исполнитель</PreviewLabel>
            <PreviewValue>{safeText(artist).trim() || '—'}</PreviewValue>
          </PreviewRow>
          <PreviewRow>
            <PreviewLabel>Название</PreviewLabel>
            <PreviewValue>{safeText(title).trim() || '—'}</PreviewValue>
          </PreviewRow>
          <PreviewRow>
            <PreviewLabel>Альбом</PreviewLabel>
            <PreviewValue>{safeText(album).trim() || '—'}</PreviewValue>
          </PreviewRow>
          <PreviewRow>
            <PreviewLabel>Жанр</PreviewLabel>
            <PreviewValue>{safeText(genre).trim() || '—'}</PreviewValue>
          </PreviewRow>
          <PreviewRow>
            <PreviewLabel>Год</PreviewLabel>
            <PreviewValue>{safeText(year).trim() || '—'}</PreviewValue>
          </PreviewRow>
          <PreviewRow>
            <PreviewLabel>Explicit</PreviewLabel>
            <PreviewValue>{explicit ? 'Да' : 'Нет'}</PreviewValue>
          </PreviewRow>
        </Preview>
      ) : null}

      {error ? <ErrorText>{error}</ErrorText> : null}

      <Actions>
        <Button type="button" onClick={reset} disabled={disabled}>Сбросить</Button>
        <Nav>
          <Button type="button" onClick={goBack} disabled={disabled || step === 1}>Назад</Button>
          {step < 4 ? (
            <Button
              type="button"
              $variant="primary"
              onClick={goNext}
              disabled={nextDisabled}
            >
              Далее
            </Button>
          ) : (
            <Button type="button" $variant="primary" onClick={submit} disabled={submitDisabled}>
              Загрузить
            </Button>
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
  font-size: 13px;
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
  font-size: 11px;
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

const FieldError = styled.div`
  color: rgba(255, 255, 255, 0.10);
  font-size: 12px;
  line-height: 1.4;
`;

const MetaHint = styled.div`
  grid-column: 1 / -1;
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  line-height: 1.4;
`;

const Label = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
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
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Hint = styled.div`
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  line-height: 1.4;
`;

const HintStrong = styled.span`
  color: rgba(255, 255, 255, 0.9);
  font-weight: 700;
`;

const Block = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ToggleRow = styled.label`
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding-top: 10px;
`;

const ToggleInput = styled.input`
  margin-top: 2px;
`;

const ToggleText = styled.div`
  font-size: 11px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.9);
`;

const Preview = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 0;
  background: rgba(255, 255, 255, 0.04);
`;

const PreviewRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 12px;
`;

const PreviewLabel = styled.div`
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
`;

const PreviewValue = styled.div`
  font-size: 11px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ErrorText = styled.div`
  color: rgba(255, 255, 255, 0.10);
  font-size: 11px;
  line-height: 1.4;
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
