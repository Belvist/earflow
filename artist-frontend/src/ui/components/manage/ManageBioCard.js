import React from 'react';
import styled from 'styled-components';
import { FaSave, FaLock } from 'react-icons/fa';

import Button from '../Button';
import TextArea from '../TextArea';

const BIO_MAX = 1000;

export default function ManageBioCard({
  bio,
  onChange,
  onSave,
  saving,
  dirty,
  mfaEnabled,
  onEnableMfa,
}) {
  const value = typeof bio === 'string' ? bio : '';
  const chars = value.length;
  const overflow = chars > BIO_MAX;

  return (
    <Card>
      <Head>
        <TitleGroup>
          <Eyebrow>Биография</Eyebrow>
          <Title>Расскажи о себе</Title>
          <Sub>
            Короткое описание на публичной странице артиста.
            До {BIO_MAX} символов, без ссылок на внешние площадки.
          </Sub>
        </TitleGroup>
      </Head>

      <EditorWrap>
        <TextArea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Например: продюсер из Санкт-Петербурга. Смешиваю хип-хоп и фонк."
          rows={5}
          maxLength={BIO_MAX + 200}
          aria-invalid={overflow}
        />
        <Meta>
          <CharCount $over={overflow}>
            {chars} / {BIO_MAX}
          </CharCount>
        </Meta>
      </EditorWrap>

      {!mfaEnabled ? (
        <MfaHint>
          <FaLock size={12} aria-hidden="true" />
          <span>
            Для сохранения изменений нужно включить 2FA.
          </span>
          <MfaLink type="button" onClick={onEnableMfa}>Включить</MfaLink>
        </MfaHint>
      ) : null}

      <Bottom>
        <Button
          type="button"
          $variant="primary"
          onClick={onSave}
          disabled={saving || overflow || !dirty || !mfaEnabled}
        >
          <FaSave size={12} style={{ marginRight: 8 }} aria-hidden="true" />
          {saving ? 'Сохраняем…' : dirty ? 'Сохранить биографию' : 'Изменений нет'}
        </Button>
      </Bottom>
    </Card>
  );
}

const Card = styled.section`
  border-radius: 22px;
  border: 0;
  background: #080808;
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;

  @media (max-width: 720px) {
    padding: 18px;
    border-radius: 18px;
  }
`;

const Head = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
`;

const TitleGroup = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Eyebrow = styled.div`
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
`;

const Title = styled.h2`
  font-size: 17px;
  font-weight: 900;
  color: #fff;
  letter-spacing: -0.02em;
  margin: 0;

  @media (max-width: 720px) {
    font-size: 14px;
  }
`;

const Sub = styled.p`
  margin: 0;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  line-height: 1.5;
  max-width: 560px;
`;

const EditorWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Meta = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const CharCount = styled.div`
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${(p) => (p.$over ? 'rgba(255, 140, 140, 0.95)' : 'rgba(255, 255, 255, 0.45)')};
`;

const MfaHint = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 0;
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.78);
  font-size: 11px;

  & > span {
    flex: 1;
    min-width: 0;
  }
`;

const MfaLink = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  color: rgba(255, 230, 170, 1);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  text-underline-offset: 3px;

  &:hover {
    color: #fff;
  }
`;

const Bottom = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
`;
