export const cleanLyricLine = (raw) => {
  if (!raw) return '';

  let s = String(raw);

  s = s.replace(/^\s*(?:\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]\s*)+/g, '');
  s = s.replace(/^\s*\[(?:ar|ti|al|by|offset|length|re|ve):[^\]]*\]\s*/gi, '');
  s = s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
};

export const isMeaningfulLyricText = (text) => {
  const s = typeof text === 'string' ? text : '';
  if (!s) return false;
  const stripped = s.replace(/[.,!?—–\-\s]/g, '').trim();
  return stripped.length > 0;
};

export const normalizeLyricTextForDisplay = (raw) => {
  const cleaned = cleanLyricLine(raw);
  if (!cleaned) return '';
  return isMeaningfulLyricText(cleaned) ? cleaned : '';
};
