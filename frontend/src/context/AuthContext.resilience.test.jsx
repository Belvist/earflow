import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockApiClient = {
    getUser: jest.fn(),
    verifyToken: jest.fn(),
    refreshSessionNowDetailed: jest.fn(),
    clearLocalSession: jest.fn(),
    clearAuthLostState: jest.fn(),
    onAuthLost: jest.fn(),
    logout: jest.fn(),
};

let mockAuthEventHandler = null;
const mockBroadcastAuthEvent = jest.fn();
const mockRedirectToAuth = jest.fn();

jest.mock('../api/client', () => ({
    __esModule: true,
    default: mockApiClient,
}));

jest.mock('../auth/tabSync', () => ({
    broadcastAuthEvent: (...args) => mockBroadcastAuthEvent(...args),
    subscribeAuthEvents: (handler) => {
        mockAuthEventHandler = handler;
        return () => {
            if (mockAuthEventHandler === handler) mockAuthEventHandler = null;
        };
    },
}));

jest.mock('../utils/authRedirect', () => ({
    clearRecentLogout: jest.fn(),
    markRecentLogout: jest.fn(),
    redirectToAuth: (...args) => mockRedirectToAuth(...args),
    shouldSuppressAuthRedirectAfterLogout: jest.fn(() => false),
}));

const loadAuthContext = async () => await import('./AuthContext');

function Probe({ useAuth }) {
    const auth = useAuth();
    return (
        <div>
            <div data-testid="status">{auth.status}</div>
            <div data-testid="authenticated">{String(auth.isAuthenticated)}</div>
            <div data-testid="user-id">{String(auth.user?.id || auth.user?.userId || '')}</div>
        </div>
    );
}

describe('AuthContext resilience', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthEventHandler = null;
        mockApiClient.onAuthLost.mockReturnValue(() => undefined);
        mockApiClient.getUser.mockReturnValue({ id: 'user-1', username: 'cached' });
    });

    it('keeps cached user degraded when refresh succeeds but profile remains temporarily unavailable', async () => {
        mockApiClient.verifyToken.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
        mockApiClient.refreshSessionNowDetailed.mockResolvedValue({ ok: true, status: 204, state: 'ok' });

        const { AuthProvider, useAuth } = await loadAuthContext();
        render(
            <AuthProvider>
                <Probe useAuth={useAuth} />
            </AuthProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('degraded'));
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('user-id')).toHaveTextContent('user-1');
        expect(mockApiClient.clearLocalSession).not.toHaveBeenCalled();
        expect(mockRedirectToAuth).not.toHaveBeenCalled();
    });

    it('keeps cached user degraded when backend marks refresh auth error recoverable', async () => {
        mockApiClient.verifyToken.mockRejectedValue(Object.assign(new Error('Authentication required'), { status: 401, code: 'SESSION_UNVERIFIED', recoverable: true }));
        mockApiClient.refreshSessionNowDetailed.mockResolvedValue({ ok: false, status: 401, code: 'SESSION_UNVERIFIED', state: 'SESSION_UNVERIFIED', recoverable: true, reauthRequired: false });

        const { AuthProvider, useAuth } = await loadAuthContext();
        render(
            <AuthProvider>
                <Probe useAuth={useAuth} />
            </AuthProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('degraded'));
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('user-id')).toHaveTextContent('user-1');
        expect(mockApiClient.clearLocalSession).not.toHaveBeenCalled();
        expect(mockRedirectToAuth).not.toHaveBeenCalled();
    });

    it('clears local user only when backend explicitly requires reauth', async () => {
        mockApiClient.verifyToken.mockRejectedValue(Object.assign(new Error('Authentication required'), { status: 401, code: 'NO_SESSION', reauthRequired: true }));
        mockApiClient.refreshSessionNowDetailed.mockResolvedValue({ ok: false, status: 401, code: 'NO_SESSION', state: 'NO_SESSION', recoverable: false, reauthRequired: true });

        const { AuthProvider, useAuth } = await loadAuthContext();
        render(
            <AuthProvider>
                <Probe useAuth={useAuth} />
            </AuthProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('guest'));
        expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
        expect(mockApiClient.clearLocalSession).toHaveBeenCalled();
        expect(mockRedirectToAuth).not.toHaveBeenCalled();
    });

    it('revalidates cross-tab session lost events without local logout cascade', async () => {
        mockApiClient.verifyToken.mockResolvedValue({ user: { id: 'user-1', username: 'live' } });
        mockApiClient.refreshSessionNowDetailed.mockResolvedValue({ ok: true, status: 204, state: 'ok' });

        const { AuthProvider, useAuth } = await loadAuthContext();
        render(
            <AuthProvider>
                <Probe useAuth={useAuth} />
            </AuthProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
        expect(typeof mockAuthEventHandler).toBe('function');

        mockAuthEventHandler({ type: 'SESSION_LOST' });

        await waitFor(() => expect(mockApiClient.refreshSessionNowDetailed).toHaveBeenCalled());
        expect(mockApiClient.logout).not.toHaveBeenCalled();
        expect(mockRedirectToAuth).not.toHaveBeenCalled();
        expect(screen.getByTestId('authenticated')).toHaveTextContent('true');
    });
});
