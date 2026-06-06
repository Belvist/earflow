import React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 28px 16px 36px;
  color: rgba(255, 255, 255, 0.9);

  @media (min-width: 768px) {
    padding: 34px 20px 44px;
  }
`;

const Title = styled.h1`
  font-family: 'Unbounded', sans-serif;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 14px;
`;

const Text = styled.p`
  font-family: 'Unbounded', sans-serif;
  font-size: 14px;
  line-height: 1.65;
  color: rgba(255, 255, 255, 0.78);
  margin: 0 0 12px;
`;

const SectionTitle = styled.h2`
  font-family: 'Unbounded', sans-serif;
  font-size: 16px;
  font-weight: 800;
  margin: 18px 0 10px;
`;

const List = styled.ul`
  margin: 0;
  padding-left: 18px;
  color: rgba(255, 255, 255, 0.78);
  font-family: 'Unbounded', sans-serif;
  font-size: 14px;
  line-height: 1.65;
`;

const defaultContent = {
  title: 'О нас',
  lead: [
    'Earflow — музыкальная платформа, где фокус на удобном прослушивании, персональных рекомендациях и уважении к пользователю.',
    'Мы развиваем сервис как продукт: прозрачные правила, понятная политика данных и постоянное улучшение качества воспроизведения.',
  ],
  sections: [
    {
      title: 'Что мы делаем',
      bullets: [
        'Музыкальный плеер с очередью, избранным и плейлистами.',
        'Персональные подборки и рекомендации.',
        'Инструменты для артистов через портал Artists.',
      ],
    },
    {
      title: 'Контакты',
      paragraphs: [
        'По вопросам сотрудничества и поддержки используйте контакты, указанные в политиках и официальных каналах.',
      ],
    },
  ],
};

function sanitizeContent(raw) {
  if (!raw || typeof raw !== 'object') return defaultContent;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : defaultContent.title;
  const lead = Array.isArray(raw.lead) ? raw.lead.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : defaultContent.lead;
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = sectionsRaw
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const st = typeof s.title === 'string' && s.title.trim() ? s.title.trim() : '';
      const paragraphs = Array.isArray(s.paragraphs)
        ? s.paragraphs.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
        : [];
      const bullets = Array.isArray(s.bullets)
        ? s.bullets.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
        : [];
      return { title: st, paragraphs, bullets };
    })
    .filter((s) => s.title || s.paragraphs.length || s.bullets.length);

  return {
    title,
    lead: lead.length ? lead : defaultContent.lead,
    sections: sections.length ? sections : defaultContent.sections,
  };
}

export default function AboutPage() {
  const [content, setContent] = React.useState(defaultContent);

  React.useEffect(() => {
    let cancelled = false;

    fetch('/content/about.json', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setContent(sanitizeContent(json));
      })
      .catch(() => {
        if (cancelled) return;
        setContent(defaultContent);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Container>
      <Title>{content.title}</Title>
      {(content.lead || []).map((p) => (
        <Text key={p}>{p}</Text>
      ))}

      {(content.sections || []).map((s) => (
        <div key={s.title}>
          {s.title ? <SectionTitle>{s.title}</SectionTitle> : null}
          {(s.paragraphs || []).map((p) => (
            <Text key={p}>{p}</Text>
          ))}
          {Array.isArray(s.bullets) && s.bullets.length ? (
            <List>
              {s.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </List>
          ) : null}
        </div>
      ))}
    </Container>
  );
}
