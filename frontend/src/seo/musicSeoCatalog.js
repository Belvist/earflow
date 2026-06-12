import catalog from './musicSeoCatalog.json';

const GROUPS = Object.freeze(
  (catalog.groups || []).map((group) => ({
    ...group,
    topics: Object.freeze((group.topics || []).map((topic) => Object.freeze({ ...topic, groupId: group.id, groupLabel: group.label }))),
  }))
);

const INTENTS = Object.freeze((catalog.intents || []).map((intent) => Object.freeze({ ...intent })));
const TOPICS = Object.freeze(GROUPS.flatMap((group) => group.topics));

const TOPICS_BY_SLUG = new Map(TOPICS.map((topic) => [normalizeSlug(topic.slug), topic]));
const INTENTS_BY_SLUG = new Map(INTENTS.map((intent) => [normalizeSlug(intent.slug), intent]));

export function getMusicSeoGroups() {
  return GROUPS;
}

export function getMusicSeoTopics() {
  return TOPICS;
}

export function getMusicSeoIntents() {
  return INTENTS;
}

export function getMusicTopicBySlug(slug) {
  return TOPICS_BY_SLUG.get(normalizeSlug(slug)) || null;
}

export function getMusicIntentBySlug(slug) {
  return INTENTS_BY_SLUG.get(normalizeSlug(slug)) || null;
}

export function buildMusicSeoPath(topicOrSlug, intentOrSlug = null) {
  const topicSlug = typeof topicOrSlug === 'string' ? topicOrSlug : topicOrSlug?.slug;
  const normalizedTopic = normalizeSlug(topicSlug);
  if (!normalizedTopic) return '/music';

  const intentSlug = typeof intentOrSlug === 'string' ? intentOrSlug : intentOrSlug?.slug;
  const normalizedIntent = normalizeSlug(intentSlug);
  return normalizedIntent ? `/music/${normalizedTopic}/${normalizedIntent}` : `/music/${normalizedTopic}`;
}

export function buildMusicSeoMeta({ topicSlug = '', intentSlug = '' } = {}) {
  const topic = getMusicTopicBySlug(topicSlug);
  const intent = getMusicIntentBySlug(intentSlug);
  const hasTopicParam = Boolean(normalizeSlug(topicSlug));
  const hasIntentParam = Boolean(normalizeSlug(intentSlug));

  if (!hasTopicParam) {
    return {
      title: 'Музыка онлайн — жанры, настроения и подборки Earflow',
      description: 'Большая карта музыкальных направлений Earflow: жанры, настроения, сценарии, плейлисты, новинки и поиск треков.',
      canonicalPath: '/music',
      robots: 'index,follow',
    };
  }

  if (!topic || (hasIntentParam && !intent)) {
    return {
      title: 'Музыка не найдена — Earflow',
      description: 'Такой музыкальной страницы пока нет в каталоге Earflow.',
      canonicalPath: '/music',
      robots: 'noindex,nofollow',
      invalid: true,
    };
  }

  if (!intent) {
    const topicTitle = titleCase(topic.name);
    return {
      title: `${topicTitle}: музыка онлайн, плейлисты и рекомендации — Earflow`,
      description: `Слушайте ${topic.name} в Earflow: ${topic.lead}. Открывайте треки, артистов, альбомы и плейлисты.`,
      canonicalPath: buildMusicSeoPath(topic),
      robots: 'index,follow',
      topic,
    };
  }

  const topicTitle = titleCase(topic.name);
  return {
    title: fillIntentTemplate(intent.title, topic, topicTitle),
    description: fillIntentTemplate(intent.description, topic, topicTitle),
    canonicalPath: buildMusicSeoPath(topic, intent),
    robots: 'index,follow',
    topic,
    intent,
  };
}

export function buildMusicSeoJsonLd({ origin = 'https://earflow.ru', topicSlug = '', intentSlug = '' } = {}) {
  const meta = buildMusicSeoMeta({ topicSlug, intentSlug });
  if (meta.invalid) return null;

  const url = `${origin}${meta.canonicalPath}`;
  const breadcrumbs = [
    { name: 'Earflow', item: `${origin}/` },
    { name: 'Музыка', item: `${origin}/music` },
  ];
  if (meta.topic) breadcrumbs.push({ name: titleCase(meta.topic.name), item: `${origin}${buildMusicSeoPath(meta.topic)}` });
  if (meta.intent) breadcrumbs.push({ name: meta.intent.label, item: url });

  const relatedItems = resolveRelatedLinks(meta).slice(0, 12).map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    url: `${origin}${item.path}`,
  }));

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': meta.topic ? 'CollectionPage' : 'WebPage',
        '@id': `${url}#webpage`,
        url,
        name: meta.title.replace(/\s+—\s+Earflow$/, ''),
        description: meta.description,
        isPartOf: {
          '@type': 'WebSite',
          '@id': `${origin}/#website`,
          name: 'Earflow',
          url: origin,
          potentialAction: {
            '@type': 'SearchAction',
            target: `${origin}/search?q={search_term_string}`,
            'query-input': 'required name=search_term_string',
          },
        },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${url}#breadcrumbs`,
        itemListElement: breadcrumbs.map((crumb, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: crumb.name,
          item: crumb.item,
        })),
      },
      {
        '@type': 'ItemList',
        '@id': `${url}#related-music-pages`,
        name: 'Связанные музыкальные страницы Earflow',
        itemListElement: relatedItems,
      },
    ],
  };
}

export function getMusicSeoSitemapEntries() {
  const entries = [{ path: '/music', priority: '0.90', changefreq: 'weekly' }];

  for (const topic of TOPICS) {
    entries.push({ path: buildMusicSeoPath(topic), priority: '0.82', changefreq: 'weekly' });
    for (const intent of INTENTS) {
      entries.push({ path: buildMusicSeoPath(topic, intent), priority: '0.74', changefreq: 'weekly' });
    }
  }

  return entries;
}

export function resolveRelatedLinks(meta) {
  if (!meta || meta.invalid) return [];
  if (!meta.topic) {
    return TOPICS.slice(0, 18).map((topic) => ({
      name: titleCase(topic.name),
      path: buildMusicSeoPath(topic),
    }));
  }

  const links = INTENTS.map((intent) => ({
    name: `${titleCase(meta.topic.name)}: ${intent.label.toLowerCase()}`,
    path: buildMusicSeoPath(meta.topic, intent),
  }));

  const sameGroup = TOPICS
    .filter((topic) => topic.groupId === meta.topic.groupId && topic.slug !== meta.topic.slug)
    .slice(0, 8)
    .map((topic) => ({ name: titleCase(topic.name), path: buildMusicSeoPath(topic) }));

  return [...links, ...sameGroup];
}

function fillIntentTemplate(template, topic, topicTitle) {
  return String(template || '')
    .replace(/\{TopicTitle\}/g, topicTitle)
    .replace(/\{topic\}/g, topic.name);
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
}

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.slice(0, 1).toLocaleUpperCase('ru-RU')}${text.slice(1)}`;
}
