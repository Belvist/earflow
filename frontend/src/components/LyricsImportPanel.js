import React, { useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { motion, AnimatePresence } from 'framer-motion';
import { FaFileUpload, FaTimes, FaCheck, FaExclamationTriangle } from 'react-icons/fa';
import { useLyricsImport } from '../hooks/useLyricsImport';

const Container = styled(motion.div)`
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(24px);
  border-radius: 20px;
  padding: 24px;
  margin-bottom: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
`;

const Title = styled.h3`
  font-size: 18px;
  font-weight: 500;
  text-transform: uppercase;
  margin-bottom: 12px;
  color: white;
  display: flex;
  align-items: center;
  gap: 10px;
`;

const Hint = styled.p`
  color: rgba(255, 255, 255, 0.65);
  font-size: 13px;
  line-height: 1.45;
  margin-bottom: 16px;
`;

const UploadArea = styled(motion.div)`
  border: 2px dashed rgba(255, 255, 255, 0.25);
  border-radius: 16px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.45);
    background: rgba(255, 255, 255, 0.03);
  }

  &.disabled {
    pointer-events: none;
    opacity: 0.75;
  }
`;

const UploadRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const UploadText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
`;

const UploadPrimary = styled.div`
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const UploadSecondary = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
`;

const FileInput = styled.input`
  display: none;
`;

const Actions = styled.div`
  margin-top: 14px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
`;

const Button = styled(motion.button)`
  padding: 12px 14px;
  border-radius: 12px;
  border: none;
  font-weight: 600;
  cursor: pointer;
  text-transform: uppercase;
  font-size: 12px;
`;

const PrimaryButton = styled(Button)`
  background: rgba(255, 255, 255, 0.9);
  color: #000;
`;

const SecondaryButton = styled(Button)`
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  overflow: hidden;
  margin-top: 14px;
`;

const ProgressFill = styled.div`
  height: 100%;
  background: linear-gradient(90deg, rgba(197, 197, 197, 0.9), rgba(255, 255, 255, 0.95));
  width: ${(p) => p.$width}%;
  transition: width 180ms ease;
`;

const Message = styled(motion.div)`
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: 13px;
  line-height: 1.35;
`;

const SuccessMessage = styled(Message)`
  color: #4cd964;
  background: rgba(76, 217, 100, 0.14);
  border: 1px solid rgba(76, 217, 100, 0.22);
`;

const ErrorMessage = styled(Message)`
  color: #ff4458;
  background: rgba(255, 68, 88, 0.14);
  border: 1px solid rgba(255, 68, 88, 0.22);
`;

const ReportBox = styled.div`
  margin-top: 14px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  overflow: hidden;
`;

const ReportHeader = styled.div`
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
`;

const ReportList = styled.div`
  max-height: 320px;
  overflow: auto;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr 120px;
  gap: 10px;
  padding: 10px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
`;

const FileName = styled.div`
  color: rgba(255, 255, 255, 0.9);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Status = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  text-align: right;
`;

const Details = styled.div`
  grid-column: 1 / -1;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  line-height: 1.35;
  word-break: break-word;
`;

const formatStatus = (item) => {
  const st = typeof item?.status === 'string' ? item.status : '';
  if (st === 'imported') return 'imported';
  if (st === 'not_found') return 'not_found';
  if (st === 'conflict') return 'conflict';
  if (st === 'forbidden') return 'forbidden';
  if (st === 'invalid') return 'invalid';
  return st || 'unknown';
};

const buildDetails = (item) => {
  const st = formatStatus(item);
  if (st === 'imported') {
    const sid = item?.songId;
    return sid ? `songId: ${String(sid)}` : '';
  }
  if (st === 'invalid') {
    const reason = typeof item?.reason === 'string' ? item.reason : '';
    return reason ? `reason: ${reason}` : '';
  }
  if (st === 'conflict') {
    const cand = Array.isArray(item?.candidates) ? item.candidates : [];
    if (cand.length === 0) return '';
    return cand.map((c) => `${c.id}: ${c.artist} - ${c.title}`).join(' | ');
  }
  return '';
};

const isAllowedFile = (file) => {
  const name = typeof file?.name === 'string' ? file.name.toLowerCase() : '';
  return name.endsWith('.zip') || name.endsWith('.txt') || name.endsWith('.lrc');
};

const formatBytes = (bytes) => {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const v = b / Math.pow(1024, i);
  return `${Math.round(v * 10) / 10} ${units[i]}`;
};

const LyricsImportPanel = () => {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [language, setLanguage] = useState('ru');

  const {
    uploading,
    progress,
    error,
    report,
    summary,
    reset,
    importFile,
  } = useLyricsImport();

  const reportItems = useMemo(() => {
    const r = report && typeof report === 'object' ? report : null;
    const list = Array.isArray(r?.results) ? r.results : [];
    return list.map((it) => ({
      fileName: typeof it?.fileName === 'string' ? it.fileName : '',
      status: formatStatus(it),
      details: buildDetails(it),
    }));
  }, [report]);

  const onPick = (file) => {
    if (!file) return;
    if (!isAllowedFile(file)) {
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const onChange = (e) => {
    const f = e?.target?.files?.[0];
    if (f) {
      reset();
      onPick(f);
    }
  };

  const clear = () => {
    reset();
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const canUpload = !!selectedFile && !uploading;

  const metaText = selectedFile
    ? `${selectedFile.name} (${formatBytes(selectedFile.size)})`
    : 'Нажмите сюда и выберите .txt/.lrc/.zip';

  return (
    <Container
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Title>
        <FaFileUpload />
        Импорт лирики
      </Title>

      <Hint>
        Поддерживаются файлы .txt/.lrc или .zip. Имена: "songId.txt" или "Artist - Title.txt".
        Импорт идёт только в треки, к которым у тебя есть права.
      </Hint>

      <UploadArea
        className={uploading ? 'disabled' : ''}
        onClick={() => !uploading && fileInputRef.current?.click()}
        whileHover={{ scale: uploading ? 1 : 1.01 }}
        whileTap={{ scale: uploading ? 1 : 0.99 }}
      >
        <UploadRow>
          <UploadText>
            <UploadPrimary>{metaText}</UploadPrimary>
            <UploadSecondary>Лимит: 10MB</UploadSecondary>
          </UploadText>
          <SecondaryButton
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!uploading) clear();
            }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.98 }}
          >
            <FaTimes />
          </SecondaryButton>
        </UploadRow>

        <FileInput
          ref={fileInputRef}
          type="file"
          accept=".txt,.lrc,.zip"
          onChange={onChange}
          disabled={uploading}
        />
      </UploadArea>

      <Actions>
        <SecondaryButton
          type="button"
          onClick={() => {
            if (uploading) return;
            reset();
          }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.98 }}
        >
          Сброс
        </SecondaryButton>

        <input
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          disabled={uploading}
          style={{
            flex: '1 1 140px',
            minWidth: 140,
            padding: '12px 14px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(0,0,0,0.35)',
            color: 'rgba(255,255,255,0.9)',
            outline: 'none',
          }}
        />

        <PrimaryButton
          type="button"
          disabled={!canUpload}
          onClick={() => {
            if (!selectedFile || uploading) return;
            void importFile(selectedFile, { language });
          }}
          style={{ opacity: canUpload ? 1 : 0.5 }}
          whileHover={{ scale: canUpload ? 1.03 : 1 }}
          whileTap={{ scale: canUpload ? 0.98 : 1 }}
        >
          Импортировать
        </PrimaryButton>
      </Actions>

      {uploading && (
        <ProgressBar>
          <ProgressFill $width={Math.round(progress)} />
        </ProgressBar>
      )}

      <AnimatePresence>
        {!!error && !uploading && (
          <ErrorMessage
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <FaExclamationTriangle />
            {error}
          </ErrorMessage>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {report && !uploading && (
          <SuccessMessage
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <FaCheck />
            {summary.imported != null && summary.total != null
              ? `Импортировано: ${summary.imported}/${summary.total}`
              : 'Импорт выполнен'}
          </SuccessMessage>
        )}
      </AnimatePresence>

      {reportItems.length > 0 && (
        <ReportBox>
          <ReportHeader>
            <div>Файл</div>
            <div>Статус</div>
          </ReportHeader>
          <ReportList>
            {reportItems.map((row, idx) => (
              <Row key={`${row.fileName}:${idx}`}>
                <FileName title={row.fileName}>{row.fileName}</FileName>
                <Status>{row.status}</Status>
                {row.details ? <Details>{row.details}</Details> : null}
              </Row>
            ))}
          </ReportList>
        </ReportBox>
      )}
    </Container>
  );
};

export default LyricsImportPanel;
