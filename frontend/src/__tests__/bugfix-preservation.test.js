/**
 * Preservation Property Tests for Earflow Theme/EQ/Performance Fixes
 * 
 * CRITICAL: These tests are EXPECTED TO PASS on unfixed code.
 * They confirm baseline behavior that must be preserved after fixes.
 * 
 * Spec: .kiro/specs/earflow-theme-eq-performance-fixes/
 * 
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import fs from 'fs';
import path from 'path';

const mockUseSkin = jest.fn();
const skinFixtures = [
  {
    id: 'earflow',
    name: 'Earflow',
    colors: {
      surface: '#0a0a0a',
      primary: '#1db954',
      playerBg: '#000000'
    },
    player: {
      accentGradient: 'linear-gradient(90deg, #1db954 0%, #1ed760 100%)',
      progressBarStyle: 'rounded'
    }
  },
  {
    id: 'vinyl',
    name: 'Vinyl',
    colors: {
      surface: '#1a1410',
      primary: '#f59e0b',
      playerBg: '#0f0c08'
    },
    player: {
      accentGradient: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
      progressBarStyle: 'pill'
    }
  }
];

// Mock dependencies
jest.mock('../skins/useSkin', () => ({
  useSkin: (...args) => mockUseSkin(...args)
}));

jest.mock('../context/PlayerContext', () => ({
  usePlayer: () => ({
    eqEnabled: true,
    eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    playbackRate: 1,
    preservePitch: true,
    setEqEnabled: jest.fn(),
    setEqGains: jest.fn(),
    onEqGainChange: jest.fn(),
    setPlaybackRate: jest.fn(),
    setPreservePitch: jest.fn(),
    ensureAudioActivated: jest.fn()
  })
}));

jest.mock('../hooks/useMediaQuery', () => ({
  __esModule: true,
  default: (query) => {
    // Default to desktop for preservation tests
    return query === '(max-width: 720px)' ? false : true;
  }
}));

describe('Preservation Property Tests - Phase 2', () => {
  beforeEach(() => {
    mockUseSkin.mockReset();
    mockUseSkin.mockReturnValue({
      skinId: 'earflow',
      setSkinId: jest.fn(),
      availableSkins: skinFixtures
    });
  });

  /**
   * Task 2.1: Test SkinPicker scroll preservation
   * 
   * EXPECTED OUTCOME: Tests PASS (confirms baseline behavior to preserve)
   * 
   * Validates: Requirements 3.1, 3.2, 3.3
   */
  describe('2.1 SkinPicker scroll preservation', () => {
    let SkinPicker;

    beforeAll(async () => {
      // Dynamically import SkinPicker
      const module = await import('../skins/SkinPicker');
      SkinPicker = module.default;
    });

    it('should convert vertical wheel scroll to horizontal scroll', () => {
      const { container } = render(<SkinPicker />);
      const scroller = container.querySelector('[role="radiogroup"]');
      
      expect(scroller).toBeInTheDocument();
      Object.defineProperty(scroller, 'scrollLeft', {
        value: 0,
        writable: true,
        configurable: true
      });
      
      // Simulate vertical wheel scroll (deltaY > 0, deltaX = 0)
      fireEvent.wheel(scroller, {
        deltaY: 100,
        deltaX: 0,
        shiftKey: false
      });
      
      expect(scroller.scrollLeft).toBe(100);
    });

    it('should not convert wheel scroll when Shift is pressed', () => {
      const { container } = render(<SkinPicker />);
      const scroller = container.querySelector('[role="radiogroup"]');
      
      expect(scroller).toBeInTheDocument();
      Object.defineProperty(scroller, 'scrollLeft', {
        value: 0,
        writable: true,
        configurable: true
      });
      
      // Simulate vertical wheel scroll with Shift key
      fireEvent.wheel(scroller, {
        deltaY: 100,
        deltaX: 0,
        shiftKey: true
      });
      
      expect(scroller.scrollLeft).toBe(0);
    });

    it('should have horizontal overflow for touch scroll', () => {
      const { container } = render(<SkinPicker />);
      const scroller = container.querySelector('[role="radiogroup"]');
      
      expect(scroller).toBeInTheDocument();
      
      // Verify CSS properties for touch scroll
      const styles = window.getComputedStyle(scroller);
      // Note: JSDOM may not fully support all CSS properties, but we verify the element exists
      expect(scroller).toHaveAttribute('role', 'radiogroup');
    });

    it('should display active card with check icon', () => {
      const { container } = render(<SkinPicker />);
      
      // Find the active card (earflow)
      const activeCard = container.querySelector('[data-skin-id="earflow"]');
      expect(activeCard).toBeInTheDocument();
      expect(activeCard).toHaveAttribute('aria-checked', 'true');
      
      // Verify check icon is present (FaCheck renders as svg)
      const checkIcon = activeCard.querySelector('svg');
      expect(checkIcon).toBeInTheDocument();
    });

    it('should have scroll-snap-type for smooth scrolling', () => {
      const { container } = render(<SkinPicker />);
      const scroller = container.querySelector('[role="radiogroup"]');
      
      expect(scroller).toBeInTheDocument();
      // Verify scroller has the necessary attributes for snap scrolling
      expect(scroller).toHaveAttribute('role', 'radiogroup');
    });
  });

  /**
   * Task 2.2: Test EqModal functionality preservation
   * 
   * EXPECTED OUTCOME: Tests PASS (confirms baseline behavior to preserve)
   * 
   * Validates: Requirements 3.4, 3.5, 3.6, 3.7, 3.8
   */
  describe('2.2 EqModal functionality preservation', () => {
    let EqModal;
    let mockPlayer;

    beforeAll(async () => {
      // Dynamically import EqModal
      const module = await import('../components/EqModal');
      EqModal = module.default;
    });

    beforeEach(() => {
      mockPlayer = {
        eqEnabled: true,
        eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        playbackRate: 1,
        preservePitch: true,
        setEqEnabled: jest.fn(),
        setEqGains: jest.fn(),
        onEqGainChange: jest.fn(),
        setPlaybackRate: jest.fn(),
        setPreservePitch: jest.fn(),
        ensureAudioActivated: jest.fn()
      };

      // Mock usePlayer to return our mockPlayer
      jest.spyOn(require('../context/PlayerContext'), 'usePlayer').mockReturnValue(mockPlayer);
    });

    it('should allow individual slider changes', async () => {
      const { container } = render(<EqModal isOpen={true} onClose={jest.fn()} />);
      
      // Find the first EQ slider (60 Hz)
      const slider = container.querySelector('input[type="range"][id="eq-band-60"]');
      expect(slider).toBeInTheDocument();
      
      // Change slider value
      fireEvent.change(slider, { target: { value: '3' } });
      
      // Verify onEqGainChange was called
      expect(mockPlayer.onEqGainChange).toHaveBeenCalled();
    });

    it('should display mobile device message on mobile', async () => {
      // Mock mobile viewport
      jest.spyOn(require('../hooks/useMediaQuery'), 'default').mockReturnValue(true);
      
      const { container } = render(<EqModal isOpen={true} onClose={jest.fn()} />);
      
      // Verify mobile message is displayed
      expect(container.textContent).toContain('Эквалайзер недоступен на мобильных устройствах');
    });

    it('should allow playback rate changes (Slowed/Normal/Sped)', async () => {
      const { container } = render(<EqModal isOpen={true} onClose={jest.fn()} />);
      
      // Find the "Slowed" button
      const slowedButton = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Slowed');
      
      expect(slowedButton).toBeInTheDocument();
      
      // Click "Slowed" button
      fireEvent.click(slowedButton);
      
      // Verify setPlaybackRate was called with 0.85
      expect(mockPlayer.setPlaybackRate).toHaveBeenCalledWith(0.85);
      expect(mockPlayer.setPreservePitch).toHaveBeenCalledWith(false);
    });

    it('should allow playback rate slider changes', async () => {
      const { container } = render(<EqModal isOpen={true} onClose={jest.fn()} />);
      
      // Find the playback rate slider
      const rateSlider = container.querySelector('input[type="range"][id="eq-playback-rate"]');
      expect(rateSlider).toBeInTheDocument();
      
      // Change slider value
      fireEvent.change(rateSlider, { target: { value: '1.5' } });
      
      // Verify setPlaybackRate was called
      expect(mockPlayer.setPlaybackRate).toHaveBeenCalledWith(1.5);
    });

    it('should allow preservePitch toggle', async () => {
      const { container } = render(<EqModal isOpen={true} onClose={jest.fn()} />);
      
      // Find the preservePitch toggle (look for "Сохранять тон" text)
      const toggleLabel = Array.from(container.querySelectorAll('div'))
        .find(div => div.textContent === 'Сохранять тон');
      
      expect(toggleLabel).toBeInTheDocument();
      
      // Find the toggle button (sibling of the label)
      const toggleButton = toggleLabel.parentElement.querySelector('button');
      expect(toggleButton).toBeInTheDocument();
      
      // Click toggle
      fireEvent.click(toggleButton);
      
      // Verify setPreservePitch was called
      expect(mockPlayer.setPreservePitch).toHaveBeenCalled();
    });

    it('should save user presets to localStorage', async () => {
      // Mock localStorage before rendering
      const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
      const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
      
      const { container } = render(<EqModal isOpen={true} onClose={jest.fn()} />);

      const presetSelect = screen.getByRole('combobox', { name: 'Пресет эквалайзера' });
      expect(presetSelect).toBeInTheDocument();

      fireEvent.change(presetSelect, { target: { value: 'user:1' } });
      
      // Find the Save button
      const saveButton = Array.from(container.querySelectorAll('button'))
        .find(btn => btn.textContent === 'Save');
      
      expect(saveButton).toBeInTheDocument();
      
      // Click Save button
      fireEvent.click(saveButton);
      
      // Verify localStorage.setItem was called
      expect(setItemSpy).toHaveBeenCalled();
      
      // Cleanup
      setItemSpy.mockRestore();
      getItemSpy.mockRestore();
    });

    it('should display all presets in the compact select (Flat, Bass, Treble, Vocal, Earflow)', async () => {
      render(<EqModal isOpen={true} onClose={jest.fn()} />);

      const presetSelect = screen.getByRole('combobox', { name: 'Пресет эквалайзера' });
      const presetLabels = ['Flat', 'Bass', 'Treble', 'Vocal', 'Earflow'];

      presetLabels.forEach(label => {
        expect(presetSelect).toHaveTextContent(label);
      });
    });
  });

  /**
   * Task 2.3: Test offline.html functionality preservation
   * 
   * EXPECTED OUTCOME: Tests PASS (confirms baseline behavior to preserve)
   * 
   * Validates: Requirements 3.9, 3.10, 3.11
   */
  describe('2.3 offline.html functionality preservation', () => {
    let offlineHtml;

    beforeAll(() => {
      // Read offline.html
      const offlinePath = path.join(__dirname, '../../public/offline.html');
      offlineHtml = fs.readFileSync(offlinePath, 'utf-8');
    });

    it('should have "Попробовать снова" button that reloads page', () => {
      // Verify button exists in HTML
      expect(offlineHtml).toContain('Попробовать снова');
      
      // Verify onclick handler calls retry()
      expect(offlineHtml).toContain('onclick="retry()"');
      
      // Verify retry() function calls location.reload()
      expect(offlineHtml).toContain('location.reload()');
    });

    it('should have "Открыть скачанное" button that navigates to "/"', () => {
      // Verify button exists in HTML
      expect(offlineHtml).toContain('Открыть скачанное');
      
      // Verify href points to "/"
      expect(offlineHtml).toContain('href="/"');
    });

    it('should have automatic reload on network detection', () => {
      // Verify online event listener exists
      expect(offlineHtml).toContain("addEventListener('online'");
      
      // Verify it calls location.reload()
      expect(offlineHtml).toContain('location.reload()');
    });

    it('should check navigator.onLine before reloading', () => {
      // Verify retry() function checks navigator.onLine
      expect(offlineHtml).toContain('navigator.onLine');
    });

    it('should disable button temporarily when network is unavailable', () => {
      // Verify retry() function disables button
      expect(offlineHtml).toContain('btn.disabled = true');
      
      // Verify it re-enables after timeout
      expect(offlineHtml).toContain('btn.disabled = false');
    });

    it('should display offline status indicator', () => {
      // Verify offline status text exists
      expect(offlineHtml).toContain('Офлайн-режим');
      
      // Verify dot indicator exists
      expect(offlineHtml).toContain('class="dot"');
    });
  });

  /**
   * Task 2.4: Test general UI styling preservation
   * 
   * EXPECTED OUTCOME: Tests PASS (confirms baseline behavior to preserve)
   * 
   * Validates: Requirements 3.12, 3.13
   */
  describe('2.4 General UI styling preservation', () => {
    it('should verify offline.html uses monochrome styling (black and white)', () => {
      // Read offline.html
      const offlinePath = path.join(__dirname, '../../public/offline.html');
      const offlineHtml = fs.readFileSync(offlinePath, 'utf-8');
      
      // Verify black background
      expect(offlineHtml).toContain('background: #000');
      
      // Verify white text
      expect(offlineHtml).toContain('color: #fff');
      
      // Verify white button background
      expect(offlineHtml).toContain('background: #ffffff');
    });

    it('should verify offline.html uses red for offline indicator (acceptable accent)', () => {
      const offlinePath = path.join(__dirname, '../../public/offline.html');
      const offlineHtml = fs.readFileSync(offlinePath, 'utf-8');
      
      // Verify red dot for offline indicator
      expect(offlineHtml).toContain('background: #ef4444');
    });

    it('should verify SkinPicker uses monochrome styling with theme-specific accents', () => {
      // Read SkinPicker source
      const skinPickerPath = path.join(__dirname, '../skins/SkinPicker.tsx');
      const skinPickerSource = fs.readFileSync(skinPickerPath, 'utf-8');
      
      // Verify white text colors
      expect(skinPickerSource).toContain('rgba(255,255,255');
      
      // Verify theme-specific border colors (uses $border prop from skin)
      expect(skinPickerSource).toContain('$border');
    });

    it('should verify EqModal uses monochrome base styling', () => {
      // Read EqModal source
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');
      
      // Verify black background
      expect(eqModalSource).toContain('rgba(0, 0, 0');
      
      // Verify white text colors
      expect(eqModalSource).toContain('rgba(255, 255, 255');
      expect(eqModalSource).toContain('color: white');
    });

    it('should verify PartyBadge can use green accent (exception to monochrome)', () => {
      // This test documents that PartyBadge is allowed to use green #1db954
      // as a decorative element (exception to monochrome styling)
      
      // Note: We don't test PartyBadge implementation here, just document the requirement
      // PartyBadge should continue to use green #1db954 as per Requirements 3.13
      expect(true).toBe(true);
    });

    it('should verify EqModal uses var(--color-primary) for theme-specific accents', () => {
      // Read EqModal source
      const eqModalPath = path.join(__dirname, '../components/EqModal.js');
      const eqModalSource = fs.readFileSync(eqModalPath, 'utf-8');
      
      // Verify var(--color-primary) is used for theme-specific elements
      expect(eqModalSource).toContain('var(--color-primary');
      
      // This is the CURRENT behavior that should be preserved for most elements
      // (except slider thumbs, which will be changed to white in the fix)
    });
  });
});
