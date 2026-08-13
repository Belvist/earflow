import React, { useMemo } from 'react';
import styled from 'styled-components';
import { Link, useLocation } from 'react-router-dom';
import { FaMusic, FaPlay, FaSearch } from 'react-icons/fa';
import {
  buildMusicSeoJsonLd,
  buildMusicSeoMeta,
  buildMusicSeoPath,
  getMusicSeoGroups,
  getMusicSeoIntents,
  resolveRelatedLinks,
} from '../seo/musicSeoCatalog';
import { getCanonicalOrigin, setPageMeta } from '../utils/seo';

const Page = styled.div`
  min-height: 0;
  width: 100%;
  background: var(--ef-surface-main, #0d0d0d);
  color: #fff;
  font-family: 'Unbounded', sans-serif;
`;

const Hero = styled.section`
  padding: 28px 16px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);

  @media (min-width: 768px) {
    padding: 44px 24px 28px;
  }
`;

const Inner = styled.div`
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
`;

const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.54);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
  margin-bottom: 12px;
`;

const Title = styled.h1`
  margin: 0;
  max-width: 820px;
  font-size: 24px;
  line-height: 1.12;
  font-weight: 900;
  letter-spacing: 0;

  @media (min-width: 768px) {
    font-size: 38px;
  }
`;

const Lead = styled.p`
  max-width: 780px;
  margin: 14px 0 0;
  color: rgba(255, 255, 255, 0.74);
  font-size: 13px;
  line-height: 1.7;

  @media (min-width: 768px) {
    font-size: 15px;
  }
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
`;

const ActionLink = styled(Link)`
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 0 14px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: ${(p) => (p.$primary ? '#fff' : 'rgba(255, 255, 255, 0.07)')};
  color: ${(p) => (p.$primary ? '#000' : 'rgba(255, 255, 255, 0.9)')};
  text-decoration: none;
  font-size: 12px;
  font-weight: 850;

  &:hover {
    background: ${(p) => (p.$primary ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.11)')};
  }
`;

const Section = styled.section`
  padding: 22px 16px;

  @media (min-width: 768px) {
    padding: 30px 24px;
  }
`;

const SectionTitle = styled.h2`
  margin: 0 0 12px;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;

  @media (min-width: 768px) {
    font-size: 18px;
  }
`;

const GroupTitle = styled.h3`
  margin: 22px 0 10px;
  font-size: 12px;
  font-weight: 900;
  color: rgba(255, 255, 255, 0.52);
  letter-spacing: 0;
  text-transform: uppercase;
`;

const TopicGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  @media (min-width: 640px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  @media (min-width: 960px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
`;

const TopicLink = styled(Link)`
  min-height: 48px;
  display: flex;
  align-items: center;
  padding: 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.055);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.9);
  text-decoration: none;
  font-size: 12px;
  font-weight: 760;
  line-height: 1.25;

  &:hover {
    background: rgba(255, 255, 255, 0.09);
    border-color: rgba(255, 255, 255, 0.16);
  }
`;

const IntentGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  @media (min-width: 760px) {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
`;

const AliasRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const AliasChip = styled(Link)`
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.09);
  font-size: 11px;
  font-weight: 700;
  text-decoration: none;
`;

const TextBlock = styled.div`
  max-width: 830px;
  display: grid;
  gap: 10px;
  color: rgba(255, 255, 255, 0.74);
  font-size: 13px;
  line-height: 1.7;

  p {
    margin: 0;
  }
`;

function titleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return `${text.slice(0, 1).toLocaleUpperCase('ru-RU')}${text.slice(1)}`;
}

function searchPath(query) {
  return `/search?q=${encodeURIComponent(query)}`;
}

export default function MusicSeoPage() {
  const location = useLocation();
  const pathParts = useMemo(() => (location.pathname || '').split('/').filter(Boolean), [location.pathname]);
  const topicSlug = pathParts[1] || '';
  const intentSlug = pathParts[2] || '';
  const hasExtraPath = pathParts.length > 3;

  const meta = useMemo(() => {
    if (hasExtraPath) {
      return {
        title: 'Музыка не найдена — Earflow',
        description: 'Такой музыкальной страницы пока нет в каталоге Earflow.',
        canonicalPath: '/music',
        robots: 'noindex,nofollow',
        invalid: true,
      };
    }
    return buildMusicSeoMeta({ topicSlug, intentSlug });
  }, [hasExtraPath, topicSlug, intentSlug]);
  const jsonLd = useMemo(() => {
    if (hasExtraPath) return null;
    const origin = getCanonicalOrigin();
    return buildMusicSeoJsonLd({ origin, topicSlug, intentSlug });
  }, [hasExtraPath, topicSlug, intentSlug]);
  const groups = useMemo(() => getMusicSeoGroups(), []);
  const intents = useMemo(() => getMusicSeoIntents(), []);
  const related = useMemo(() => resolveRelatedLinks(meta), [meta]);

  React.useEffect(() => {
    const origin = getCanonicalOrigin();
    setPageMeta({
      title: meta.title,
      description: meta.description,
      canonicalUrl: `${origin}${meta.canonicalPath}`,
      robots: meta.robots,
      jsonLd,
    });
  }, [jsonLd, meta]);

  if (meta.invalid) {
    return (
      <Page>
        <Hero>
          <Inner>
            <Eyebrow><FaMusic /> Earflow Music</Eyebrow>
            <Title>Такой музыкальной страницы нет в каталоге</Title>
            <Lead>Индексируемые страницы Earflow создаются только из проверенной музыкальной таксономии, чтобы не плодить дубликаты и не путать поиск.</Lead>
            <Actions>
              <ActionLink to="/music" $primary><FaMusic /> Открыть карту музыки</ActionLink>
              <ActionLink to="/search"><FaSearch /> Поиск</ActionLink>
            </Actions>
          </Inner>
        </Hero>
      </Page>
    );
  }

  const topic = meta.topic;
  const intent = meta.intent;
  const heroTitle = meta.title.replace(/\s+—\s+Earflow$/, '');
  const primaryQuery = topic?.aliases?.[0] || topic?.name || 'музыка';

  return (
    <Page>
      <Hero>
        <Inner>
          <Eyebrow><FaMusic /> Earflow Music</Eyebrow>
          <Title>{heroTitle}</Title>
          <Lead>{meta.description}</Lead>
          <Actions>
            <ActionLink to={searchPath(primaryQuery)} $primary><FaSearch /> Найти музыку</ActionLink>
            <ActionLink to="/"><FaPlay /> Слушать Earflow</ActionLink>
            {topic ? <ActionLink to={buildMusicSeoPath(topic)}><FaMusic /> Все страницы темы</ActionLink> : null}
          </Actions>
        </Inner>
      </Hero>

      {topic ? (
        <>
          <Section>
            <Inner>
              <SectionTitle>{titleCase(topic.name)} в Earflow</SectionTitle>
              <TextBlock>
                <p>{titleCase(topic.name)} — это {topic.lead}. На этой странице собраны входы в поиск, плейлисты, популярное, новинки и радио по теме.</p>
                <p>Страница не создаётся случайной заменой слов: она привязана к музыкальной категории, каноническому URL и связанной сетке разделов.</p>
                {intent ? <p>Раздел «{intent.label}» помогает быстро перейти от запроса к прослушиванию, поиску артистов и похожим подборкам.</p> : null}
              </TextBlock>
            </Inner>
          </Section>

          <Section>
            <Inner>
              <SectionTitle>Разделы по теме</SectionTitle>
              <IntentGrid>
                {intents.map((item) => (
                  <TopicLink key={item.slug} to={buildMusicSeoPath(topic, item)}>
                    {item.label}
                  </TopicLink>
                ))}
              </IntentGrid>
            </Inner>
          </Section>

          {Array.isArray(topic.aliases) && topic.aliases.length ? (
            <Section>
              <Inner>
                <SectionTitle>Частые поисковые формулировки</SectionTitle>
                <AliasRow>
                  {topic.aliases.map((alias) => (
                    <AliasChip key={alias} to={searchPath(alias)}><FaSearch size={11} /> {alias}</AliasChip>
                  ))}
                </AliasRow>
              </Inner>
            </Section>
          ) : null}

          {related.length ? (
            <Section>
              <Inner>
                <SectionTitle>Связанные страницы</SectionTitle>
                <TopicGrid>
                  {related.slice(0, 12).map((item) => (
                    <TopicLink key={item.path} to={item.path}>{item.name}</TopicLink>
                  ))}
                </TopicGrid>
              </Inner>
            </Section>
          ) : null}
        </>
      ) : (
        <Section>
          <Inner>
            <SectionTitle>Карта музыкальных страниц</SectionTitle>
            {groups.map((group) => (
              <div key={group.id}>
                <GroupTitle>{group.label}</GroupTitle>
                <TopicGrid>
                  {group.topics.map((item) => (
                    <TopicLink key={item.slug} to={buildMusicSeoPath(item)}>
                      {titleCase(item.name)}
                    </TopicLink>
                  ))}
                </TopicGrid>
              </div>
            ))}
          </Inner>
        </Section>
      )}
    </Page>
  );
}
