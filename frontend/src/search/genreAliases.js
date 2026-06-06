const GENRE_QUERY_ALIASES = Object.freeze({
  электроника: ['электроника', 'electronic', 'electronica', 'edm', 'dance', 'house', 'techno'],
  electronic: ['electronic', 'electronica', 'edm', 'dance', 'house', 'techno', 'электроника'],
  edm: ['edm', 'electronic', 'dance', 'house', 'techno', 'электроника'],
  техно: ['техно', 'techno', 'electronic', 'edm'],
  techno: ['techno', 'electronic', 'edm', 'техно'],
  хаус: ['хаус', 'house', 'electronic', 'dance'],
  house: ['house', 'electronic', 'dance', 'хаус'],
  поп: ['поп', 'pop', 'попса', 'dance pop'],
  pop: ['pop', 'поп', 'dance pop'],
  'хип-хоп': ['хип-хоп', 'hip-hop', 'hip hop', 'rap', 'рэп'],
  хипхоп: ['хип-хоп', 'hip-hop', 'hip hop', 'rap', 'рэп'],
  рэп: ['рэп', 'rap', 'hip-hop', 'hip hop', 'хип-хоп'],
  rap: ['rap', 'hip-hop', 'hip hop', 'рэп', 'хип-хоп'],
  рок: ['рок', 'rock', 'alternative rock', 'indie rock'],
  rock: ['rock', 'рок', 'alternative rock', 'indie rock'],
  инди: ['инди', 'indie', 'indie pop', 'indie rock', 'alternative'],
  indie: ['indie', 'инди', 'indie pop', 'indie rock', 'alternative'],
  rnb: ['rnb', 'r&b', 'rhythm and blues', 'рнб'],
  'r&b': ['r&b', 'rnb', 'rhythm and blues', 'рнб'],
  рнб: ['рнб', 'rnb', 'r&b', 'rhythm and blues'],
  джаз: ['джаз', 'jazz', 'soul'],
  jazz: ['jazz', 'джаз', 'soul'],
  фонк: ['фонк', 'phonk', 'drift phonk'],
  phonk: ['phonk', 'drift phonk', 'фонк'],
});

const normalizeAliasKey = (raw) => {
  const value = typeof raw === 'string' ? raw.normalize('NFC').trim().toLowerCase() : '';
  if (!value) return '';
  return value.replace(/[ё]/g, 'е').replace(/[\s_]+/g, '-').replace(/[^a-zа-я0-9&-]+/g, '');
};

export const getGenreQueryVariants = (raw) => {
  const value = typeof raw === 'string' ? raw.normalize('NFC').trim() : '';
  if (!value) return [];

  const key = normalizeAliasKey(value);
  const aliases = GENRE_QUERY_ALIASES[key] || [];
  const seen = new Set();
  const variants = [value, ...aliases];

  return variants.filter((variant) => {
    const normalized = typeof variant === 'string' ? variant.normalize('NFC').trim() : '';
    const identity = normalized.toLowerCase();
    if (!normalized || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
};
