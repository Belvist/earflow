import React, { useState } from 'react';
import styled from 'styled-components';
import { Link } from 'react-router-dom';

const Brand = styled(Link)`
  display: inline-flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: rgba(255, 255, 255, 0.95);
  font-family: 'Unbounded', sans-serif;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    color: rgba(255, 255, 255, 1);
  }

  &:active {
    opacity: 0.92;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.35);
    outline-offset: 2px;
    border-radius: 10px;
  }
`;

const LogoImg = styled.img`
  height: ${p => (p.$size === 'sm' ? '22px' : p.$size === 'lg' ? '32px' : '28px')};
  width: auto;
  max-width: 160px;
  object-fit: contain;
  display: block;
  user-select: none;
  pointer-events: none;

  @media (max-width: 520px) {
    height: ${p => (p.$size === 'lg' ? '28px' : p.$size === 'sm' ? '20px' : '24px')};
  }
`;

const Text = styled.span`
  font-size: ${p => (p.$size === 'sm' ? '14px' : p.$size === 'lg' ? '20px' : '17px')};

  @media (max-width: 520px) {
    font-size: ${p => (p.$size === 'lg' ? '19px' : p.$size === 'sm' ? '13px' : '16px')};
  }
`;

// Порядок: сначала явные ассеты из public/ — имя `logo0.*` тоже поддерживаем (часто так кладут файл).
// `logo.png` / `logo.svg` — прежние канонические имена. `logo192.svg` — запас (иконка в репо), иначе текст.
const LOGO_VERSION = 'v4';
const LOGO_SOURCES = [
  `/logo0.png?${LOGO_VERSION}`,
  `/logo0.svg?${LOGO_VERSION}`,
  `/logo0.jpg?${LOGO_VERSION}`,
  `/logo0.jpeg?${LOGO_VERSION}`,
  `/logo0.webp?${LOGO_VERSION}`,
  `/logo.png?${LOGO_VERSION}`,
  `/logo.svg?${LOGO_VERSION}`,
  `/logo192.svg?${LOGO_VERSION}`,
];

export default function BrandLink({ size = 'md', className, onClick, title = 'Earflow' }) {
  const [srcIdx, setSrcIdx] = useState(0);
  const src = LOGO_SOURCES[srcIdx] ?? null;

  return (
    <Brand to="/" className={className} onClick={onClick} aria-label="Earflow — на главную" title={title}>
      {src ? (
        <LogoImg
          key={String(srcIdx)}
          src={src}
          alt="Earflow"
          $size={size}
          draggable={false}
          onError={() => setSrcIdx((i) => i + 1)}
        />
      ) : (
        <Text $size={size}>Earflow</Text>
      )}
    </Brand>
  );
}
