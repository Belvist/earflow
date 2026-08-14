import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

import apiClient from '../api/client';
import { asHttpStatus } from '../api/errors';
import { broadcastAuthEvent, subscribeAuthEvents } from '../auth/tabSync';
import { clearRecentLogout, markRecentLogout, redirectToAuth, shouldSuppressAuthRedirectAfterLogout } from '../utils/authRedirect';

/**
 * Экспорт нужен для playground / тестов. В production используется через useAuth() hook.
 */
export const AuthContext = createContext(null);

let bootstrapInFlight = null;

const AUTH_REFRESH_MIN_TICK_MS = 30_000;
const AUTH_REVALIDATE_INTERVAL_MS = 12 * 60_000;
const AUTH_REFRESH_HIDDEN_CHECK_MS = 60_000;
const AUTH_REFRESH_FOREGROUND_STALE_MS = 10 * 60_000;

const AUTH_STATUSES = {
    BOOTING: 'booting',
    AUTHENTICATED: 'authenticated',
    GUEST: 'guest',
    DEGRADED: 'degraded',
};

const initialState = {
    status: AUTH_STATUSES.BOOTING,
    user: null,
    lastAuthCheckAt: 0,
    lastError: null,
    showLoginModal: false,
};

const hasUser = (user) => !!(user && (user.id || user.userId));

const cachedAuthUser = () => apiClient.getUser?.() || null;

const degradedAuthResult = (status, code, fallbackMessage) => ({
    status: AUTH_STATUSES.DEGRADED,
    user: cachedAuthUser(),
    error: {
        status: Number(status || 0),
        code: code || fallbackMessage,
        message: fallbackMessage || code || 'auth_degraded',
    },
});

const notifyAuthLogoutPlaybackStop = () => {
    if (typeof window === 'undefined') return;
    try {
        window.dispatchEvent(new CustomEvent('earflow:auth:logout'));
    } catch {
        try {
            window.dispatchEvent(new Event('earflow:auth:logout'));
        } catch {
        }
    }
};

const authRefreshDelay = (baseMs) => {
    const base = Number.isFinite(Number(baseMs)) && Number(baseMs) > 0 ? Number(baseMs) : AUTH_REVALIDATE_INTERVAL_MS;
    const jitter = Math.floor(Math.random() * 20_000);
    return Math.max(AUTH_REFRESH_MIN_TICK_MS, base + jitter);
};

const normalizeAuthError = (err, fallback = 'auth_check_failed') => {
    const status = asHttpStatus(err) || 0;
    const code = err && typeof err === 'object' && typeof err.code === 'string' ? err.code : '';
    const message = err && typeof err === 'object' && typeof err.message === 'string' ? err.message : fallback;
    const recoverable = !!(err && typeof err === 'object' && err.recoverable === true);
    const reauthRequired = !!(err && typeof err === 'object' && err.reauthRequired === true);
    return { status, code, message, recoverable, reauthRequired };
};

const isTransientAuthStatus = (status) => {
    const st = Number(status || 0);
    if (!Number.isFinite(st)) return true;
    if (st === 0 || st === 403 || st === 408 || st === 429) return true;
    return st >= 500 && st <= 599;
};

const isBackendReauthRequired = (resultOrError) => {
    if (!resultOrError || typeof resultOrError !== 'object') return false;
    if (resultOrError.reauthRequired === true) return true;
    const code = typeof resultOrError.code === 'string' ? resultOrError.code.trim().toUpperCase() : '';
    return code === 'NO_SESSION'
        || code === 'SESSION_REVOKED'
        || code === 'REFRESH_REVOKED'
        || code === 'DEVICE_PROOF_REQUIRED'
        || code === 'DEVICE_REVOKED';
};

const isBackendRecoverableAuth = (resultOrError) => {
    if (!resultOrError || typeof resultOrError !== 'object') return false;
    if (resultOrError.recoverable === true) return true;
    const code = typeof resultOrError.code === 'string' ? resultOrError.code.trim().toUpperCase() : '';
    return code === 'AUTH_UNAVAILABLE'
        || code === 'CSRF_BAD_ORIGIN'
        || code === 'CSRF_INVALID'
        || code === 'CSRF_MISSING'
        || code === 'CSRF_MISSING_ORIGIN'
        || code === 'SESSION_UNVERIFIED';
};

function authReducer(state, action) {
    switch (action.type) {
        case 'BOOTSTRAP_START':
            return { ...state, status: AUTH_STATUSES.BOOTING, lastError: null };
        case 'AUTHENTICATED':
            return {
                ...state,
                status: AUTH_STATUSES.AUTHENTICATED,
                user: action.user || null,
                lastAuthCheckAt: Date.now(),
                lastError: null,
                showLoginModal: false,
            };
        case 'GUEST':
            return {
                ...state,
                status: AUTH_STATUSES.GUEST,
                user: null,
                lastAuthCheckAt: Date.now(),
                lastError: null,
                showLoginModal: action.showLoginModal === true,
            };
        case 'DEGRADED':
            return {
                ...state,
                status: AUTH_STATUSES.DEGRADED,
                user: hasUser(action.user) ? action.user : state.user,
                lastAuthCheckAt: Date.now(),
                lastError: action.error || null,
                showLoginModal: false,
            };
        case 'LOGIN_FAILED':
            return {
                ...state,
                status: hasUser(state.user) ? state.status : AUTH_STATUSES.GUEST,
                lastError: action.error || null,
            };
        case 'SET_LOGIN_MODAL':
            return { ...state, showLoginModal: action.open === true };
        default:
            return state;
    }
}

async function readProfile(signal) {
    const response = await apiClient.verifyToken({ signal });
    return response && response.user ? response.user : null;
}

async function refreshThenProfile(signal, options = {}) {
    const softRevalidate = options.softRevalidate === true;
    const refreshed = await apiClient.refreshSessionNowDetailed({ signal, broadcastAuthLost: false });
    if (refreshed?.ok) {
        const deviceReady = await ensureDeviceProofReady();
        if (!deviceReady) {
            if (softRevalidate) {
                const cached = cachedAuthUser();
                if (hasUser(cached)) {
                    return degradedAuthResult(0, 'device_register_pending', 'device_register_pending');
                }
            }
            apiClient.clearLocalSession?.();
            return { status: AUTH_STATUSES.GUEST };
        }
        try {
            const user = await readProfile(signal);
            if (hasUser(user)) {
                return { status: AUTH_STATUSES.AUTHENTICATED, user };
            }
            return {
                status: AUTH_STATUSES.DEGRADED,
                user: cachedAuthUser(),
                error: { status: 0, code: 'profile_empty_after_refresh', message: 'profile_empty_after_refresh' },
            };
        } catch (err) {
            const normalized = normalizeAuthError(err, 'profile_after_refresh_failed');
            if (isBackendReauthRequired(normalized)) {
                apiClient.clearLocalSession?.();
                return { status: AUTH_STATUSES.GUEST };
            }
            return {
                status: AUTH_STATUSES.DEGRADED,
                user: cachedAuthUser(),
                error: normalized,
            };
        }
    }

    if (isBackendReauthRequired(refreshed)) {
        // Confirmed dead session (refresh endpoint explicitly says reauth):
        // escalate to GUEST even on soft revalidate. Keeping DEGRADED here put
        // the user in an endless silent 401 loop (isAuthenticated=true but every
        // API call failed) for up to the 12-min revalidate tick.
        apiClient.clearLocalSession?.();
        return { status: AUTH_STATUSES.GUEST };
    }

    if (Number(refreshed?.status || 0) === 401 || isBackendRecoverableAuth(refreshed)) {
        const cached = cachedAuthUser();
        if (hasUser(cached)) {
            return degradedAuthResult(refreshed?.status || 401, refreshed?.code || refreshed?.state || 'session_unverified', refreshed?.state || 'session_unverified');
        }
        apiClient.clearLocalSession?.();
        return { status: AUTH_STATUSES.GUEST };
    }

    return {
        status: AUTH_STATUSES.DEGRADED,
        user: apiClient.getUser?.() || null,
        error: {
            status: refreshed?.status || 0,
            code: refreshed?.state || 'refresh_failed',
            message: refreshed?.state || 'refresh_failed',
        },
    };
}

async function ensureDeviceProofReady() {
    try {
        const reg = await apiClient.ensureAuthDeviceRegistered?.();
        if (reg?.ok === false) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function recoverDeviceProofAndProfile(signal) {
    try {
        const reg = await apiClient.ensureAuthDeviceRegistered?.();
        if (reg?.ok === false) {
            return null;
        }
        const user = await readProfile(signal);
        return hasUser(user) ? user : null;
    } catch {
        return null;
    }
}

async function bootstrapAuthState(options = {}) {
    const signal = options.signal;
    const softRevalidate = options.softRevalidate === true;

    const BOOTSTRAP_DEADLINE_MS = 5000;

    const deadline = new Promise((resolve) => {
        // eslint-disable-next-line no-restricted-globals
        const w = typeof window !== 'undefined' ? window : self;
        const id = w.setTimeout?.(() => {
            const cached = cachedAuthUser();
            if (hasUser(cached)) {
                resolve(degradedAuthResult(0, 'bootstrap_timeout', 'bootstrap_timeout'));
            } else {
                resolve({ status: AUTH_STATUSES.GUEST });
            }
        }, BOOTSTRAP_DEADLINE_MS);
        if (signal) {
            const onAbort = () => { w.clearTimeout?.(id); };
            try { signal.addEventListener('abort', onAbort, { once: true }); } catch {}
        }
    });

    const work = bootstrapAuthStateCore(options);
    return await Promise.race([work, deadline]);
}

async function bootstrapAuthStateCore(options = {}) {
    const signal = options.signal;
    const softRevalidate = options.softRevalidate === true;
    if (options.preferRefresh === true) {
        return await refreshThenProfile(signal, { softRevalidate });
    }

    try {
        const deviceReady = await ensureDeviceProofReady();
        if (!deviceReady) {
            if (softRevalidate) {
                const cached = cachedAuthUser();
                if (hasUser(cached)) {
                    return degradedAuthResult(0, 'device_register_pending', 'device_register_pending');
                }
            }
            apiClient.clearLocalSession?.();
            return { status: AUTH_STATUSES.GUEST };
        }
        const user = await readProfile(signal);
        if (hasUser(user)) {
            return { status: AUTH_STATUSES.AUTHENTICATED, user };
        }
        return { status: AUTH_STATUSES.GUEST };
    } catch (err) {
        const status = asHttpStatus(err) || 0;
        if (status === 401) {
            const code = typeof err?.code === 'string' ? err.code.trim().toUpperCase() : '';
            if (code === 'DEVICE_PROOF_REQUIRED' || code === 'DEVICE_REVOKED') {
                const recovered = await recoverDeviceProofAndProfile(signal);
                if (hasUser(recovered)) {
                    return { status: AUTH_STATUSES.AUTHENTICATED, user: recovered };
                }
                if (softRevalidate) {
                    const cached = cachedAuthUser();
                    if (hasUser(cached)) {
                        return degradedAuthResult(401, code, code);
                    }
                }
                apiClient.clearLocalSession?.();
                return { status: AUTH_STATUSES.GUEST };
            }
            return await refreshThenProfile(signal, { softRevalidate });
        }
        if (isTransientAuthStatus(status)) {
            return {
                status: AUTH_STATUSES.DEGRADED,
                user: apiClient.getUser?.() || null,
                error: normalizeAuthError(err, 'profile_failed'),
            };
        }
        return {
            status: AUTH_STATUSES.DEGRADED,
            user: apiClient.getUser?.() || null,
            error: normalizeAuthError(err, 'profile_failed'),
        };
    }
}

function applyAuthResult(dispatch, result, options = {}) {
    if (result?.status === AUTH_STATUSES.AUTHENTICATED && hasUser(result.user)) {
        clearRecentLogout();
        dispatch({ type: 'AUTHENTICATED', user: result.user });
        return true;
    }
    if (result?.status === AUTH_STATUSES.GUEST) {
        dispatch({ type: 'GUEST', showLoginModal: options.showLoginModal === true });
        return false;
    }
    dispatch({
        type: 'DEGRADED',
        user: result?.user,
        error: result?.error || { status: 0, message: 'auth_degraded' },
    });
    return false;
}

export function AuthProvider({ children }) {
    const [state, dispatch] = useReducer(authReducer, initialState);

    const stateRef = useRef(state);
    const authEpochRef = useRef(0);
    const rehydrateInFlightRef = useRef(null);
    const authLostRecoverRef = useRef(false);
    const lastRevalidateAtRef = useRef(0);

    const consumeTelegramAuthResult = useCallback(async () => {
        if (typeof window === 'undefined') return null;
        let raw = '';
        try {
            const query = new URLSearchParams(window.location.search);
            raw = query.get('tgAuthResult') || '';
            if (!raw) {
                const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
                raw = hash.get('tgAuthResult') || '';
            }
        } catch {
            raw = '';
        }
        if (!raw) return null;

        let payload = null;
        try {
            payload = JSON.parse(decodeURIComponent(raw));
        } catch {
            payload = null;
        }
        if (!payload || typeof payload !== 'object') return null;

        try {
            const cleaned = window.location.href.replace(/([?&])tgAuthResult=[^&#]*/, '$1');
            window.history.replaceState({}, '', cleaned);
        } catch {
        }

        try {
            return await apiClient.loginWithTelegram(payload);
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    const runAuthCheck = useCallback(async (options = {}) => {
        const epochAtStart = authEpochRef.current;
        const useSharedBootstrap = options.softRevalidate !== true;
        const task = (async () => {
            if (useSharedBootstrap && bootstrapInFlight) {
                return await bootstrapInFlight;
            }
            const pending = bootstrapAuthState(options);
            if (useSharedBootstrap) {
                bootstrapInFlight = pending.finally(() => {
                    bootstrapInFlight = null;
                });
                return await bootstrapInFlight;
            }
            return await pending;
        })();

        const result = await task;
        if (authEpochRef.current !== epochAtStart) {
            return { status: stateRef.current.status, user: stateRef.current.user, stale: true };
        }
        lastRevalidateAtRef.current = Date.now();
        return result;
    }, []);

    useEffect(() => {
        if (state.status !== AUTH_STATUSES.BOOTING) return;

        let disposed = false;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

        dispatch({ type: 'BOOTSTRAP_START' });
        consumeTelegramAuthResult()
            .then(() => {
                if (disposed) return;
                return runAuthCheck({ signal: controller?.signal });
            })
            .then((result) => {
                if (disposed) return;
                applyAuthResult(dispatch, result);
            })
            .catch((err) => {
                if (disposed) return;
                dispatch({
                    type: 'DEGRADED',
                    user: apiClient.getUser?.() || null,
                    error: normalizeAuthError(err, 'bootstrap_failed'),
                });
            });

        return () => {
            disposed = true;
            try {
                controller?.abort?.();
            } catch {
            }
        };
    }, [consumeTelegramAuthResult, runAuthCheck, state.status]);

    const revalidateSession = useCallback(async (options = {}) => {
        const isBootstrap = stateRef.current.status === AUTH_STATUSES.BOOTING;
        const softRevalidate = !isBootstrap;
        const result = await runAuthCheck({
            signal: options.signal,
            preferRefresh: options.preferRefresh === true || softRevalidate,
            softRevalidate,
        });
        const ok = applyAuthResult(dispatch, result, { showLoginModal: options.showLoginModal === true });
        if (ok && options.broadcastRefresh === true) {
            broadcastAuthEvent('REFRESH_SUCCESS');
        }
        return ok;
    }, [runAuthCheck]);

    useEffect(() => {
        const shouldRun = state.status === AUTH_STATUSES.AUTHENTICATED || (state.status === AUTH_STATUSES.DEGRADED && hasUser(state.user));
        if (!shouldRun) return;
        if (typeof window === 'undefined') return;

        let disposed = false;
        let timerId = 0;
        let controller = null;
        let lastNudgeAt = 0;
        let lastHiddenAt = 0;

        const schedule = (ms) => {
            if (disposed) return;
            if (timerId) {
                window.clearTimeout(timerId);
                timerId = 0;
            }
            timerId = window.setTimeout(tick, ms);
        };

        const tick = async () => {
            if (disposed) return;
            const current = stateRef.current;
            const active = current.status === AUTH_STATUSES.AUTHENTICATED || (current.status === AUTH_STATUSES.DEGRADED && hasUser(current.user));
            if (!active) return;

            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                schedule(AUTH_REFRESH_HIDDEN_CHECK_MS);
                return;
            }

            controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
            await revalidateSession({
                signal: controller?.signal,
                broadcastRefresh: true,
            }).catch(() => undefined);
            controller = null;
            schedule(authRefreshDelay(AUTH_REVALIDATE_INTERVAL_MS));
        };

        const eagerRevalidate = () => {
            if (disposed) return;
            const now = Date.now();
            if (now - lastNudgeAt < AUTH_REFRESH_MIN_TICK_MS) return;
            lastNudgeAt = now;
            const staleMs = now - (lastRevalidateAtRef.current || 0);
            if (staleMs < AUTH_REFRESH_FOREGROUND_STALE_MS) {
                schedule(1000);
                return;
            }
            schedule(250);
        };

        const onVisibilityChange = () => {
            const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';
            const now = Date.now();
            if (!isVisible) {
                lastHiddenAt = now;
                return;
            }
            const hiddenDurationMs = lastHiddenAt > 0 ? Math.max(0, now - lastHiddenAt) : 0;
            if (hiddenDurationMs >= 60_000) {
                eagerRevalidate();
            }
        };

        try {
            window.addEventListener('focus', eagerRevalidate, { passive: true });
            document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
        } catch {
        }

        schedule(authRefreshDelay(AUTH_REVALIDATE_INTERVAL_MS));

        return () => {
            disposed = true;
            if (timerId) {
                window.clearTimeout(timerId);
                timerId = 0;
            }
            try {
                controller?.abort?.();
            } catch {
            }
            try {
                window.removeEventListener('focus', eagerRevalidate);
                document.removeEventListener('visibilitychange', onVisibilityChange);
            } catch {
            }
        };
    }, [revalidateSession, state.status, state.user]);

    const rehydrateSession = useCallback(async () => {
        if (rehydrateInFlightRef.current) {
            return await Promise.resolve(rehydrateInFlightRef.current);
        }

        const task = revalidateSession({ preferRefresh: true, broadcastRefresh: true });
        rehydrateInFlightRef.current = task.finally(() => {
            rehydrateInFlightRef.current = null;
        });

        return await Promise.resolve(rehydrateInFlightRef.current);
    }, [revalidateSession]);

    useEffect(() => {
        let disposed = false;
        const unsubscribe = apiClient.onAuthLost(async () => {
            if (authLostRecoverRef.current) return;
            authLostRecoverRef.current = true;

            try {
                if (shouldSuppressAuthRedirectAfterLogout()) {
                    apiClient.clearAuthLostState?.();
                    return;
                }

                // Recovery must hit the server for a definitive answer: a 60s
                // backoff (or <1s throttle) inherited from the failed refresh
                // would classify the rehydrate as transient and keep the user in
                // DEGRADED with every API call failing for ~12 min.
                apiClient.resetRefreshBackoff?.();

                const ok = await rehydrateSession();
                if (disposed) return;
                if (ok) {
                    apiClient.clearAuthLostState?.();
                    return;
                }

                const current = stateRef.current;
                if (current.status === AUTH_STATUSES.GUEST) {
                    broadcastAuthEvent('SESSION_LOST');
                    redirectToAuth({ reason: 'auth_lost', replace: true });
                } else {
                    apiClient.clearAuthLostState?.();
                }
            } finally {
                authLostRecoverRef.current = false;
            }
        });

        return () => {
            disposed = true;
            try {
                unsubscribe();
            } catch {
            }
        };
    }, [rehydrateSession]);

    useEffect(() => {
        return subscribeAuthEvents((event) => {
            const type = String(event?.type || '');
            if (type === 'LOGOUT') {
                authEpochRef.current += 1;
                markRecentLogout();
                notifyAuthLogoutPlaybackStop();
                void apiClient.logout({ localOnly: true });
                dispatch({ type: 'GUEST', showLoginModal: false });
                return;
            }

            if (type === 'SESSION_LOST') {
                if (shouldSuppressAuthRedirectAfterLogout()) return;
                apiClient.clearAuthLostState?.();
                void revalidateSession({ preferRefresh: true, showLoginModal: false }).catch(() => undefined);
                return;
            }

            if (type === 'LOGIN_SUCCESS' || type === 'REFRESH_SUCCESS') {
                clearRecentLogout();
                void revalidateSession({ showLoginModal: false }).catch(() => undefined);
            }
        });
    }, [revalidateSession]);

    const finishInteractiveAuth = useCallback(async (authCall, fallbackMessage) => {
        dispatch({ type: 'SET_LOGIN_MODAL', open: false });
        try {
            await authCall();
            const verified = await apiClient.verifyToken();
            if (!verified || !hasUser(verified.user)) {
                throw new Error('Session not established');
            }
            authEpochRef.current += 1;
            clearRecentLogout();
            dispatch({ type: 'AUTHENTICATED', user: verified.user });
            broadcastAuthEvent('LOGIN_SUCCESS');
            return verified;
        } catch (err) {
            const normalized = normalizeAuthError(err, fallbackMessage);
            dispatch({ type: 'LOGIN_FAILED', error: normalized });
            throw new Error(normalized.message || fallbackMessage);
        }
    }, []);

    const loginWithTelegram = useCallback(async (payload) => {
        return await finishInteractiveAuth(
            () => apiClient.loginWithTelegram(payload),
            'Login failed',
        );
    }, [finishInteractiveAuth]);

    const loginWithEmail = useCallback(async (email, password) => {
        return await finishInteractiveAuth(
            () => apiClient.loginWithEmail(email, password),
            'Login failed',
        );
    }, [finishInteractiveAuth]);

    const registerWithEmail = useCallback(async (email, password, firstName, username) => {
        return await finishInteractiveAuth(
            () => apiClient.registerWithEmail(email, password, firstName, username),
            'Registration failed',
        );
    }, [finishInteractiveAuth]);

    const openLoginModal = useCallback(() => {
        clearRecentLogout();
        dispatch({ type: 'SET_LOGIN_MODAL', open: false });
        redirectToAuth({ reason: 'login_required', replace: true });
    }, []);

    const closeLoginModal = useCallback(() => {
        dispatch({ type: 'SET_LOGIN_MODAL', open: false });
    }, []);

    const logout = useCallback(async () => {
        authEpochRef.current += 1;
        markRecentLogout();
        notifyAuthLogoutPlaybackStop();
        await apiClient.logout();
        dispatch({ type: 'GUEST', showLoginModal: false });
        broadcastAuthEvent('LOGOUT');
    }, []);

    const refreshUser = useCallback(async (options = {}) => {
        const profile = await apiClient.getProfile(options);
        if (hasUser(profile)) {
            dispatch({ type: 'AUTHENTICATED', user: profile });
        }
        return profile;
    }, []);

    const isAuthenticated = state.status === AUTH_STATUSES.AUTHENTICATED || (state.status === AUTH_STATUSES.DEGRADED && hasUser(state.user));
    const loading = state.status === AUTH_STATUSES.BOOTING;
    const error = state.lastError ? (state.lastError.message || String(state.lastError.code || '')) : null;

    const value = useMemo(() => {
        return {
            status: state.status,
            isAuthenticated,
            isDegraded: state.status === AUTH_STATUSES.DEGRADED,
            user: state.user,
            loading,
            error,
            loginWithEmail,
            loginWithTelegram,
            registerWithEmail,
            logout,
            refreshUser,
            rehydrateSession,
            authReady: !loading,
            showLoginModal: state.showLoginModal,
            openLoginModal,
            closeLoginModal,
        };
    }, [state.status, state.user, state.showLoginModal, isAuthenticated, loading, error, loginWithEmail, loginWithTelegram, registerWithEmail, logout, refreshUser, rehydrateSession, openLoginModal, closeLoginModal]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error('useAuth must be used within AuthProvider');
    }
    return ctx;
}
