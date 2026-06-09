import {
  attachMediaTicketToUrl,
  applyMediaTicketToPlaybackSession,
  isStreamTicketMintEnabled,
} from './streamTicket';

const mockIsProofAccessTokenEnabled = jest.fn(() => true);

jest.mock('./proofAccessToken', () => ({
  isProofAccessTokenEnabled: (...args) => mockIsProofAccessTokenEnabled(...args),
  getHotPathProofHeaders: jest.fn(),
}));

describe('streamTicket', () => {
  const prev = process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED;

  afterEach(() => {
    process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED = prev;
    mockIsProofAccessTokenEnabled.mockReturnValue(true);
  });

  test('isStreamTicketMintEnabled requires env flag and proof token path', () => {
    mockIsProofAccessTokenEnabled.mockReturnValue(true);
    process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED = '0';
    expect(isStreamTicketMintEnabled()).toBe(false);
    process.env.REACT_APP_STREAM_TICKET_MINT_ENABLED = '1';
    expect(isStreamTicketMintEnabled()).toBe(true);
    mockIsProofAccessTokenEnabled.mockReturnValue(false);
    expect(isStreamTicketMintEnabled()).toBe(false);
  });

  test('attachMediaTicketToUrl adds st query param', () => {
    expect(attachMediaTicketToUrl('/audio/v3/direct/ps_x/stream', 'opaque_abc')).toBe(
      '/audio/v3/direct/ps_x/stream?st=opaque_abc',
    );
    expect(
      attachMediaTicketToUrl('https://api.example/audio/v3/direct/ps_x/stream?foo=1', 't1'),
    ).toBe('https://api.example/audio/v3/direct/ps_x/stream?foo=1&st=t1');
  });

  test('applyMediaTicketToPlaybackSession patches urls and qualities', () => {
    const base = {
      url: '/audio/v3/direct/ps_x/stream',
      masterUrl: '/audio/v3/direct/ps_x/master',
      qualities: [{ tag: 'auto', url: '/audio/v3/direct/ps_x/q/auto' }],
    };
    const next = applyMediaTicketToPlaybackSession(base, 'tok');
    expect(next.url).toContain('st=tok');
    expect(next.masterUrl).toContain('st=tok');
    expect(next.qualities[0].url).toContain('st=tok');
  });
});
