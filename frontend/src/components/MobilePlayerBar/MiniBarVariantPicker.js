import React, { useLayoutEffect, useState } from 'react';
import styled from 'styled-components';
import useMiniBarVariant, { MINI_BAR_VARIANT } from '../../hooks/useMiniBarVariant';
import useMiniPlayStyle, { MINI_PLAY_STYLE } from '../../hooks/useMiniPlayStyle';
import MiniPlayButtonIos from './MiniPlayButtonIos';
import MiniPlayButtonAdaptive from './MiniPlayButtonAdaptive';

const Wrap = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
`;

const OptionCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid ${(p) => (p.$active ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.18)')};
  background: rgba(255, 255, 255, 0.03);
`;

const Preview = styled.div`
  height: 54px;
  border-radius: ${(p) => (p.$classic ? '0' : '12px')};
  margin: ${(p) => (p.$classic ? '0 -4px' : '0')};
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: ${(p) => (p.$classic ? '0 10px' : '0 8px')};
  overflow: hidden;
`;

const PreviewCover = styled.div`
  width: ${(p) => (p.$classic ? '22px' : '18px')};
  height: ${(p) => (p.$classic ? '28px' : '22px')};
  border-radius: 4px;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.16);
`;

const PreviewLines = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const PreviewLine = styled.div`
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, ${(p) => (p.$strong ? 0.55 : 0.22)});
  width: ${(p) => p.$w || '100%'};
`;

const PreviewPlay = styled.div`
  width: ${(p) => (p.$classic ? '28px' : '24px')};
  height: ${(p) => (p.$classic ? '28px' : '24px')};
  border-radius: 50%;
  flex-shrink: 0;
  background: ${(p) => (p.$classic ? '#fff' : 'linear-gradient(145deg, #ececec, #bdbdbd, #5c5c5c, #d8d8d8)')};
`;

const PlayPreviewWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
`;

const PlayPreviewSwatch = styled.div`
  height: ${(p) => (p.$compact ? '36px' : '44px')};
  border-radius: 10px;
  background: ${(p) => (p.$light ? 'rgba(255, 255, 255, 0.94)' : 'rgba(255, 255, 255, 0.08)')};
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;

  svg {
    display: block;
    flex-shrink: 0;
  }
`;

const OptionLabel = styled.div`
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
`;

const PickButton = styled.button`
  width: 100%;
  border: 0;
  border-radius: 999px;
  padding: 9px 12px;
  font-size: 12px;
  font-weight: 700;
  font-family: inherit;
  cursor: ${(p) => (p.$active ? 'default' : 'pointer')};
  color: ${(p) => (p.$active ? '#111' : 'rgba(255,255,255,0.92)')};
  background: ${(p) => (p.$active ? '#fff' : 'rgba(255,255,255,0.1)')};

  &:disabled {
    opacity: 1;
  }
`;

const SubSectionTitle = styled.div`
  margin-top: 14px;
  font-size: 12px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.78);
`;

const BuildHint = styled.div`
  margin-top: 10px;
  font-size: 10px;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
`;

const StyleWrap = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
`;

function VariantPreview({ classic }) {
  return (
    <Preview $classic={classic} aria-hidden="true">
      <PreviewCover $classic={classic} />
      <PreviewLines>
        <PreviewLine $strong $w="72%" />
        <PreviewLine $w="52%" />
      </PreviewLines>
      <PreviewPlay $classic={classic} />
    </Preview>
  );
}

function AdaptivePlayPreview() {
  return (
    <PlayPreviewWrap aria-hidden="true">
      <PlayPreviewSwatch>
        <MiniPlayButtonAdaptive isPlaying={false} size={30} iconColor="rgba(255, 255, 255, 0.94)" />
      </PlayPreviewSwatch>
      <PlayPreviewSwatch $light $compact>
        <MiniPlayButtonAdaptive isPlaying={false} size={26} iconColor="rgba(18, 18, 18, 0.92)" />
      </PlayPreviewSwatch>
    </PlayPreviewWrap>
  );
}

function MetallicPlayPreview() {
  return (
    <PlayPreviewSwatch aria-hidden="true">
      <MiniPlayButtonIos isPlaying={false} size={34} emphasis="high" />
    </PlayPreviewSwatch>
  );
}

export default function MiniBarVariantPicker() {
  const { variant, setVariant } = useMiniBarVariant();
  const { style, setStyle } = useMiniPlayStyle();
  const [playerBuild, setPlayerBuild] = useState('');

  useLayoutEffect(() => {
    const read = () => {
      const bar = document.querySelector('[data-testid="mini-player-bar"]');
      const play = document.querySelector('[data-testid="mini-player-play"]');
      const next = !bar
        ? 'мини-плеер не виден (нет трека?)'
        : (() => {
          const ui = bar.getAttribute('data-mini-bar-ui') || '?';
          const applied = play?.getAttribute('data-play-style')
            || bar.getAttribute('data-mini-play-style')
            || '?';
          return `сборка ${ui}, кнопка: ${applied}`;
        })();
      setPlayerBuild((prev) => (prev === next ? prev : next));
    };
    read();
    const onUiChange = () => read();
    window.addEventListener('earflow:listener-ui-change', onUiChange);
    window.addEventListener('earflow:mini-play-style', onUiChange);
    window.addEventListener('earflow:mini-bar-variant', onUiChange);
    const timer = window.setInterval(read, 2000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('earflow:listener-ui-change', onUiChange);
      window.removeEventListener('earflow:mini-play-style', onUiChange);
      window.removeEventListener('earflow:mini-bar-variant', onUiChange);
    };
  }, [style, variant]);

  return (
    <>
      <Wrap>
        <OptionCard $active={variant === MINI_BAR_VARIANT.CLASSIC}>
        <VariantPreview classic />
        <OptionLabel>стандарт</OptionLabel>
        <PickButton
          type="button"
          $active={variant === MINI_BAR_VARIANT.CLASSIC}
          disabled={variant === MINI_BAR_VARIANT.CLASSIC}
          onClick={() => setVariant(MINI_BAR_VARIANT.CLASSIC)}
          data-testid="mini-bar-variant-classic"
        >
          {variant === MINI_BAR_VARIANT.CLASSIC ? 'выбрано' : 'выбрать'}
        </PickButton>
        </OptionCard>

        <OptionCard $active={variant === MINI_BAR_VARIANT.FLOATING}>
        <VariantPreview />
        <OptionLabel>новый</OptionLabel>
        <PickButton
          type="button"
          $active={variant === MINI_BAR_VARIANT.FLOATING}
          disabled={variant === MINI_BAR_VARIANT.FLOATING}
          onClick={() => setVariant(MINI_BAR_VARIANT.FLOATING)}
          data-testid="mini-bar-variant-floating"
        >
          {variant === MINI_BAR_VARIANT.FLOATING ? 'выбрано' : 'выбрать'}
        </PickButton>
        </OptionCard>
      </Wrap>

      <SubSectionTitle>Кнопка Play/Pause</SubSectionTitle>
      <StyleWrap>
        <OptionCard $active={style === MINI_PLAY_STYLE.ADAPTIVE}>
          <AdaptivePlayPreview />
          <OptionLabel>иконка (без круга)</OptionLabel>
          <PickButton
            type="button"
            $active={style === MINI_PLAY_STYLE.ADAPTIVE}
            disabled={style === MINI_PLAY_STYLE.ADAPTIVE}
            onClick={() => setStyle(MINI_PLAY_STYLE.ADAPTIVE)}
            data-testid="mini-play-style-adaptive"
          >
            {style === MINI_PLAY_STYLE.ADAPTIVE ? 'выбрано' : 'выбрать'}
          </PickButton>
        </OptionCard>

        <OptionCard $active={style === MINI_PLAY_STYLE.METALLIC}>
          <MetallicPlayPreview />
          <OptionLabel>iPhone 5s</OptionLabel>
          <PickButton
            type="button"
            $active={style === MINI_PLAY_STYLE.METALLIC}
            disabled={style === MINI_PLAY_STYLE.METALLIC}
            onClick={() => setStyle(MINI_PLAY_STYLE.METALLIC)}
            data-testid="mini-play-style-metallic"
          >
            {style === MINI_PLAY_STYLE.METALLIC ? 'выбрано' : 'выбрать'}
          </PickButton>
        </OptionCard>
      </StyleWrap>
      <BuildHint data-testid="mini-play-build-hint">{playerBuild}</BuildHint>
    </>
  );
}
