import React from "react";
import styled from "styled-components";
import { motion, AnimatePresence } from 'framer-motion';
import { usePlayer } from '../context/PlayerContext';
import useMediaQuery from '../hooks/useMediaQuery';
import SkinPicker from '../skins/SkinPicker';
import { desktopPanelPlacement, mobilePanelSurface, panelSurfaceFrame } from './panels/panelSurface.styles';

// Модальный эквалайзер (НЕ на весь экран!)
const EqModalOverlay = styled(motion.div)`
  position: fixed;
  inset: 0;
  z-index: 10100;
  display: block;
  background: transparent;
  pointer-events: none;
  padding: 0;

  @media (max-width: 720px) {
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    pointer-events: auto;
  }
`;

const EqModalContent = styled(motion.div)`
  position: fixed;
  right: 20px;
  ${desktopPanelPlacement}
  ${panelSurfaceFrame}
  z-index: 10101;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 18px 16px 18px;
  pointer-events: auto;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;

  &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  @media (min-width: 1024px) {
    width: var(--panel-rail-width, clamp(380px, 29vw, 430px));
  }

  @media (max-width: 720px) {
    position: relative;
    top: auto;
    right: auto;
    bottom: auto;
    width: 100%;
    max-width: 100%;
    max-height: 85vh;
    ${mobilePanelSurface}
    border-radius: 18px 18px 0 0;
    padding: 18px 16px calc(18px + env(safe-area-inset-bottom, 0px));
  }
`;

const EqHSlider = styled.input`
  width: 100%;
  height: 34px;
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  touch-action: pan-x;

  &::-webkit-slider-runnable-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 999px;
  }

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #ffffff;
    border: 0;
    margin-top: -8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.45);
  }

  &::-moz-range-track {
    height: 6px;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 999px;
  }

  &::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border-radius: 999px;
    background: #ffffff;
    border: 0;
    box-shadow: 0 2px 10px rgba(0,0,0,0.45);
  }
`;

const EqHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 4px;
`;

const EqTitle = styled.h3`
  color: white;
  font-size: 19px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 500;
  margin: 0;
  
  @media (min-width: 768px) {
    font-size: 20px;
  }
`;

const EqControls = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const EqSwitch = styled.button`
  width: 50px;
  height: 26px;
  border-radius: 999px;
  background: ${props => props.$on ? 'var(--color-primary, #ffffff)' : 'rgba(255,255,255,0.12)'};
  border: 0;
  position: relative;
  cursor: pointer;
  padding: 0;
  transition: background 0.2s ease, border-color 0.2s ease;
  
  &::after {
    content: '';
    position: absolute;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: ${props => props.$on ? 'var(--color-on-primary, #ffffff)' : '#ffffff'};
    transition: left 0.2s ease, background 0.2s ease;
    top: 2px;
    left: ${props => props.$on ? 'calc(100% - 24px)' : '2px'};
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
  }
`;

const CloseEqButton = styled.button`
  background: rgba(255, 255, 255, 0.1);
  border: 0;
  color: white;
  border-radius: 50%;
  width: 34px;
  height: 34px;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  &:active {
    transform: scale(0.95);
  }
`;

const EqSlidersContainer = styled.div`
  display: flex;
  gap: 14px;
  align-items: flex-end;
  padding: 8px 0 2px;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  @media (min-width: 720px) {
    display: grid;
    grid-template-columns: repeat(7, minmax(34px, 1fr));
    gap: 10px;
    overflow: visible;
  }
`;

const EqSliderWrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: rgba(255,255,255,0.7);
  font-size: 10px;
  font-family: 'Unbounded', sans-serif;
  font-weight: 400;
`;

const EqSliderBox = styled.div`
  width: 34px;
  height: 128px;
  display: flex;
  align-items: center;
  justify-content: center;

  @media (min-width: 768px) {
    height: 140px;
  }
`;

const EqSlider = styled.input`
  -webkit-appearance: slider-vertical;
  appearance: none;
  writing-mode: vertical-lr;
  direction: rtl;
  width: 6px;
  height: 122px;
  background: transparent;
  border-radius: 999px;
  cursor: pointer;
  touch-action: manipulation;
  opacity: ${p => p.$disabled ? 0.4 : 1};

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    margin-left: -6px;
    border: 0;
  }

  &::-webkit-slider-runnable-track {
    width: 6px;
    background: rgba(255,255,255,0.18);
    border-radius: 999px;
  }

  &::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #ffffff;
    border: 0;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.4);
  }

  &::-moz-range-track {
    width: 6px;
    background: rgba(255,255,255,0.18);
    border-radius: 999px;
  }

  @media (min-width: 768px) {
    height: 134px;

    &::-webkit-slider-thumb {
      width: 18px;
      height: 18px;
    }

    &::-moz-range-thumb {
      width: 18px;
      height: 18px;
    }
  }
`;

const FreqLabel = styled.div`
  font-size: 9px;
  color: rgba(255, 255, 255, 0.6);
  text-align: center;
  font-weight: 300;
  
  @media (min-width: 768px) {
    font-size: 10px;
  }
`;

const EqActions = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
`;

const EqActionButton = styled.button`
  flex: 1;
  background: ${p => p.$active ? 'var(--color-primary, #ffffff)' : 'rgba(255, 255, 255, 0.075)'};
  border: 0;
  color: ${p => p.$active ? 'var(--color-on-primary, #000000)' : 'rgba(255,255,255,0.85)'};
  border-radius: 12px;
  padding: 9px 12px;
  font-size: 12px;
  font-weight: ${p => p.$active ? 700 : 500};
  letter-spacing: 0.01em;
  font-family: 'Unbounded', sans-serif;
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease, transform 0.1s ease;

  &:hover:not(:disabled) {
    background: ${p => p.$active ? 'var(--color-primary-hover, #f0f0f0)' : 'rgba(255,255,255,0.1)'};
  }

  &:active {
    transform: scale(0.98);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const PresetSelect = styled.select`
  width: 100%;
  min-height: 38px;
  margin-top: 10px;
  padding: 0 38px 0 14px;
  border-radius: 12px;
  border: 0;
  background:
    linear-gradient(45deg, transparent 50%, rgba(255,255,255,0.72) 50%) calc(100% - 18px) 16px / 7px 7px no-repeat,
    linear-gradient(135deg, rgba(255,255,255,0.72) 50%, transparent 50%) calc(100% - 13px) 16px / 7px 7px no-repeat,
    rgba(255, 255, 255, 0.075);
  color: rgba(255, 255, 255, 0.9);
  font-family: 'Unbounded', sans-serif;
  font-size: 12px;
  font-weight: 600;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  option {
    background: #141416;
    color: #fff;
  }
`;

const SpeedSection = styled.div`
  margin-top: 14px;
  padding-top: 10px;
`;

const SkinSection = styled.div`
  margin-top: 14px;
  padding-top: 10px;
`;

const SectionTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  margin-bottom: 8px;
`;

const SpeedTitleRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
`;

const SpeedTitle = styled.div`
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: rgba(255, 255, 255, 0.85);
  text-transform: uppercase;
  font-family: 'Unbounded', sans-serif;
`;

const SpeedValue = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'Unbounded', sans-serif;
`;

const SpeedRow = styled.div`
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin-top: 10px;
`;

const SpeedButtons = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
`;

const SpeedToggleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const SpeedToggleLabel = styled.div`
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-family: 'Unbounded', sans-serif;
`;

const SpeedSwitch = styled(EqSwitch)`
  width: 52px;
  height: 26px;
  &::after {
    width: 22px;
    height: 22px;
    top: 2px;
    left: ${props => props.$on ? 'calc(100% - 24px)' : '2px'};
  }
`;

const EqModal = ({ isOpen, onClose }) => {
  const player = usePlayer();
  const isMobile = useMediaQuery('(max-width: 720px)');

  const frequencies = React.useMemo(() => [60, 170, 310, 600, 1000, 10000, 16000], []);
  const indexMap = React.useMemo(() => [0, 1, 2, 3, 4, 7, 9], []);
  const presets = React.useMemo(() => ([
    { key: 'flat', label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { key: 'bass', label: 'Bass', gains: [6, 5, 3, 1, 0, -1, -2, -2, -2, -2] },
    { key: 'treble', label: 'Treble', gains: [-3, -2, -1, 0, 1, 3, 5, 6, 6, 5] },
    { key: 'vocal', label: 'Vocal', gains: [-2, -1, 0, 2, 4, 3, 1, 0, -1, -2] },
    { key: 'signature', label: 'Earflow', gains: [-0.9, -12, -12, -12, -0.5, -0.2, -0.1, -0.1, 0, 0] },
  ]), []);
  const [selectedPreset, setSelectedPreset] = React.useState('flat');
  const userSlotCount = 5;
  const userPresetKey = (slot) => `eq_user_preset_${slot}`;
  const [userPresets, setUserPresets] = React.useState(() => {
    const slots = [];
    for (let i = 1; i <= userSlotCount; i++) {
      try {
        const raw = localStorage.getItem(userPresetKey(i));
        const parsed = raw ? JSON.parse(raw) : null;
        slots.push(Array.isArray(parsed) && parsed.length === 10 ? parsed : null);
      } catch {
        slots.push(null);
      }
    }
    return slots;
  });
  const presetOptions = React.useMemo(() => {
    const builtIn = presets.map((preset) => ({
      key: preset.key,
      label: preset.label,
    }));
    const user = Array.from({ length: userSlotCount }, (_, idx) => {
      const slot = idx + 1;
      const saved = Boolean(userPresets[idx]);
      return {
        key: `user:${slot}`,
        label: saved ? `User ${slot}` : `User ${slot}+`,
      };
    });
    return [...builtIn, ...user];
  }, [presets, userPresets]);

  const formatFreq = (freq) => {
    if (freq >= 1000) {
      return `${freq / 1000}k`;
    }
    return freq.toString();
  };

  const normalizeGains = React.useCallback((gains) => {
    const next = Array.isArray(gains) ? gains.slice(0, 10) : [];
    while (next.length < 10) next.push(0);
    const out = next.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.max(-12, Math.min(12, n));
    });
    out[5] = 0;
    out[6] = 0;
    out[8] = 0;
    return out;
  }, []);

  const handleEqGainChange = React.useCallback((index, value) => {
    player.ensureAudioActivated?.();
    player.onEqGainChange(index, value);
  }, [player]);

  const handlePlaybackRateChange = React.useCallback((rate) => {
    player.ensureAudioActivated?.();
    player.setPlaybackRate?.(rate);
  }, [player]);

  const handlePreservePitchToggle = React.useCallback(() => {
    player.ensureAudioActivated?.();
    player.setPreservePitch?.(!(player.preservePitch !== false));
  }, [player]);

  const handleEqToggle = React.useCallback(() => {
    if (isMobile) return;
    player.ensureAudioActivated?.();
    player.setEqEnabled(!player.eqEnabled);
  }, [isMobile, player]);

  const setGains = React.useCallback((gains) => {
    const next = normalizeGains(gains);
    player.ensureAudioActivated?.();
    if (typeof player.setEqGains === 'function') {
      player.setEqGains(next);
      return;
    }
    if (typeof player.onEqGainChange === 'function') {
      for (let i = 0; i < 10; i++) {
        player.onEqGainChange(i, next[i]);
      }
    }
  }, [player, normalizeGains]);

  const resolvePresetGains = React.useCallback((presetKey) => {
    const k = String(presetKey || '').trim();
    if (k.startsWith('user:')) {
      const slot = Number.parseInt(k.slice('user:'.length), 10);
      if (!Number.isInteger(slot) || slot < 1 || slot > userSlotCount) return null;
      const stored = userPresets[slot - 1];
      return stored ? normalizeGains(stored) : null;
    }
    const p = presets.find((x) => x.key === k);
    return p ? normalizeGains(p.gains) : null;
  }, [userPresets, presets, normalizeGains]);

  const applyPreset = React.useCallback((presetKey) => {
    const gains = resolvePresetGains(presetKey);
    setSelectedPreset(presetKey);
    if (gains) setGains(gains);
  }, [resolvePresetGains, setGains]);

  const resetEq = React.useCallback(() => {
    applyPreset('flat');
  }, [applyPreset]);

  const saveSelected = React.useCallback(() => {
    const k = String(selectedPreset || '').trim();
    if (!k.startsWith('user:')) return;
    const slot = Number.parseInt(k.slice('user:'.length), 10);
    if (!Number.isInteger(slot) || slot < 1 || slot > userSlotCount) return;
    const gains = normalizeGains(player.eqGains);
    try {
      localStorage.setItem(userPresetKey(slot), JSON.stringify(gains));
    } catch {
    }
    setUserPresets((prev) => {
      const next = Array.isArray(prev) ? prev.slice(0, userSlotCount) : [];
      while (next.length < userSlotCount) next.push(null);
      next[slot - 1] = gains;
      return next;
    });
  }, [selectedPreset, player.eqGains, normalizeGains]);

  const panelMotionProps = React.useMemo(() => ({
    initial: isMobile ? { y: '100%' } : { x: '100%', opacity: 0 },
    animate: isMobile ? { y: 0 } : { x: 0, opacity: 1 },
    exit: isMobile ? { y: '100%' } : { x: '100%', opacity: 0 },
    transition: { type: 'spring', damping: 30, stiffness: 300 },
  }), [isMobile]);

  return (
    <AnimatePresence>
      {isOpen && (
        <EqModalOverlay
          $mobile={isMobile}
          onClick={onClose}
        >
          <EqModalContent
            $mobile={isMobile}
            role="dialog"
            aria-modal={isMobile}
            aria-label="Эквалайзер"
            {...panelMotionProps}
            onClick={(e) => e.stopPropagation()}
          >
            <EqHeader>
              <EqTitle>Эквалайзер</EqTitle>
              <EqControls>
                <EqSwitch
                  $on={!isMobile && player.eqEnabled}
                  onClick={handleEqToggle}
                  style={{ opacity: isMobile ? 0.35 : 1, cursor: isMobile ? 'not-allowed' : 'pointer' }}
                />
                <CloseEqButton onClick={onClose}>
                  ×
                </CloseEqButton>
              </EqControls>
            </EqHeader>

            {isMobile ? (
              <div style={{ padding: '12px 0 8px', color: 'rgba(255,255,255,0.45)', fontSize: '12px', fontFamily: "'Unbounded', sans-serif", textAlign: 'center' }}>
                Эквалайзер недоступен на мобильных устройствах
              </div>
            ) : (
              <EqSlidersContainer>
                {frequencies.map((freq, i) => (
                  <EqSliderWrap key={freq}>
                    <EqSliderBox>
                      <EqSlider
                        type="range"
                        id={`eq-band-${freq}`}
                        name={`eq-band-${freq}`}
                        min="-12"
                        max="12"
                        step="0.1"
                        value={player.eqGains[indexMap[i]] || 0}
                        onChange={(e) => handleEqGainChange(indexMap[i], Number.parseFloat(e.target.value))}
                        onInput={(e) => handleEqGainChange(indexMap[i], Number.parseFloat(e.target.value))}
                        disabled={!player.eqEnabled}
                        $disabled={!player.eqEnabled}
                      />
                    </EqSliderBox>
                    <FreqLabel>{formatFreq(freq)}</FreqLabel>
                  </EqSliderWrap>
                ))}
              </EqSlidersContainer>
            )}

            {!isMobile && (
              <>
                <PresetSelect
                  aria-label="Пресет эквалайзера"
                  value={selectedPreset}
                  onChange={(e) => applyPreset(e.target.value)}
                  disabled={!player.eqEnabled}
                >
                  {presetOptions.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                </PresetSelect>

                <EqActions>
                  <EqActionButton onClick={resetEq} disabled={!player.eqEnabled}>Default</EqActionButton>
                  <EqActionButton
                    $active={player.eqEnabled && String(selectedPreset || '').startsWith('user:')}
                    onClick={saveSelected}
                    disabled={!player.eqEnabled || !String(selectedPreset || '').startsWith('user:')}
                  >Save</EqActionButton>
                </EqActions>
              </>
            )}

            <SpeedSection>
              <SpeedTitleRow>
                <SpeedTitle>Скорость</SpeedTitle>
                <SpeedValue>x{Number(player.playbackRate || 1).toFixed(2)}</SpeedValue>
              </SpeedTitleRow>
              <SpeedRow>
                <SpeedButtons>
                  <EqActionButton
                    $active={Math.abs(Number(player.playbackRate || 1) - 0.85) < 0.01}
                    onClick={() => {
                      handlePlaybackRateChange(0.85);
                      player.setPreservePitch?.(false);
                    }}
                  >Slowed</EqActionButton>
                  <EqActionButton
                    $active={Math.abs(Number(player.playbackRate || 1) - 1) < 0.01}
                    onClick={() => {
                      handlePlaybackRateChange(1);
                      player.setPreservePitch?.(true);
                    }}
                  >Normal</EqActionButton>
                  <EqActionButton
                    $active={Math.abs(Number(player.playbackRate || 1) - 1.15) < 0.01}
                    onClick={() => {
                      handlePlaybackRateChange(1.15);
                      player.setPreservePitch?.(false);
                    }}
                  >Sped</EqActionButton>
                </SpeedButtons>

                <EqHSlider
                  type="range"
                  id="eq-playback-rate"
                  name="eq-playback-rate"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={Number(player.playbackRate || 1)}
                  onChange={(e) => handlePlaybackRateChange(Number.parseFloat(e.target.value))}
                  onInput={(e) => handlePlaybackRateChange(Number.parseFloat(e.target.value))}
                />

                <SpeedToggleRow>
                  <SpeedToggleLabel>Сохранять тон</SpeedToggleLabel>
                  <SpeedSwitch
                    $on={player.preservePitch !== false}
                    onClick={handlePreservePitchToggle}
                  />
                </SpeedToggleRow>
              </SpeedRow>
            </SpeedSection>

            <SkinSection>
              <SectionTitle>Тема</SectionTitle>
              <SkinPicker />
            </SkinSection>

          </EqModalContent>
        </EqModalOverlay>
      )}
    </AnimatePresence>
  );
};

export default EqModal;
