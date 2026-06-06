/**
 * Bug Condition Exploration Tests for Earflow Theme/EQ/Performance Fixes
 *
 * These checks now cover the user-visible behavior directly for the most
 * important paths, so a green run gives us stronger evidence than regex-only
 * source inspection.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';

const mockUseSkin = jest.fn();
const mockUsePlayer = jest.fn();
const mockUseMediaQuery = jest.fn();

jest.mock('../skins/useSkin', () => ({
  useSkin: (...args) => mockUseSkin(...args),
}));

jest.mock('../context/PlayerContext', () => ({
  usePlayer: (...args) => mockUsePlayer(...args),
}));

jest.mock('../hooks/useMediaQuery', () => ({
  __esModule: true,
  default: (...args) => mockUseMediaQuery(...args),
}));

const skinFixtures = [
  {
    id: 'earflow',
    name: 'Earflow',
    colors: {
      surface: '#0a0a0a',
      primary: '#1db954',
      playerBg: '#000000',
    },
    player: {
      accentGradient: 'linear-gradient(90deg, #1db954 0%, #1ed760 100%)',
      progressBarStyle: 'rounded',
    },
  },
  {
    id: 'vinyl',
    name: 'Vinyl',
    colors: {
      surface: '#1a1410',
      primary: '#d4a057',
      playerBg: '#1e1712',
    },
    player: {
      accentGradient: 'linear-gradient(90deg, #d4a057 0%, #e5b76b 100%)',
      progressBarStyle: 'rounded',
    },
  },
];

const normalizedBassGains = [6, 5, 3, 1, 0, 0, 0, -2, 0, -2];
const visibleBassSliderValues = [
  ['eq-band-60', '6'],
  ['eq-band-170', '5'],
  ['eq-band-310', '3'],
  ['eq-band-600', '1'],
  ['eq-band-1000', '0'],
  ['eq-band-10000', '-2'],
  ['eq-band-16000', '-2'],
];

const buildDefaultSkinState = (overrides = {}) => ({
  skinId: 'earflow',
  setSkinId: jest.fn(),
  availableSkins: skinFixtures,
  ...overrides,
});

const createStatefulPlayerMock = () => {
  const stable = {
    setEqEnabled: jest.fn(),
    setEqGains: jest.fn(),
    onEqGainChange: jest.fn(),
    setPlaybackRate: jest.fn(),
    setPreservePitch: jest.fn(),
    ensureAudioActivated: jest.fn(),
  };

  mockUsePlayer.mockImplementation(() => {
    const [eqEnabled, setEqEnabledState] = React.useState(true);
    const [eqGains, setEqGainsState] = React.useState([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const [playbackRate, setPlaybackRateState] = React.useState(1);
    const [preservePitch, setPreservePitchState] = React.useState(true);

    return {
      eqEnabled,
      eqGains,
      playbackRate,
      preservePitch,
      setEqEnabled: (next) => {
        stable.setEqEnabled(next);
        setEqEnabledState(Boolean(next));
      },
      setEqGains: (next) => {
        const normalized = Array.isArray(next) ? next.slice(0, 10) : [];
        while (normalized.length < 10) normalized.push(0);
        stable.setEqGains(normalized);
        setEqGainsState(normalized);
      },
      onEqGainChange: (index, value) => {
        stable.onEqGainChange(index, value);
        setEqGainsState((prev) => {
          const next = Array.isArray(prev) ? prev.slice(0, 10) : [];
          while (next.length < 10) next.push(0);
          next[index] = value;
          return next;
        });
      },
      setPlaybackRate: (next) => {
        stable.setPlaybackRate(next);
        setPlaybackRateState(next);
      },
      setPreservePitch: (next) => {
        stable.setPreservePitch(next);
        setPreservePitchState(next);
      },
      ensureAudioActivated: stable.ensureAudioActivated,
    };
  });

  return stable;
};

const installScrollIntoViewMock = () => {
  const original = HTMLElement.prototype.scrollIntoView;
  const scrollIntoViewMock = jest.fn();

  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollIntoViewMock,
  });

  return {
    scrollIntoViewMock,
    restore: () => {
      if (typeof original === 'function') {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          writable: true,
          value: original,
        });
        return;
      }
      delete HTMLElement.prototype.scrollIntoView;
    },
  };
};

describe('Bug Condition Exploration Tests - Phase 1', () => {
  let SkinPicker;
  let EqModal;

  beforeAll(async () => {
    SkinPicker = (await import('../skins/SkinPicker')).default;
    EqModal = (await import('../components/EqModal')).default;
  });

  beforeEach(() => {
    mockUseSkin.mockReset();
    mockUsePlayer.mockReset();
    mockUseMediaQuery.mockReset();

    mockUseSkin.mockReturnValue(buildDefaultSkinState());
    mockUseMediaQuery.mockImplementation(() => false);
  });

  /**
   * Task 1.1: Test P0 - SkinPicker theme switching
   *
   * Validates: Requirements 2.1, 2.2
   */
  describe('1.1 SkinPicker theme switching', () => {
    it('should call setSkinId with the selected theme id when a theme card is clicked', () => {
      const setSkinId = jest.fn();
      mockUseSkin.mockReturnValue(buildDefaultSkinState({ setSkinId }));

      render(<SkinPicker />);

      fireEvent.click(screen.getByRole('radio', { name: 'Vinyl' }));

      expect(setSkinId).toHaveBeenCalledWith('vinyl');
    });

    it('should not contain pointer-capture or drag-threshold logic that can swallow clicks', () => {
      const skinPickerPath = path.join(__dirname, '../skins/SkinPicker.tsx');
      const skinPickerSource = fs.readFileSync(skinPickerPath, 'utf-8');

      const hasPointerCapture = /setPointerCapture|releasePointerCapture/i.test(skinPickerSource);
      const hasMovedFlag = /moved\s*=\s*true|moved\s*:\s*true/i.test(skinPickerSource);
      const hasDragThreshold = /DRAG_THRESHOLD|dragThreshold/i.test(skinPickerSource);

      expect(hasPointerCapture).toBe(false);
      expect(hasMovedFlag).toBe(false);
      expect(hasDragThreshold).toBe(false);
    });
  });

  /**
   * Task 1.2: Test P0 - EqModal preset updates sliders
   *
   * Validates: Requirements 2.3
   */
  describe('1.2 EqModal preset updates sliders', () => {
    it('should update the visible sliders when the Bass preset is selected', () => {
      const player = createStatefulPlayerMock();

      render(<EqModal isOpen={true} onClose={jest.fn()} />);

      fireEvent.change(screen.getByRole('combobox', { name: 'Пресет эквалайзера' }), {
        target: { value: 'bass' },
      });

      expect(player.setEqGains).toHaveBeenCalledWith(normalizedBassGains);

      visibleBassSliderValues.forEach(([id, expectedValue]) => {
        const slider = document.getElementById(id);
        expect(slider).toBeInTheDocument();
        expect(slider.value).toBe(expectedValue);
      });
    });

    it('should keep preset application routed through applyPreset -> setGains', () => {
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');

      const hasApplyPreset = /const\s+applyPreset\s*=|function\s+applyPreset/i.test(eqModalSource);
      const applyPresetCallsSetGains = /applyPreset[\s\S]{0,200}setGains/i.test(eqModalSource);

      expect(hasApplyPreset).toBe(true);
      expect(applyPresetCallsSetGains).toBe(true);
    });
  });

  /**
   * Task 1.3: Test P1 - offline.html monochrome styling
   *
   * Validates: Requirements 2.4
   */
  describe('1.3 offline.html monochrome styling', () => {
    it('should not contain green color #1db954 in offline.html', () => {
      const offlinePath = path.join(__dirname, '../../public/offline.html');
      const offlineHtml = fs.readFileSync(offlinePath, 'utf-8');

      const hasGreenHex = /#1db954/i.test(offlineHtml);
      const hasGreenRgb = /rgb\(\s*29\s*,\s*185\s*,\s*84\s*\)/i.test(offlineHtml);

      expect(hasGreenHex).toBe(false);
      expect(hasGreenRgb).toBe(false);
    });

    it('should not contain green radial gradients in offline.html', () => {
      const offlinePath = path.join(__dirname, '../../public/offline.html');
      const offlineHtml = fs.readFileSync(offlinePath, 'utf-8');

      const hasGreenGradient =
        /radial-gradient[^;]*#1db954/i.test(offlineHtml) ||
        /radial-gradient[^;]*rgb\(\s*29\s*,\s*185\s*,\s*84\s*\)/i.test(offlineHtml);

      expect(hasGreenGradient).toBe(false);
    });

    it('should use monochrome colors (black and white) in offline.html', () => {
      const offlinePath = path.join(__dirname, '../../public/offline.html');
      const offlineHtml = fs.readFileSync(offlinePath, 'utf-8');

      const hasBlack = /#000/i.test(offlineHtml);
      const hasWhite = /#fff/i.test(offlineHtml);

      expect(hasBlack).toBe(true);
      expect(hasWhite).toBe(true);
    });
  });

  /**
   * Task 1.4: Test P1 - EqModal slider thumbs are white
   *
   * Validates: Requirements 2.5, 2.6
   */
  describe('1.4 EqModal slider thumbs are white', () => {
    it('should use #ffffff for slider thumbs, not var(--color-primary)', () => {
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');

      const sliderThumbStyles = eqModalSource.match(/::-webkit-slider-thumb[\s\S]{0,300}background[^;]+/gi) || [];
      const mozThumbStyles = eqModalSource.match(/::-moz-range-thumb[\s\S]{0,300}background[^;]+/gi) || [];

      const allThumbStyles = [...sliderThumbStyles, ...mozThumbStyles].join(' ');

      const usesColorPrimary = /var\(--color-primary/i.test(allThumbStyles);
      const usesWhite = /#ffffff|#fff\b/i.test(allThumbStyles);

      expect(usesColorPrimary).toBe(false);
      expect(usesWhite).toBe(true);
    });
  });

  /**
   * Task 1.5: Test P2 - EqModal render performance
   *
   * Validates: Requirements 2.7, 2.8
   */
  describe('1.5 EqModal render performance', () => {
    it('should use useCallback for onChange and onInput handlers', () => {
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');

      const hasInlineOnChange = /onChange=\{[^}]*=>/i.test(eqModalSource);
      const hasInlineOnInput = /onInput=\{[^}]*=>/i.test(eqModalSource);
      const hasUseCallbackForHandlers =
        /handleEqGainChange\s*=\s*React\.useCallback|handleEqGainChange\s*=\s*useCallback|const\s+handleEqGainChange\s*=\s*useCallback/i
          .test(eqModalSource);

      if (hasInlineOnChange || hasInlineOnInput) {
        expect(hasUseCallbackForHandlers).toBe(true);
      }
    });

    it('should not have inline style objects that recreate on every render for the EQ sliders', () => {
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');

      const hasInlineOpacityStyle = /style=\{\{\s*opacity:\s*player\.eqEnabled/i.test(eqModalSource);
      const hasDisabledProp = /\$disabled=\{!player\.eqEnabled\}/i.test(eqModalSource);

      expect(hasInlineOpacityStyle).toBe(false);
      expect(hasDisabledProp).toBe(true);
    });
  });

  /**
   * Task 1.6: Test P2 - SkinPicker conditional scrollIntoView
   *
   * Validates: Requirements 2.9
   */
  describe('1.6 SkinPicker conditional scrollIntoView', () => {
    it('should not call scrollIntoView when the selected card is already visible', () => {
      const { scrollIntoViewMock, restore } = installScrollIntoViewMock();

      try {
        const setSkinId = jest.fn();
        mockUseSkin.mockReturnValue(buildDefaultSkinState({ setSkinId }));

        const { container, rerender } = render(<SkinPicker />);
        const scroller = container.querySelector('[role="radiogroup"]');
        const vinylCard = container.querySelector('[data-skin-id="vinyl"]');

        scroller.getBoundingClientRect = () => ({
          left: 0,
          right: 220,
          top: 0,
          bottom: 40,
          width: 220,
          height: 40,
        });
        vinylCard.getBoundingClientRect = () => ({
          left: 20,
          right: 120,
          top: 0,
          bottom: 40,
          width: 100,
          height: 40,
        });

        scrollIntoViewMock.mockClear();
        mockUseSkin.mockReturnValue(buildDefaultSkinState({ skinId: 'vinyl', setSkinId }));
        rerender(<SkinPicker />);

        expect(scrollIntoViewMock).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('should call scrollIntoView when the selected card is outside the viewport', () => {
      const { scrollIntoViewMock, restore } = installScrollIntoViewMock();

      try {
        const setSkinId = jest.fn();
        mockUseSkin.mockReturnValue(buildDefaultSkinState({ setSkinId }));

        const { container, rerender } = render(<SkinPicker />);
        const scroller = container.querySelector('[role="radiogroup"]');
        const vinylCard = container.querySelector('[data-skin-id="vinyl"]');

        scroller.getBoundingClientRect = () => ({
          left: 0,
          right: 220,
          top: 0,
          bottom: 40,
          width: 220,
          height: 40,
        });
        vinylCard.getBoundingClientRect = () => ({
          left: 260,
          right: 360,
          top: 0,
          bottom: 40,
          width: 100,
          height: 40,
        });

        scrollIntoViewMock.mockClear();
        mockUseSkin.mockReturnValue(buildDefaultSkinState({ skinId: 'vinyl', setSkinId }));
        rerender(<SkinPicker />);

        expect(scrollIntoViewMock).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      } finally {
        restore();
      }
    });
  });

  /**
   * Task 1.7: Test P2 - EqModal single animation
   *
   * Validates: Requirements 2.10
   */
  describe('1.7 EqModal single animation', () => {
    it('should animate only one element (overlay OR content, not both)', () => {
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');

      const overlayHasAnimation = /EqModalOverlay[\s\S]{0,500}(initial|animate|exit)=/i.test(eqModalSource);
      const contentHasAnimation = /EqModalContent[\s\S]{0,500}(initial|animate|exit)=/i.test(eqModalSource);

      const bothAnimated = overlayHasAnimation && contentHasAnimation;
      expect(bothAnimated).toBe(false);
    });

    it('should have only one motion.div with animation props', () => {
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');

      const motionDivMatches = eqModalSource.match(/motion\.div[\s\S]{0,200}(initial|animate|exit)=/gi) || [];

      expect(motionDivMatches.length).toBeLessThanOrEqual(1);
    });
  });
});
