import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { clearAuthDeviceState } from '../../auth/authDeviceCrypto';
import { ensureAuthDeviceRegistered } from '../../auth/authDeviceRegister';
import { clearProofAccessToken } from '../../auth/proofAccessToken';
import { authApi } from '../../transport/authApi';
import { artistPortalApi } from '../../transport/artistPortalApi';

const AuthContext = createContext(null);
const AUTH_CACHE_KEY = 'artistAuthState';

const hasUser = (value) => !!(value && typeof value === 'object' && (value.id || value.userId));

const readCachedAuth = () => {
    try {
        if (typeof localStorage === 'undefined') return { user: null, portal: null };
        const raw = localStorage.getItem(AUTH_CACHE_KEY);
        if (!raw) return { user: null, portal: null };
        const parsed = JSON.parse(raw);
        return {
            user: hasUser(parsed?.user) ? parsed.user : null,
            portal: parsed?.portal && typeof parsed.portal === 'object' ? parsed.portal : null,
        };
    } catch {
        return { user: null, portal: null };
    }
};

const writeCachedAuth = (nextUser, nextPortal) => {
    try {
        if (typeof localStorage === 'undefined') return;
        if (!hasUser(nextUser)) {
            localStorage.removeItem(AUTH_CACHE_KEY);
            return;
        }
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ user: nextUser, portal: nextPortal || null }));
    } catch {
    }
};

const clearCachedAuth = () => writeCachedAuth(null, null);

const clearLocalAuthSecrets = () => {
    void clearAuthDeviceState();
    clearProofAccessToken();
};

const normalizeAuthCode = (code) => (typeof code === 'string' ? code.trim().toUpperCase() : '');

const isBackendReauthRequired = (err) => {
    if (!err || typeof err !== 'object') return false;
    if (err.reauthRequired === true) return true;
    const code = normalizeAuthCode(err.code || err.data?.code);
    return code === 'NO_SESSION' || code === 'SESSION_REVOKED' || code === 'REFRESH_REVOKED';
};

const isBackendRecoverable = (err) => {
    if (!err || typeof err !== 'object') return false;
    if (err.recoverable === true) return true;
    const code = normalizeAuthCode(err.code || err.data?.code);
    return code === 'AUTH_UNAVAILABLE'
        || code === 'SESSION_UNVERIFIED'
        || code === 'CSRF_BAD_ORIGIN'
        || code === 'CSRF_INVALID'
        || code === 'CSRF_MISSING'
        || code === 'CSRF_MISSING_ORIGIN';
};

const isTransientStatus = (status) => {
    const st = Number(status || 0);
    if (!Number.isFinite(st)) return true;
    if (st === 0 || st === 403 || st === 408 || st === 429) return true;
    return st >= 500 && st <= 599;
};

const defaultPortalState = (isAdmin) => ({ isArtist: false, isAdmin, artistName: null, artistPublicId: null, mfa: null });

export function AuthProvider({ children }) {
    const cachedInitial = useMemo(() => readCachedAuth(), []);
    const [status, setStatus] = useState('loading');
    const [user, setUser] = useState(cachedInitial.user);
    const [portal, setPortal] = useState(cachedInitial.portal);
    const refreshTimerRef = useRef(0);
    const bootstrapRef = useRef(null);
    const statusRef = useRef('loading');
    const userRef = useRef(cachedInitial.user);
    const portalRef = useRef(cachedInitial.portal);

    const applyGuest = useCallback(() => {
        clearCachedAuth();
        clearLocalAuthSecrets();
        setUser(null);
        setPortal(null);
        userRef.current = null;
        portalRef.current = null;
        statusRef.current = 'guest';
        setStatus('guest');
    }, []);

    const applyDegraded = useCallback(() => {
        const cached = readCachedAuth();
        const nextUser = hasUser(userRef.current) ? userRef.current : cached.user;
        const nextPortal = portalRef.current || cached.portal;
        if (hasUser(nextUser)) {
            setUser(nextUser);
            setPortal(nextPortal);
            userRef.current = nextUser;
            portalRef.current = nextPortal;
        }
        statusRef.current = 'degraded';
        setStatus('degraded');
    }, []);

    const applyAuthenticated = useCallback((nextUser, nextPortal) => {
        setUser(nextUser);
        setPortal(nextPortal);
        userRef.current = nextUser;
        portalRef.current = nextPortal;
        writeCachedAuth(nextUser, nextPortal);
        statusRef.current = 'authenticated';
        setStatus('authenticated');
    }, []);

    const stopRefreshLoop = useCallback(() => {
        const t = refreshTimerRef.current;
        refreshTimerRef.current = 0;
        if (t) {
            try {
                window.clearTimeout(t);
            } catch {
            }
        }
    }, []);

    const scheduleRefresh = useCallback((ms) => {
        stopRefreshLoop();
        refreshTimerRef.current = window.setTimeout(async () => {
            try {
                await authApi.refresh();
                if (statusRef.current === 'degraded') {
                    const runBootstrap = bootstrapRef.current;
                    if (typeof runBootstrap === 'function') {
                        await runBootstrap();
                    }
                }
            } catch (err) {
                if (isBackendReauthRequired(err)) {
                    applyGuest();
                    return;
                }
                applyDegraded();
            }
            scheduleRefresh(4 * 60_000);
        }, ms);
    }, [applyDegraded, applyGuest, stopRefreshLoop]);

    const bootstrap = useCallback(async () => {
        statusRef.current = 'loading';
        setStatus('loading');

        try {
            const profile = await authApi.profile();
            const safeProfile = profile && typeof profile === 'object' ? profile : null;

            if (!safeProfile || !(safeProfile.id || safeProfile.userId)) {
                applyGuest();
                return;
            }

            let portalMe = null;
            let portalErr = null;
            try {
                const rawPortal = await artistPortalApi.me();
                portalMe = rawPortal && typeof rawPortal === 'object' ? rawPortal : null;
            } catch (err) {
                portalErr = err;
                portalMe = null;
            }

            if (isBackendReauthRequired(portalErr)) {
                applyGuest();
                return;
            }

            const isAdmin = safeProfile.isAdmin === true || portalMe?.isAdmin === true;
            const cachedPortal = portalRef.current || readCachedAuth().portal;
            const mergedPortal = portalMe
                ? { ...portalMe, isAdmin }
                : cachedPortal
                    ? { ...cachedPortal, isAdmin: cachedPortal.isAdmin === true || safeProfile.isAdmin === true }
                    : defaultPortalState(isAdmin);

            applyAuthenticated(safeProfile, mergedPortal);
            void ensureAuthDeviceRegistered().catch(() => undefined);
            scheduleRefresh(4 * 60_000);
            if (portalErr && (isBackendRecoverable(portalErr) || isTransientStatus(portalErr?.status))) {
                applyDegraded();
            }
        } catch (err) {
            if (isBackendReauthRequired(err)) {
                applyGuest();
                return;
            }
            if (Number(err?.status || 0) === 401) {
                try {
                    await authApi.refresh();
                    const profile = await authApi.profile();
                    const safeProfile = profile && typeof profile === 'object' ? profile : null;
                    if (hasUser(safeProfile)) {
                        let portalMe = null;
                        let portalErr = null;
                        try {
                            const rawPortal = await artistPortalApi.me();
                            portalMe = rawPortal && typeof rawPortal === 'object' ? rawPortal : null;
                        } catch (err) {
                            portalErr = err;
                            portalMe = null;
                        }
                        if (isBackendReauthRequired(portalErr)) {
                            applyGuest();
                            return;
                        }
                        const isAdmin = safeProfile.isAdmin === true || portalMe?.isAdmin === true;
                        const cachedPortal = portalRef.current || readCachedAuth().portal;
                        const mergedPortal = portalMe
                            ? { ...portalMe, isAdmin }
                            : cachedPortal
                                ? { ...cachedPortal, isAdmin: cachedPortal.isAdmin === true || safeProfile.isAdmin === true }
                                : defaultPortalState(isAdmin);
                        applyAuthenticated(safeProfile, mergedPortal);
                        void ensureAuthDeviceRegistered().catch(() => undefined);
                        scheduleRefresh(4 * 60_000);
                        if (portalErr && (isBackendRecoverable(portalErr) || isTransientStatus(portalErr?.status))) {
                            applyDegraded();
                        }
                        return;
                    }
                } catch (refreshErr) {
                    if (isBackendReauthRequired(refreshErr)) {
                        applyGuest();
                        return;
                    }
                }
                applyDegraded();
                scheduleRefresh(60_000);
                return;
            }
            if (isBackendRecoverable(err) || isTransientStatus(err?.status)) {
                applyDegraded();
                scheduleRefresh(60_000);
                return;
            }
            applyDegraded();
            scheduleRefresh(60_000);
        }
    }, [applyAuthenticated, applyDegraded, applyGuest, scheduleRefresh]);

    useEffect(() => {
        bootstrapRef.current = bootstrap;
    }, [bootstrap]);

    useEffect(() => {
        bootstrap();
        return () => {
            stopRefreshLoop();
        };
    }, [bootstrap, stopRefreshLoop]);

    const login = useCallback(async ({ email, password }) => {
        await authApi.login({ email, password });
        await bootstrap();
    }, [bootstrap]);

    const loginWithTelegram = useCallback(async (payload) => {
        await authApi.telegramLogin(payload);
        await bootstrap();
    }, [bootstrap]);

    const register = useCallback(async ({ email, password, firstName, lastName }) => {
        await authApi.register({ email, password, firstName, lastName });
        await bootstrap();
    }, [bootstrap]);

    const logout = useCallback(async () => {
        stopRefreshLoop();
        try {
            await authApi.logout();
        } catch {
        }
        applyGuest();
    }, [applyGuest, stopRefreshLoop]);

    const refreshPortal = useCallback(async () => {
        try {
            const rawPortal = await artistPortalApi.me();
            const portalMe = rawPortal && typeof rawPortal === 'object' ? rawPortal : null;
            if (!portalMe) return;
            const isAdmin = user?.isAdmin === true || portalMe?.isAdmin === true;
            const nextPortal = { ...portalMe, isAdmin };
            setPortal(nextPortal);
            portalRef.current = nextPortal;
            writeCachedAuth(userRef.current, nextPortal);
        } catch {
        }
    }, [user]);

    const value = useMemo(() => ({
        status,
        user,
        portal,
        login,
        loginWithTelegram,
        register,
        logout,
        refresh: bootstrap,
        refreshPortal,
    }), [login, loginWithTelegram, register, logout, portal, status, user, bootstrap, refreshPortal]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const v = useContext(AuthContext);
    if (!v) {
        throw new Error('AuthContext is not mounted');
    }
    return v;
}
