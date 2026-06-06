import { useCallback, useMemo, useRef, useState } from 'react';
import apiClient from '../api/client';

const clampString = (value, maxLen) => {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen) : s;
};

const isAllowedLyricsImportFile = (file) => {
  const f = file && typeof file === 'object' ? file : null;
  const name = typeof f?.name === 'string' ? f.name : '';
  const lower = name.toLowerCase();
  return lower.endsWith('.zip') || lower.endsWith('.txt') || lower.endsWith('.lrc');
};

export const useLyricsImport = () => {
  const [state, setState] = useState({
    uploading: false,
    progress: 0,
    error: null,
    report: null,
  });

  const inFlightRef = useRef(null);

  const reset = useCallback(() => {
    if (inFlightRef.current && typeof inFlightRef.current.abort === 'function') {
      try {
        inFlightRef.current.abort();
      } catch {
      }
    }
    inFlightRef.current = null;
    setState({ uploading: false, progress: 0, error: null, report: null });
  }, []);

  const importFile = useCallback(async (file, options = {}) => {
    const f = file && typeof file === 'object' ? file : null;
    if (!f) {
      const e = new Error('FILE_REQUIRED');
      e.userMessage = 'Файл обязателен';
      throw e;
    }

    if (!isAllowedLyricsImportFile(f)) {
      const e = new Error('FILE_TYPE_NOT_ALLOWED');
      e.userMessage = 'Поддерживаются только .txt, .lrc или .zip';
      throw e;
    }

    const maxSize = 10 * 1024 * 1024;
    if (Number.isFinite(Number(f.size)) && Number(f.size) > maxSize) {
      const e = new Error('FILE_TOO_LARGE');
      e.userMessage = 'Файл слишком большой. Максимум 10MB';
      throw e;
    }

    const language = clampString(options.language, 5) || 'ru';
    if (language.length < 2 || language.length > 5) {
      const e = new Error('INVALID_LANGUAGE');
      e.userMessage = 'Недопустимый язык';
      throw e;
    }

    if (inFlightRef.current && typeof inFlightRef.current.abort === 'function') {
      try {
        inFlightRef.current.abort();
      } catch {
      }
      inFlightRef.current = null;
    }

    setState({ uploading: true, progress: 0, error: null, report: null });

    const ctrl = new AbortController();
    inFlightRef.current = ctrl;

    try {
      const report = await apiClient.importLyricsFile(f, {
        language,
        signal: ctrl.signal,
        onProgress: (p) => {
          const v = Number(p);
          if (!Number.isFinite(v)) return;
          setState((prev) => (prev.uploading ? { ...prev, progress: Math.min(100, Math.max(0, v)) } : prev));
        },
      });

      setState({ uploading: false, progress: 100, error: null, report });
      return report;
    } catch (err) {
      const message = err?.userMessage || err?.message || 'Ошибка импорта';
      setState({ uploading: false, progress: 0, error: message, report: null });
      throw err;
    } finally {
      if (inFlightRef.current === ctrl) {
        inFlightRef.current = null;
      }
    }
  }, []);

  const summary = useMemo(() => {
    const r = state.report && typeof state.report === 'object' ? state.report : null;
    const imported = Number(r?.imported);
    const total = Number(r?.total);
    return {
      imported: Number.isFinite(imported) ? imported : null,
      total: Number.isFinite(total) ? total : null,
    };
  }, [state.report]);

  return {
    uploading: state.uploading,
    progress: state.progress,
    error: state.error,
    report: state.report,
    summary,
    reset,
    importFile,
  };
};
