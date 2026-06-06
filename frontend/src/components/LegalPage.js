import React from 'react';
import styled from 'styled-components';

const Container = styled.div`
  width: 100%;
  max-width: 820px;
  margin: 0 auto;
  padding: 18px 12px 28px;
  color: rgba(255, 255, 255, 0.9);

  @media (min-width: 768px) {
    padding: 34px 20px 44px;
  }
`;

const Title = styled.h1`
  font-family: 'Unbounded', sans-serif;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 6px;

  @media (min-width: 768px) {
    font-size: 26px;
    margin-bottom: 14px;
  }
`;

const Meta = styled.div`
  font-family: 'Unbounded', sans-serif;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 14px;

  @media (min-width: 768px) {
    font-size: 12px;
    margin-bottom: 18px;
  }
`;

const Text = styled.p`
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.78);
  margin: 0 0 10px;

  @media (min-width: 768px) {
    font-size: 14px;
    line-height: 1.65;
    margin: 0 0 12px;
  }
`;

const SectionTitle = styled.h2`
  font-family: 'Unbounded', sans-serif;
  font-size: 13px;
  font-weight: 800;
  margin: 14px 0 8px;

  @media (min-width: 768px) {
    font-size: 16px;
    margin: 18px 0 10px;
  }
`;

const List = styled.ul`
  margin: 0 0 10px;
  padding-left: 16px;
  color: rgba(255, 255, 255, 0.78);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  line-height: 1.6;

  li {
    margin-bottom: 4px;
  }

  @media (min-width: 768px) {
    padding-left: 18px;
    font-size: 14px;
    line-height: 1.65;
  }
`;

const Contact = styled.div`
  margin-top: 20px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.55;

  a {
    color: rgba(255, 255, 255, 0.95);
    text-decoration: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.25);
  }

  @media (min-width: 768px) {
    margin-top: 28px;
    padding: 16px 18px;
    font-size: 14px;
  }
`;

/**
 * Безопасные дефолтные тексты юридических страниц.
 * Используются как fallback, если /content/{slug}.json не загружен или невалиден.
 * Тексты нейтральные, охватывают основные пункты, требуемые ФЗ-152 и аналогами.
 */
const FALLBACKS = {
  privacy: {
    title: 'Политика конфиденциальности',
    updated: '22.04.2026',
    lead: [
      'Настоящая Политика описывает, какие персональные данные Earflow собирает при использовании сервиса, как они обрабатываются, хранятся и защищаются.',
      'Использование сервиса означает ваше согласие с условиями настоящей Политики. Если вы не согласны с условиями — прекратите использование сервиса.',
    ],
    sections: [
      {
        title: '1. Данные, которые мы обрабатываем',
        bullets: [
          'Идентификаторы учётной записи: e-mail, имя пользователя, Telegram ID (при входе через Telegram).',
          'Технические данные: IP-адрес, тип устройства, браузер, идентификаторы сессии, язык.',
          'Поведенческие данные: история прослушиваний, избранное, плейлисты, настройки воспроизведения.',
          'Платёжные данные — только у платёжного провайдера; Earflow хранит лишь статус подписки и последние 4 цифры карты.',
        ],
      },
      {
        title: '2. Цели обработки',
        bullets: [
          'Предоставление и улучшение сервиса (персональные рекомендации, история, плейлисты).',
          'Авторизация и защита аккаунта от несанкционированного доступа.',
          'Исполнение обязательств по подписке и обработке платежей.',
          'Соблюдение требований законодательства РФ и стран, где доступен сервис.',
        ],
      },
      {
        title: '3. Правовые основания',
        paragraphs: [
          'Согласие пользователя (при регистрации), исполнение договора (предоставление сервиса), соблюдение закона и законные интересы оператора (защита от мошенничества).',
        ],
      },
      {
        title: '4. Передача данных третьим лицам',
        bullets: [
          'Платёжные провайдеры (для проведения платежей).',
          'Облачные провайдеры (хостинг, CDN, хранилище объектов).',
          'Telegram (при входе через Telegram Login) — только идентификатор аккаунта.',
          'Правоохранительные органы — по законному запросу.',
        ],
      },
      {
        title: '5. Срок хранения',
        paragraphs: [
          'Данные активных аккаунтов хранятся до удаления аккаунта. После удаления учётной записи идентификаторы и поведенческие данные удаляются в течение 30 дней, за исключением данных, которые требуется сохранять по закону.',
        ],
      },
      {
        title: '6. Права пользователя',
        bullets: [
          'Доступ к своим данным и их копии.',
          'Исправление неточных данных.',
          'Удаление аккаунта и связанных данных.',
          'Отзыв согласия на обработку.',
          'Жалоба в Роскомнадзор.',
        ],
      },
      {
        title: '7. Защита данных',
        paragraphs: [
          'Передача данных защищена TLS. Пароли хранятся в виде хешей (bcrypt/argon2). Доступ к серверной инфраструктуре ограничен, логи аудируются.',
        ],
      },
    ],
    contact: 'По вопросам обработки персональных данных: privacy@earflow.ru',
  },

  cookies: {
    title: 'Политика cookies',
    updated: '22.04.2026',
    lead: [
      'Earflow использует cookies и схожие технологии (localStorage, sessionStorage, IndexedDB) для работы сервиса, обеспечения безопасности и улучшения пользовательского опыта.',
      'Продолжая пользоваться сайтом, вы подтверждаете согласие с использованием cookies в объёме, описанном ниже.',
    ],
    sections: [
      {
        title: 'Что такое cookies',
        paragraphs: [
          'Cookies — это небольшие текстовые файлы, которые сайт сохраняет в вашем браузере. Они позволяют серверу «узнать» ваше устройство при следующих посещениях.',
        ],
      },
      {
        title: 'Категории cookies на Earflow',
        bullets: [
          'Строго необходимые: сессия авторизации, CSRF-токен, выбор качества воспроизведения. Отключить нельзя — сервис без них не работает.',
          'Функциональные: язык, тема оформления, последний плейлист, громкость. Удаляются при выходе из аккаунта.',
          'Аналитические (агрегированные): статистика ошибок и производительности. Не содержат личных идентификаторов.',
          'Платёжные: передаются напрямую провайдеру оплаты, Earflow их не хранит.',
        ],
      },
      {
        title: 'Сторонние cookies',
        paragraphs: [
          'Некоторые функции (Telegram Login, платёжный провайдер, CDN) могут устанавливать свои cookies. Их поведение регулируется политиками соответствующих сервисов.',
        ],
      },
      {
        title: 'Управление cookies',
        bullets: [
          'Настройки браузера: блокировка или удаление cookies в настройках (Chrome, Firefox, Safari, Edge).',
          'Кнопка «Отклонить» в баннере — отключает функциональные и аналитические cookies.',
          'Отключение строго необходимых cookies может привести к неработоспособности авторизации и воспроизведения.',
        ],
      },
      {
        title: 'Срок хранения',
        paragraphs: [
          'Сессионные cookies удаляются при закрытии браузера. Постоянные cookies хранятся от 30 дней до 12 месяцев — в зависимости от категории.',
        ],
      },
    ],
    contact: 'По вопросам cookies: privacy@earflow.ru',
  },

  security: {
    title: 'Политика безопасности',
    updated: '22.04.2026',
    lead: [
      'Мы относимся к безопасности данных пользователей как к приоритету и стремимся следовать индустриальным практикам (OWASP, ISO 27001-ориентиры) в объёме, разумном для продукта.',
    ],
    sections: [
      {
        title: 'Защита передачи данных',
        bullets: [
          'Весь трафик между клиентом и сервером шифруется TLS 1.2+.',
          'HSTS включён для всех основных доменов.',
          'Стойкие cipher-наборы, автоматическое обновление сертификатов.',
        ],
      },
      {
        title: 'Аутентификация и авторизация',
        bullets: [
          'Пароли не хранятся в открытом виде — только криптографический хеш (bcrypt/argon2).',
          'Сессии завязаны на защищённые HTTP-only cookie с SameSite и флагами Secure.',
          'CSRF-защита через токен синхронизации.',
          'Rate-limit для защиты от подбора паролей и брутфорса OTP.',
        ],
      },
      {
        title: 'Серверная инфраструктура',
        bullets: [
          'Изолированные сервисы в контейнерах с минимальными привилегиями.',
          'Секреты в менеджере секретов, не в исходном коде и не в образах.',
          'Резервное копирование баз данных и мониторинг целостности.',
          'Аудит доступа к серверам; логирование и алерты на аномалии.',
        ],
      },
      {
        title: 'Ответственное раскрытие уязвимостей',
        paragraphs: [
          'Если вы обнаружили уязвимость — сообщите нам на security@earflow.ru. Мы ответим в разумный срок и, по возможности, отметим вашу помощь в changelog после устранения.',
          'Пожалуйста, не используйте уязвимость для получения чужих данных и не публикуйте детали до согласованной даты раскрытия.',
        ],
      },
      {
        title: 'Обновления политики',
        paragraphs: [
          'При существенных изменениях политики безопасности мы публикуем уведомление в сервисе и обновляем дату актуализации в заголовке документа.',
        ],
      },
    ],
    contact: 'Сообщения об уязвимостях: security@earflow.ru',
  },
};

function isObject(x) {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function sanitizeStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim());
}

function sanitizeSections(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObject)
    .map((s) => ({
      title: typeof s.title === 'string' && s.title.trim() ? s.title.trim() : '',
      paragraphs: sanitizeStringArray(s.paragraphs),
      bullets: sanitizeStringArray(s.bullets),
    }))
    .filter((s) => s.title || s.paragraphs.length || s.bullets.length);
}

function sanitizeContent(raw, fallback) {
  if (!isObject(raw)) return fallback;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : fallback.title;
  const updated = typeof raw.updated === 'string' && raw.updated.trim() ? raw.updated.trim() : fallback.updated;
  const lead = sanitizeStringArray(raw.lead);
  const sections = sanitizeSections(raw.sections);
  const contact = typeof raw.contact === 'string' && raw.contact.trim() ? raw.contact.trim() : fallback.contact;

  return {
    title,
    updated,
    lead: lead.length ? lead : fallback.lead,
    sections: sections.length ? sections : fallback.sections,
    contact,
  };
}

/**
 * Универсальная юридическая страница. Контент читается из /content/{slug}.json;
 * при ошибке загрузки или невалидной структуре — используется безопасный fallback.
 * @param {{ slug: 'privacy' | 'cookies' | 'security' }} props
 */
export default function LegalPage({ slug }) {
  const fallback = FALLBACKS[slug] || FALLBACKS.privacy;
  const [content, setContent] = React.useState(fallback);

  React.useEffect(() => {
    let cancelled = false;
    setContent(fallback);

    fetch(`/content/${slug}.json`, { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setContent(sanitizeContent(json, fallback));
      })
      .catch(() => {
        if (cancelled) return;
        setContent(fallback);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, fallback]);

  React.useEffect(() => {
    const prev = typeof document !== 'undefined' ? document.title : '';
    if (typeof document !== 'undefined') {
      document.title = `${content.title} — Earflow`;
    }
    return () => {
      if (typeof document !== 'undefined' && prev) document.title = prev;
    };
  }, [content.title]);

  return (
    <Container>
      <Title>{content.title}</Title>
      {content.updated ? <Meta>Актуально на {content.updated}</Meta> : null}

      {(content.lead || []).map((p) => (
        <Text key={p}>{p}</Text>
      ))}

      {(content.sections || []).map((s, idx) => {
        const paragraphs = Array.isArray(s.paragraphs) ? s.paragraphs : [];
        const bullets = Array.isArray(s.bullets) ? s.bullets : [];
        const firstSnippet = (paragraphs[0] || bullets[0] || '').slice(0, 24);
        return (
          <section key={`${idx}-${s.title || ''}-${firstSnippet}`}>
            {s.title ? <SectionTitle>{s.title}</SectionTitle> : null}
            {paragraphs.map((p) => (
              <Text key={p}>{p}</Text>
            ))}
            {bullets.length ? (
              <List>
                {bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </List>
            ) : null}
          </section>
        );
      })}

      {content.contact ? <Contact>{content.contact}</Contact> : null}
    </Container>
  );
}
