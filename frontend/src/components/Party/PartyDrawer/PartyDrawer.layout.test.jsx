import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import PartyDrawer from './PartyDrawer';

jest.mock('../../../api/client', () => ({
  __esModule: true,
  default: {},
}));

jest.mock('../../../hooks/useAuth', () => ({
  __esModule: true,
  default: () => ({ user: { username: 'tester' } }),
}));

jest.mock('../../../context/PlayerContext', () => ({
  usePlayer: () => ({
    partyMode: false,
    partyInfo: null,
    exitPartyMode: jest.fn(),
    currentTrack: null,
    activePartyId: null,
    setActivePartyId: jest.fn(),
    party: null,
  }),
}));

function setViewportWidth(width) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  window.dispatchEvent(new Event('resize'));
}

describe('PartyDrawer layout shell', () => {
  beforeAll(() => {
    window.scrollTo = jest.fn();
  });

  test('renders as a non-modal complementary side panel on desktop', async () => {
    setViewportWidth(1280);

    render(<PartyDrawer isOpen onClose={jest.fn()} />);

    const panel = await screen.findByRole('complementary');
    expect(panel).toBeInTheDocument();
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('renders through the shared mobile bottom sheet on small screens', async () => {
    setViewportWidth(390);

    render(<PartyDrawer isOpen onClose={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });
});
