/**
 * API Client для взаимодействия с backend микросервисами
 */

import { AuthExpiredError, HttpError } from './errors';
import { LruCache } from './lruCache';
import { HttpClient } from './httpClient';
import { createApiHttpClient, createApiHttpClientRaw } from './http/createApiHttpClient';
import { normalizeHttpStatus, attachLegacyStatusFields } from './http/legacyStatus';
import { readJsonBody } from './http/readJsonBody';
import { API_BASE_URL, STREAMING_BASE_URL, runtimeOrigin } from './runtimeConfig';
import { base64ToBytes } from '../utils/base64';
import { getCookieValue, getCsrfToken } from '../auth/cookieHelpers';
import { classifyRefreshResult, runRefresh } from '../auth/refreshManager';
import {
  clearAuthDeviceState,
  getAuthDeviceHeaders,
  isDeviceProofEnforced,
  persistAuthDeviceRecord,
  signDeviceProofRequest,
} from '../auth/authDeviceCrypto';
import { clearProofAccessToken } from '../auth/proofAccessToken';
import { attachMediaTicketToDirectSession, clearStreamTicketCache } from '../auth/streamTicket';

const REAUTH_REQUIRED_REFRESH_CODES = new Set([
  'NO_SESSION',
  'SESSION_REVOKED',
  'REFRESH_REVOKED',
  'DEVICE_PROOF_REQUIRED',
  'DEVICE_REVOKED',
]);

const normalizeRefreshCode = (code) => (typeof code === 'string' ? code.trim().toUpperCase() : '');

const deriveCoverOrigin = () => {
  const base = (API_BASE_URL || '').toString().trim();
  if (base === '/api' || base.endsWith('/api')) {
    return runtimeOrigin || '';
  }
  return base;
};

// Кеш URL обложек для предотвращения повторных вычислений
const coverUrlCache = new LruCache({ maxEntries: 500, ttlMs: 30 * 60 * 1000 });

const decodeUtf8 = (buf) => {
  try {
    return new TextDecoder().decode(buf);
  } catch {
    return '';
  }
};

const getWebCrypto = () => {
  if (typeof window !== 'undefined' && window.crypto?.subtle) return window.crypto;
  return null;
};

const decryptEbapLyricsPayload = async (arrayBuffer, keyB64) => {
  const b = arrayBuffer instanceof ArrayBuffer ? new Uint8Array(arrayBuffer) : null;
  if (!b || b.byteLength < 6) return null;

  if (b[0] !== 0x45 || b[1] !== 0x42 || b[2] !== 0x4c || b[3] !== 0x59) return null;
  if (b[4] !== 0x01) return null;

  const ivLen = b[5];
  const ivStart = 6;
  const ctStart = ivStart + ivLen;
  if (ivLen <= 0 || ctStart >= b.byteLength) return null;

  const iv = b.slice(ivStart, ctStart);
  const data = b.slice(ctStart);
  if (data.byteLength < 17) return null;

  const webCrypto = getWebCrypto();
  if (!webCrypto) return null;

  let keyBytes;
  try {
    keyBytes = base64ToBytes(String(keyB64 || ''));
  } catch {
    return null;
  }
  if (!(keyBytes instanceof Uint8Array) || keyBytes.byteLength !== 32) return null;

  try {
    const key = await webCrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    const plainBuf = await webCrypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    const text = decodeUtf8(plainBuf);
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
};

class ApiClient {
  constructor() {
    this.baseUrl = API_BASE_URL;
    this.streamingBaseUrl = STREAMING_BASE_URL;
    this._hasSession = false;
    this._refreshCoreInFlight = null;
    this._lastRefreshAttemptAt = 0;
    this._lastRefreshOkAt = 0;
    this._refreshBackoffUntilAt = 0;
    this._authLostAt = 0;
    this._authLostListeners = new Set();
    this._streamingAuthCooldownUntilAt = 0;

    this._hlsSessionCooldownUntilAt = 0;
    this._hlsSessionInFlight = new Map();
    this._hlsSessionCache = new LruCache({ maxEntries: 200, ttlMs: 20 * 1000 });

    this._directSessionCooldownUntilAt = 0;
    this._directSessionInFlight = new Map();
    this._directSessionCache = new LruCache({ maxEntries: 200, ttlMs: 20 * 1000 });

    this._lyricsSessionCache = new LruCache({ maxEntries: 200, ttlMs: 20 * 1000 });

    this._streamingHttpClient = new HttpClient({ defaultTimeoutMs: 15_000 });
    this._apiHttpClient = createApiHttpClient({
      defaultTimeoutMs: 15_000,
      isAuthLostActive: () => this._isAuthLostActive(),
      shouldBroadcastAuthLost: (endpoint) => this._shouldBroadcastAuthLost(endpoint),
      handleAuthLost: (source) => this._handleAuthLost(source),
      refreshSession: (opts = {}) => this._refreshSession({ broadcastAuthLost: true, signal: opts.signal }),
      reportClientError: (payload) => this.logClientError(payload).catch(() => undefined),
      getCsrfToken: () => this._getCsrfTokenValue(),
      ensureCsrfCookie: (opts) => this._ensureCsrfCookie(opts),
      ensureAuthDeviceRegistered: (opts) => this.ensureAuthDeviceRegistered(opts),
    });

    this._apiHttpClientRaw = createApiHttpClientRaw({
      defaultTimeoutMs: 15_000,
      isAuthLostActive: () => this._isAuthLostActive(),
      shouldBroadcastAuthLost: (endpoint) => this._shouldBroadcastAuthLost(endpoint),
      handleAuthLost: (source) => this._handleAuthLost(source),
      refreshSession: (opts = {}) => this._refreshSession({ broadcastAuthLost: true, signal: opts.signal }),
      reportClientError: (payload) => this.logClientError(payload).catch(() => undefined),
      getCsrfToken: () => this._getCsrfTokenValue(),
      ensureCsrfCookie: (opts) => this._ensureCsrfCookie(opts),
      ensureAuthDeviceRegistered: (opts) => this.ensureAuthDeviceRegistered(opts),
    });

    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('auth_token');
      }
    } catch {
      // ignore
    }
  }

  _isAuthLostActive() {
    const at = this._authLostAt || 0;
    if (!at) return false;
    return Date.now() - at < 15 * 1000;
  }

  _isStreamingAuthCooldownActive() {
    const until = this._streamingAuthCooldownUntilAt || 0;
    if (!until) return false;
    return Date.now() < until;
  }

  _getSupportedCodecs() {
    if (this._cachedSupportedCodecs) return this._cachedSupportedCodecs;
    try {
      const { getSupportedCodecs } = require('../playback/CodecCapabilities');
      this._cachedSupportedCodecs = getSupportedCodecs();
    } catch {
      this._cachedSupportedCodecs = ['aac'];
    }
    return this._cachedSupportedCodecs;
  }

  _markStreamingAuthCooldown(ms) {
    const dur = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : 60 * 1000;
    this._streamingAuthCooldownUntilAt = Date.now() + dur;
  }

  _markSessionActive() {
    this._hasSession = true;
    this._authLostAt = 0;
    this._refreshBackoffUntilAt = 0;
    this._streamingAuthCooldownUntilAt = 0;
  }

  _artistPortalOnlyError() {
    const err = new Error('Загрузка и управление треками доступны только через кабинет артиста.');
    err.status = 403;
    err.responseStatus = 403;
    err.code = 'ARTIST_PORTAL_ONLY';
    return err;
  }

  clearAuthLostState() {
    this._authLostAt = 0;
  }

  _shouldBroadcastAuthLost(endpoint) {
    const ep = typeof endpoint === 'string' ? endpoint : '';
    return ep === '/api/profile' || ep === '/api/auth/profile';
  }

  async _fetchStreamingJson(path, options = {}) {
    const url = `${this.streamingBaseUrl}${path}`;

    if (!options.skipAuth && (this._isAuthLostActive() || this._isStreamingAuthCooldownActive())) {
      throw attachLegacyStatusFields(new AuthExpiredError(401), 401);
    }

    const makeRequest = async (headers) => {
      const resp = await this._streamingHttpClient.requestRaw({
        url,
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers,
        signal: options.signal,
        retry: { enabled: true, maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 2000 },
      });

      if (!resp.ok) {
        const st = normalizeHttpStatus(resp.status);
        const err = st === 401 ? new AuthExpiredError(st) : new HttpError(st);
        throw attachLegacyStatusFields(err, st);
      }

      const contentLength = resp.headers.get('content-length');
      if (contentLength === '0') return null;
      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return null;
      return await resp.json();
    };

    try {
      return await makeRequest({});
    } catch (e) {
      const status = e && typeof e === 'object' ? e.status : null;
      if (status !== 401) {
        throw e;
      }

      const refreshed = await this._refreshSession({ broadcastAuthLost: false });
      if (!refreshed) {
        this._markStreamingAuthCooldown(5 * 1000);
        throw e;
      }

      try {
        return await makeRequest({});
      } catch (e2) {
        const status2 = e2 && typeof e2 === 'object' ? e2.status : null;
        if (status2 === 401) {
          this._markStreamingAuthCooldown(5 * 1000);
        }
        throw e2;
      }
    }
  }

  async _fetchStreamingJsonResult(path, options = {}) {
    const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl : '';
    const effectiveBaseUrl = baseUrl || this.streamingBaseUrl;
    const url = `${effectiveBaseUrl}${path}`;

    const makeRequest = async (headers) => {
      const resp = await this._streamingHttpClient.requestRaw({
        url,
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        headers: {
          ...headers,
          'Accept': 'application/json',
        },
        signal: options.signal,
        retry: { enabled: true, maxAttempts: 3, baseDelayMs: 300, maxDelayMs: 2000 },
      });

      const data = await readJsonBody(resp);
      return { ok: resp.ok, status: resp.status, data };
    };

    if (!options.skipAuth && (this._isAuthLostActive() || this._isStreamingAuthCooldownActive())) {
      return { ok: false, status: 401, data: null };
    }

    const first = await makeRequest({});
    if (options.skipAuth) {
      return first;
    }

    if (first.status !== 401 && first.status !== 403) {
      return first;
    }

    // Try refreshing once for stale browser/session cookies.
    const refreshed = await this._refreshSession({ broadcastAuthLost: false });
    if (!refreshed) {
      this._markStreamingAuthCooldown(5 * 1000);
      return first;
    }

    const second = await makeRequest({});
    if (second.status === 401 || second.status === 403) {
      this._markStreamingAuthCooldown(5 * 1000);
    }
    return second;
  }

  async _clearBrowserCaches() {
    try {
      if (typeof caches === 'undefined') return;
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {
      // ignore
    }
  }

  _getCookieValue(name) {
    return getCookieValue(name);
  }

  _getCsrfTokenValue() {
    return getCsrfToken();
  }

  _resolvePlaybackUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const base = s.startsWith('/audio/') || s.startsWith('/media/')
      ? (this.streamingBaseUrl || runtimeOrigin || this.baseUrl || '')
      : s.startsWith('/api/')
        ? (this.baseUrl || runtimeOrigin || '')
        : (this.streamingBaseUrl || this.baseUrl || runtimeOrigin || '');
    try {
      return new URL(s, base).toString();
    } catch {
      return s;
    }
  }

  _isSafeMethod(method) {
    const m = String(method || 'GET').toUpperCase();
    return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
  }

  async _ensureCsrfCookie(options = {}) {
    const force = options?.force === true;
    const current = this._getCsrfTokenValue();
    if (current && !force) return current;

    try {
      const url = `${this.baseUrl}/api/auth/csrf`;
      await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });
    } catch {
      // ignore
    }

    return this._getCsrfTokenValue() || current || null;
  }

  async _resolveDeviceProofHeaders(method, url) {
    if (!isDeviceProofEnforced()) return {};
    let headers = await getAuthDeviceHeaders(method, url);
    if (!headers || Object.keys(headers).length === 0) {
      await this.ensureAuthDeviceRegistered().catch(() => undefined);
      headers = await getAuthDeviceHeaders(method, url);
    }
    return headers && typeof headers === 'object' ? headers : {};
  }

  async _refreshSessionCore(options = {}) {
    const signal = options && options.signal ? options.signal : undefined;
    return await runRefresh(async () => {
      const now = Date.now();

      if (this._refreshBackoffUntilAt && now < this._refreshBackoffUntilAt) {
        return { ...classifyRefreshResult({ ok: false, status: 0 }), backoff: true };
      }

      if (now - (this._lastRefreshAttemptAt || 0) < 1000) {
        if (now - (this._lastRefreshOkAt || 0) < 15000) {
          return { ...classifyRefreshResult({ ok: true, status: 204 }), cached: true };
        }
        return { ...classifyRefreshResult({ ok: false, status: 0 }), throttled: true };
      }

      this._lastRefreshAttemptAt = now;

      try {
        const url = `${this.baseUrl}/api/auth/refresh`;
        let csrf = this._getCsrfTokenValue() || (await this._ensureCsrfCookie());
        const proofHeaders = await this._resolveDeviceProofHeaders('POST', url);
        const makeRefreshRequest = () => {
          const headers = {
            'Content-Type': 'application/json',
            ...(csrf ? { 'X-CSRF-Token': csrf } : null),
            ...proofHeaders,
          };
          return fetch(url, {
            method: 'POST',
            cache: 'no-store',
            credentials: 'include',
            headers,
            signal,
          });
        };
        let res = await makeRefreshRequest();
        if (res?.status === 403) {
          csrf = (await this._ensureCsrfCookie({ force: true })) || this._getCsrfTokenValue() || csrf || null;
          res = await makeRefreshRequest();
        }
        const status = Number(res?.status);
        const ok = !!(res && (res.status === 204 || res.ok));
        const body = ok ? null : await readJsonBody(res);
        const classified = classifyRefreshResult({
          ok,
          status: Number.isFinite(status) ? status : 0,
          code: body && typeof body.code === 'string' ? body.code : '',
          recoverable: body?.recoverable === true,
          reauthRequired: body?.reauthRequired === true,
        });
        if (ok) {
          this._lastRefreshOkAt = Date.now();
          this._markSessionActive();
          void this.ensureAuthDeviceRegistered().catch(() => undefined);
        }
        if (!ok && res) {
          if (classified.fatal && res.status === 401) {
            this._refreshBackoffUntilAt = Date.now() + 60 * 1000;
          } else if (classified.transient || res.status === 503 || res.status === 502 || res.status === 504) {
            this._refreshBackoffUntilAt = Date.now() + 15 * 1000;
          }
        }
        return classified;
      } catch (err) {
        const result = classifyRefreshResult({ ok: false, status: 0 });
        return {
          ...result,
          error: err,
        };
      }
    });
  }

  async _refreshSession(options = {}) {
    const broadcastAuthLost = options && typeof options.broadcastAuthLost === 'boolean' ? options.broadcastAuthLost : true;
    const result = await this._refreshSessionCore({ signal: options.signal });
    if (!result.ok && result.fatal && broadcastAuthLost && this._hasSession) {
      this._handleAuthLost('refresh');
    }
    return result.ok;
  }

  async refreshSessionNow(options = {}) {
    const broadcastAuthLost = options && typeof options.broadcastAuthLost === 'boolean' ? options.broadcastAuthLost : false;
    const signal = options && options.signal ? options.signal : undefined;
    return await this._refreshSession({ broadcastAuthLost, signal });
  }

  async refreshSession(options = {}) {
    const signal = options && options.signal ? options.signal : undefined;
    return await this._refreshSession({ broadcastAuthLost: false, signal });
  }

  async refreshSessionNowDetailed(options = {}) {
    const signal = options && options.signal ? options.signal : undefined;
    const result = await this._refreshSessionCore({ signal });
    const code = normalizeRefreshCode(result.code);
    const status = Number(result.status || 0);
    const reauthRequired = result.reauthRequired === true
      || REAUTH_REQUIRED_REFRESH_CODES.has(code)
      || (result.fatal === true && status === 401);
    return {
      ok: !!result.ok,
      status: status || 0,
      state: result.state || '',
      code: result.code || '',
      fatal: !!result.fatal,
      transient: !!result.transient,
      recoverable: result.recoverable === true || result.transient === true,
      reauthRequired,
      cached: !!result.cached,
      throttled: !!result.throttled,
      backoff: !!result.backoff,
    };
  }

  _clearLocalSession() {
    this._hasSession = false;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('user');
        localStorage.removeItem('userId');
      }
    } catch {
      // ignore
    }
    void clearAuthDeviceState();
    clearProofAccessToken();
    clearStreamTicketCache();
  }

  async ensureAuthDeviceRegistered(options = {}) {
    const required = options?.required === true;
    const fail = (code, status = 500) => {
      const out = { ok: false, code };
      if (required) {
        const err = new Error(code);
        throw attachLegacyStatusFields(err, status);
      }
      return out;
    };
    if (!isDeviceProofEnforced()) {
      return { ok: true, skipped: true };
    }
    await this._ensureCsrfCookie({ force: true });
    const material = await signDeviceProofRequest('POST', `${this.baseUrl}/api/auth/device/register`);
    const authDeviceId = material.authDeviceId;
    const publicKeySpki = material.publicKeySpki;
    if (!authDeviceId || !publicKeySpki) {
      return fail('device_key_unavailable');
    }
    if (!options.force && material.sidHash && !material.needsRegister) {
      return { ok: true, authDeviceId, alreadyBound: true };
    }
    const response = await this.request('/api/auth/device/register', {
      method: 'POST',
      body: JSON.stringify({ authDeviceId, publicKeySpki }),
      skipDeviceProof: true,
    });
    if (response?.ok && response.sidHash) {
      await persistAuthDeviceRecord({
        authDeviceId,
        sidHash: response.sidHash,
        publicKeySpki,
        pkcs8: material.pkcs8,
      });
      return { ok: true, authDeviceId };
    }
    return fail('device_register_failed');
  }

  clearLocalSession() {
    this._clearLocalSession();
  }

  onAuthLost(listener) {
    if (typeof listener !== 'function') {
      return () => undefined;
    }
    this._authLostListeners.add(listener);
    return () => {
      this._authLostListeners.delete(listener);
    };
  }

  _handleAuthLost(source) {
    const now = Date.now();
    if (this._authLostAt && now - this._authLostAt < 2000) {
      return;
    }
    this._authLostAt = now;
    for (const listener of this._authLostListeners) {
      try {
        listener({ source: String(source || 'unknown'), at: now });
      } catch {
      }
    }
  }

  /**
   * Получить сохранённого пользователя (если есть)
   */
  getUser() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem('user');
      if (!raw) return null;
      const user = JSON.parse(raw);
      if (user && (user.id || user.userId)) {
        return {
          id: user.id || user.userId,
          ...user,
        };
      }
      return null;
    } catch (e) {
      void e;
      return null;
    }
  }

  isAuthenticated() {
    return Boolean(this._hasSession || this.getUser());
  }

  /**
   * Базовый метод для запросов
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    };

    const method = (options.method || 'GET').toUpperCase();

    const retryEnabled = options.retry === true || (options.retry === undefined && this._isSafeMethod(method));
    const timeoutMs = options.timeoutMs;

    if (options.returnBlob) {
      const response = await this._apiHttpClient.requestRaw({
        url,
        method,
        headers,
        body: options.body,
        credentials: options.credentials || 'include',
        cache: options.cache,
        signal: options.signal,
        timeoutMs,
        retry: { enabled: retryEnabled, maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2500 },
        meta: {
          endpoint,
          skipAuth: !!options.skipAuth,
          skipAuthRefresh: !!options.skipAuthRefresh,
          suppressAuthLost: !!options.suppressAuthLost,
          skipCsrf: !!options.skipCsrf,
          skipDeviceProof: !!options.skipDeviceProof,
        },
      });

      return response;
    }

    const schema = options.schema;
    const hasSchema = !!schema;
    const { response, data } = await this._apiHttpClient.requestJson({
      url,
      method,
      headers,
      body: options.body,
      credentials: options.credentials || 'include',
      cache: options.cache,
      signal: options.signal,
      timeoutMs,
      retry: { enabled: retryEnabled, maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 2500 },
      meta: {
        endpoint,
        skipAuth: !!options.skipAuth,
        skipAuthRefresh: !!options.skipAuthRefresh,
        suppressAuthLost: !!options.suppressAuthLost,
        skipCsrf: !!options.skipCsrf,
        skipDeviceProof: !!options.skipDeviceProof,
      },
      schema,
      fallback: options.fallback,
      onValidationError: hasSchema
        ? () => {
          const code = `VALIDATION_ERROR:${String(endpoint || '').slice(0, 60)}`;
          void this.logClientError({ code: code.slice(0, 80) }).catch(() => undefined);
        }
        : null,
    });

    if (response && response.status === 204) {
      return null;
    }

    return data;
  }

  // ==================== AUTH API ====================

  async registerWithEmail(email, password, firstName, username) {
    const response = await this.request('/api/auth/email/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, firstName, username }),
      skipAuth: true,
      skipCsrf: true,
    });

    if (response && response.user) {
      this._markSessionActive();
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(response.user));
          if (response.user.id || response.user.userId) {
            localStorage.setItem('userId', String(response.user.id || response.user.userId));
          }
        }
      } catch {
        // ignore
      }
      await this.ensureAuthDeviceRegistered({ required: true });
    }

    return response;
  }

  async loginWithTelegram(payload) {
    const p = payload && typeof payload === 'object' ? payload : null;
    if (!p) {
      const err = new Error('INVALID_TELEGRAM_PAYLOAD');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const response = await this.request('/api/auth/telegram/login', {
      method: 'POST',
      body: JSON.stringify(p),
      skipAuth: true,
      skipCsrf: true,
    });

    if (response && response.user) {
      this._markSessionActive();
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(response.user));
          if (response.user.id || response.user.userId) {
            localStorage.setItem('userId', String(response.user.id || response.user.userId));
          }
        }
      } catch {
        // ignore
      }
      await this.ensureAuthDeviceRegistered({ required: true });
    }

    return response;
  }

  async loginWithEmail(email, password) {
    const response = await this.request('/api/auth/email/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      skipAuth: true,
      skipCsrf: true,
    });

    if (response && response.user) {
      this._markSessionActive();
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(response.user));
          if (response.user.id || response.user.userId) {
            localStorage.setItem('userId', String(response.user.id || response.user.userId));
          }
        }
      } catch {
        // ignore
      }
      await this.ensureAuthDeviceRegistered({ required: true });
    }

    return response;
  }

  async verifyToken(options = {}) {
    const profile = await this.request('/api/profile', {
      method: 'GET',
      signal: options.signal,
      skipCsrf: true,
      skipAuthRefresh: true,
      suppressAuthLost: true,
    });

    const hasUser = !!(profile && (profile.id || profile.userId));
    if (hasUser) {
      this._markSessionActive();
    } else {
      this._hasSession = false;
    }

    if (hasUser) {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(profile));
          if (profile.id || profile.userId) {
            localStorage.setItem('userId', String(profile.id || profile.userId));
          }
        }
      } catch {
        // ignore
      }
    }

    return hasUser ? { user: profile } : null;
  }

  async getProfile(options = {}) {
    const bust = options && (options.bustCache === true || options.bustCache === 1 || options.bustCache === '1');
    const qs = bust ? '?bustCache=1' : '';
    const response = await this.request(`/api/auth/profile${qs}`);
    if (response && (response.id || response.userId)) {
      this._markSessionActive();
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('user', JSON.stringify(response));
          localStorage.setItem('userId', String(response.id || response.userId));
        }
      } catch {
        // ignore
      }
    }
    return response;
  }

  async uploadUserAvatar(file, onProgress) {
    const f = file && typeof file === 'object' ? file : null;
    if (!f) {
      const err = new Error('FILE_REQUIRED');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const mime = String(f.type || '').toLowerCase();
    const okType = mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
    if (!okType) {
      const err = new Error('UNSUPPORTED_IMAGE_TYPE');
      err.status = 415;
      err.responseStatus = 415;
      throw err;
    }

    const size = Number(f.size) || 0;
    if (!Number.isFinite(size) || size <= 0) {
      const err = new Error('INVALID_FILE');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }
    if (size > 8 * 1024 * 1024) {
      const err = new Error('FILE_TOO_LARGE');
      err.status = 413;
      err.responseStatus = 413;
      throw err;
    }

    const formData = new FormData();
    formData.append('file', f);

    const url = `${this.baseUrl}/api/upload/user/avatar`;
    const csrf = this._getCsrfTokenValue();

    if (!csrf) {
      const err = new Error('CSRF_REQUIRED');
      err.status = 403;
      err.responseStatus = 403;
      throw err;
    }

    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      try {
        xhr.setRequestHeader('X-CSRF-Token', csrf);
      } catch {
      }

      if (typeof onProgress === 'function') {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress((e.loaded / e.total) * 100);
          }
        });
      }

      xhr.addEventListener('load', () => {
        const status = xhr.status;
        if (status >= 200 && status < 300) {
          try {
            const json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
            resolve(json);
          } catch {
            reject(new Error('Upload failed: invalid server response'));
          }
          return;
        }

        const err = new Error('UPLOAD_FAILED');
        err.status = status;
        err.responseStatus = status;
        try {
          const payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          if (payload && typeof payload.error === 'string') {
            err.message = payload.error;
          }
          if (payload && typeof payload.code === 'string') {
            err.code = payload.code;
          }
        } catch {
        }
        reject(err);
      });

      xhr.addEventListener('error', () => {
        const err = new Error('NETWORK_ERROR');
        err.status = 0;
        err.responseStatus = 0;
        reject(err);
      });

      xhr.addEventListener('abort', () => {
        const err = new Error('UPLOAD_ABORTED');
        err.name = 'AbortError';
        err.status = 0;
        err.responseStatus = 0;
        reject(err);
      });

      xhr.send(formData);
    });
  }

  async logout(options = {}) {
    const { localOnly = false } = options || {};
    if (!localOnly) {
      try {
        await this.request('/api/auth/logout', { method: 'POST', skipAuth: true, skipCsrf: true });
      } catch {
        // ignore
      }
    }
    this._clearLocalSession();
    await this._clearBrowserCaches();
  }

  async getAuthSessions() {
    return await this.request('/api/auth/sessions', { method: 'GET' });
  }

  async revokeAuthSession(sid) {
    const target = String(sid || '').trim();
    if (!target) {
      const err = new Error('SID_REQUIRED');
      err.status = 400;
      throw err;
    }
    return await this.request('/api/auth/sessions/revoke', {
      method: 'POST',
      body: JSON.stringify({ sid: target }),
    });
  }

  async revokeOtherAuthSessions() {
    return await this.request('/api/auth/sessions/revoke-others', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async revokeAllAuthSessions() {
    return await this.request('/api/auth/sessions/revoke-all', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async logClientError(payload = {}, options = {}) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const code = typeof p.code === 'string' ? p.code.trim().slice(0, 80) : '';
    if (!code) {
      const err = new Error('INVALID_ERROR_CODE');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const body = {
      code,
      trackId: p.trackId ? String(p.trackId).slice(0, 64) : null,
      playbackEngine: p.playbackEngine ? String(p.playbackEngine).slice(0, 16) : null,
      effectiveType: p.effectiveType ? String(p.effectiveType).slice(0, 16) : null,
      atMs: Number.isFinite(Number(p.atMs)) ? Number(p.atMs) : Date.now(),
      userAgent: p.userAgent ? String(p.userAgent).slice(0, 220) : null,
    };

    return await this.request('/api/log/error', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: options.signal,
      skipAuth: true,
      skipCsrf: true,
    });
  }

  async getSongHlsSession(songId, options = {}) {
    const trackId = Number(songId);
    if (!Number.isFinite(trackId) || trackId <= 0) {
      const err = new Error('INVALID_TRACK_ID');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const now = Date.now();
    if (now < (this._hlsSessionCooldownUntilAt || 0)) {
      const err = new HttpError(429);
      err.status = 429;
      err.responseStatus = 429;
      throw err;
    }

    const cacheKey = String(trackId);
    const cached = this._hlsSessionCache?.get?.(cacheKey);
    if (cached && typeof cached === 'object') {
      const cachedMasterUrl = typeof cached.masterUrl === 'string' ? cached.masterUrl : '';
      const cachedExpiresAtMs = typeof cached.expiresAtMs === 'number' ? cached.expiresAtMs : null;
      if (cachedMasterUrl && (!cachedExpiresAtMs || cachedExpiresAtMs > now + 5000)) {
        return { masterUrl: cachedMasterUrl, expiresAtMs: cachedExpiresAtMs };
      }
    }

    const createAbortError = () => {
      if (typeof DOMException !== 'undefined') {
        return new DOMException('Aborted', 'AbortError');
      }
      const e = new Error('Aborted');
      e.name = 'AbortError';
      return e;
    };

    const awaitAbortable = async (p) => {
      const signal = options?.signal;
      if (!signal) return await p;
      if (signal.aborted) {
        throw createAbortError();
      }
      return await Promise.race([
        p,
        new Promise((_, reject) => {
          const onAbort = () => {
            try {
              signal.removeEventListener('abort', onAbort);
            } catch {
            }
            reject(createAbortError());
          };
          try {
            signal.addEventListener('abort', onAbort, { once: true });
          } catch {
          }
        }),
      ]);
    };

    const existing = this._hlsSessionInFlight?.get?.(cacheKey);
    if (existing && existing.promise) {
      return await awaitAbortable(existing.promise);
    }

    const url = `${this.baseUrl}/api/ebap-hls/v1/session`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const load = (async () => {
      const resp = await this._apiHttpClientRaw.requestRaw({
        url,
        method: 'POST',
        headers,
        body: JSON.stringify({ trackId }),
        credentials: 'include',
        signal: undefined,
        meta: {
          endpoint: '/api/ebap-hls/v1/session',
        },
      });

      const st = resp?.status;
      if (st === 429) {
        const retryAfterRaw = resp?.headers?.get?.('retry-after') || '';
        const retryAfterSeconds = Number(retryAfterRaw);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          this._hlsSessionCooldownUntilAt = Date.now() + Math.min(60, Math.max(1, Math.floor(retryAfterSeconds))) * 1000;
        } else {
          this._hlsSessionCooldownUntilAt = Date.now() + 2000;
        }
        const err = new HttpError(429);
        err.status = 429;
        err.responseStatus = 429;
        throw err;
      }

      let data = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }

      if (!resp || !resp.ok) {
        const err = new HttpError(Number.isFinite(Number(st)) ? Number(st) : 0, { details: data });
        err.status = Number.isFinite(Number(st)) ? Number(st) : 0;
        err.responseStatus = err.status;
        throw err;
      }

      const masterUrl = data && typeof data.masterUrl === 'string' ? data.masterUrl : '';
      const expiresAtMs = data && typeof data.expiresAtMs === 'number' ? data.expiresAtMs : null;
      if (!masterUrl) {
        const err = new Error('HLS_SESSION_INVALID');
        err.status = 502;
        err.responseStatus = 502;
        throw err;
      }

      const absoluteMasterUrl = (() => {
        const base = this.streamingBaseUrl || this.baseUrl || runtimeOrigin || '';
        try {
          return new URL(masterUrl, base).toString();
        } catch {
          return masterUrl;
        }
      })();

      const result = { masterUrl: absoluteMasterUrl, expiresAtMs };

      const lyricsKeyB64 = data && data.lyrics && typeof data.lyrics.keyB64 === 'string' ? String(data.lyrics.keyB64).trim() : '';
      if (lyricsKeyB64) {
        try {
          this._lyricsSessionCache?.set?.(cacheKey, { keyB64: lyricsKeyB64, expiresAtMs: expiresAtMs || (Date.now() + 15_000) }, 15_000);
        } catch {
        }
      }

      try {
        this._hlsSessionCache?.set?.(cacheKey, result, 15_000);
      } catch {
      }
      return result;
    })();

    this._hlsSessionInFlight.set(cacheKey, { promise: load, startedAtMs: Date.now() });
    try {
      return await awaitAbortable(load);
    } finally {
      const cur = this._hlsSessionInFlight.get(cacheKey);
      if (cur && cur.promise === load) {
        this._hlsSessionInFlight.delete(cacheKey);
      }
    }
  }

  async getSongDirectSession(songId, options = {}) {
    const trackId = Number(songId);
    if (!Number.isFinite(trackId) || trackId <= 0) {
      const err = new Error('INVALID_TRACK_ID');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const now = Date.now();
    if (now < (this._directSessionCooldownUntilAt || 0)) {
      const err = new HttpError(429);
      err.status = 429;
      err.responseStatus = 429;
      throw err;
    }

    const cacheKey = String(trackId);
    const cached = this._directSessionCache?.get?.(cacheKey);
    if (cached && typeof cached === 'object') {
      const cachedUrl = typeof cached.url === 'string' ? cached.url : '';
      const cachedMasterUrl = typeof cached.masterUrl === 'string' ? cached.masterUrl : undefined;
      const cachedManifestUrl = typeof cached.manifestUrl === 'string' ? cached.manifestUrl : undefined;
      const cachedExpiresAtMs = typeof cached.expiresAtMs === 'number' ? cached.expiresAtMs : null;
      const cachedMime = typeof cached.mime === 'string' ? cached.mime : null;
      const cachedQualities = Array.isArray(cached.qualities) ? cached.qualities : null;
      const cachedSessionId = typeof cached.sessionId === 'string' ? cached.sessionId : undefined;
      const cachedPlaybackToken = typeof cached.playbackToken === 'string' ? cached.playbackToken : undefined;
      const cachedTokenExpiresAtMs = typeof cached.tokenExpiresAtMs === 'number' ? cached.tokenExpiresAtMs : cachedExpiresAtMs;
      if (cachedUrl && (!cachedExpiresAtMs || cachedExpiresAtMs > now + 5000)) {
        return {
          url: cachedUrl,
          masterUrl: cachedMasterUrl,
          manifestUrl: cachedManifestUrl,
          sessionId: cachedSessionId,
          playbackToken: cachedPlaybackToken,
          tokenExpiresAtMs: cachedTokenExpiresAtMs,
          sessionExpiresAtMs: typeof cached.sessionExpiresAtMs === 'number' ? cached.sessionExpiresAtMs : null,
          expiresAtMs: cachedExpiresAtMs,
          mime: cachedMime,
          qualities: cachedQualities,
        };
      }
    }

    const createAbortError = () => {
      if (typeof DOMException !== 'undefined') {
        return new DOMException('Aborted', 'AbortError');
      }
      const e = new Error('Aborted');
      e.name = 'AbortError';
      return e;
    };

    const awaitAbortable = async (p) => {
      const signal = options?.signal;
      if (!signal) return await p;
      if (signal.aborted) {
        throw createAbortError();
      }
      return await Promise.race([
        p,
        new Promise((_, reject) => {
          const onAbort = () => {
            try {
              signal.removeEventListener('abort', onAbort);
            } catch {
            }
            reject(createAbortError());
          };
          try {
            signal.addEventListener('abort', onAbort, { once: true });
          } catch {
          }
        }),
      ]);
    };

    const existing = this._directSessionInFlight?.get?.(cacheKey);
    if (existing && existing.promise) {
      return await awaitAbortable(existing.promise);
    }

    const url = `${this.baseUrl}/api/stream/v3/session`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const load = (async () => {
      const makeRequest = async () => {
        return await this._apiHttpClientRaw.requestRaw({
          url,
          method: 'POST',
          headers,
          body: JSON.stringify({ trackId, mode: 'direct', supportedCodecs: this._getSupportedCodecs() }),
          credentials: 'include',
          signal: options?.signal,
          meta: {
            endpoint: '/api/stream/v3/session',
            skipAuth: true,
            suppressAuthLost: true,
          },
        });
      };

      let csrf = null;
      try {
        csrf = this._getCsrfTokenValue() || null;
      } catch {
        csrf = null;
      }
      if (!csrf) {
        try {
          csrf = (await this._ensureCsrfCookie()) || null;
        } catch {
          csrf = null;
        }
      }
      if (csrf) {
        try {
          headers['X-CSRF-Token'] = csrf;
        } catch {
        }
      }

      let resp = await makeRequest();

      if (resp?.status === 403) {
        try {
          csrf = (await this._ensureCsrfCookie({ force: true })) || this._getCsrfTokenValue() || csrf || null;
          if (csrf) headers['X-CSRF-Token'] = csrf;
          resp = await makeRequest();
        } catch {
        }
      }

      if (resp?.status === 401 || resp?.status === 403) {
        const refreshed = await this._refreshSession({ broadcastAuthLost: false, signal: options?.signal }).catch(() => false);
        if (refreshed) {
          try {
            csrf = (await this._ensureCsrfCookie({ force: true })) || this._getCsrfTokenValue() || csrf || null;
            if (csrf) headers['X-CSRF-Token'] = csrf;
          } catch {
          }
          resp = await makeRequest();
        }
        if (resp?.status === 401 || resp?.status === 403) {
          this._markStreamingAuthCooldown(5 * 1000);
          this._directSessionCooldownUntilAt = Date.now() + 5 * 1000;
        }
      }

      const st = resp?.status;
      if (st === 429) {
        const retryAfterRaw = resp?.headers?.get?.('retry-after') || '';
        const retryAfterSeconds = Number(retryAfterRaw);
        if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
          this._directSessionCooldownUntilAt = Date.now() + Math.min(60, Math.max(1, Math.floor(retryAfterSeconds))) * 1000;
        } else {
          this._directSessionCooldownUntilAt = Date.now() + 2000;
        }
        const err = new HttpError(429);
        err.status = 429;
        err.responseStatus = 429;
        throw err;
      }

      let data = null;
      try {
        data = await resp.json();
      } catch {
        data = null;
      }

      if (!resp || !resp.ok) {
        const err = new HttpError(Number.isFinite(Number(st)) ? Number(st) : 0, { details: data });
        err.status = Number.isFinite(Number(st)) ? Number(st) : 0;
        err.responseStatus = err.status;
        throw err;
      }

      const rawSessionUrl = data && typeof data.streamUrl === 'string'
        ? data.streamUrl
        : data && typeof data.url === 'string'
          ? data.url
          : data && typeof data.directUrl === 'string'
            ? data.directUrl
            : data && typeof data.manifestUrl === 'string'
              ? data.manifestUrl
              : data && typeof data.masterUrl === 'string'
                ? data.masterUrl
                : '';
      const expiresAtMs = data && typeof data.expiresAtMs === 'number' ? data.expiresAtMs : null;
      const sessionExpiresAtMs = data && typeof data.sessionExpiresAtMs === 'number' ? data.sessionExpiresAtMs : null;
      const tokenExpiresAtMs = expiresAtMs;
      const mime = data && typeof data.mime === 'string' ? data.mime : 'audio/mpeg';
      const sessionId = data && typeof data.sessionId === 'string' ? data.sessionId : '';
      const playbackToken = data && typeof data.playbackToken === 'string' ? data.playbackToken : '';
      if (!rawSessionUrl) {
        const err = new Error('DIRECT_SESSION_INVALID');
        err.status = 502;
        err.responseStatus = 502;
        throw err;
      }
      const resolveAbsoluteUrl = (raw) => {
        return this._resolvePlaybackUrl(raw);
      };

      const absoluteUrl = resolveAbsoluteUrl(rawSessionUrl);

      const rawQualities = Array.isArray(data?.qualities) ? data.qualities : null;
      const qualities = rawQualities
        ? rawQualities
          .filter((q) => q && typeof q === 'object' && typeof q.tag === 'string' && typeof q.url === 'string')
          .map((q) => {
            const entry = {
              tag: q.tag,
              bitrate: typeof q.bitrate === 'number' ? q.bitrate : 0,
              codec: typeof q.codec === 'string' ? q.codec : undefined,
              url: resolveAbsoluteUrl(q.url),
              mime: typeof q.mime === 'string' ? q.mime : 'audio/mp4',
            };
            if (q.loudness && typeof q.loudness === 'object') {
              const inputLufs = typeof q.loudness.inputLufs === 'number' ? q.loudness.inputLufs : null;
              const targetLufs = typeof q.loudness.targetLufs === 'number' ? q.loudness.targetLufs : -14;
              entry.loudness = { inputLufs, targetLufs };
            }
            return entry;
          })
        : null;

      let result = {
        url: absoluteUrl,
        masterUrl: data && typeof data.masterUrl === 'string' ? resolveAbsoluteUrl(data.masterUrl) : undefined,
        manifestUrl: data && typeof data.manifestUrl === 'string' ? resolveAbsoluteUrl(data.manifestUrl) : undefined,
        sessionId: sessionId || undefined,
        playbackToken: playbackToken || undefined,
        tokenExpiresAtMs,
        sessionExpiresAtMs,
        expiresAtMs,
        mime,
        qualities,
      };
      try {
        result = await attachMediaTicketToDirectSession(result, trackId, options?.signal);
      } catch {
        // fail-open: legacy cookie/token path remains when mint unavailable
      }
      try {
        this._directSessionCache?.set?.(cacheKey, result, 15_000);
      } catch {
      }
      return result;
    })();

    this._directSessionInFlight.set(cacheKey, { promise: load, startedAtMs: Date.now() });
    try {
      return await awaitAbortable(load);
    } finally {
      const cur = this._directSessionInFlight.get(cacheKey);
      if (cur && cur.promise === load) {
        this._directSessionInFlight.delete(cacheKey);
      }
    }
  }

  async refreshSongDirectSession(sessionId, options = {}) {
    const sid = String(sessionId || '').trim();
    if (!sid) {
      const err = new Error('INVALID_SESSION_ID');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const url = `${this.baseUrl}/api/stream/v3/session/${encodeURIComponent(sid)}/refresh`;
    let csrf = this._getCsrfTokenValue() || null;
    if (!csrf) {
      csrf = await this._ensureCsrfCookie().catch(() => null);
    }

    const makeRequest = () => {
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
      if (csrf) headers['X-CSRF-Token'] = csrf;

      return this._apiHttpClientRaw.requestRaw({
        url,
        method: 'POST',
        headers,
        body: '{}',
        credentials: 'include',
        signal: options?.signal,
        meta: { endpoint: '/api/stream/v3/session/refresh', skipAuth: true, suppressAuthLost: true },
      });
    };

    let resp = await makeRequest();
    if (resp?.status === 403) {
      try {
        csrf = (await this._ensureCsrfCookie({ force: true })) || this._getCsrfTokenValue() || csrf || null;
        resp = await makeRequest();
      } catch {
      }
    }

    if (resp?.status === 401 || resp?.status === 403) {
      const refreshed = await this.refreshAuthSession({
        suppressAuthLost: true,
        signal: options?.signal,
      }).catch(() => false);
      if (refreshed) {
        csrf = (await this._ensureCsrfCookie({ force: true })) || this._getCsrfTokenValue() || csrf || null;
        resp = await makeRequest();
      }
    }

    let data = null;
    try { data = await resp.json(); } catch { data = null; }

    if (!resp || !resp.ok) {
      const st = resp?.status;
      const err = new HttpError(Number.isFinite(Number(st)) ? Number(st) : 0, { details: data });
      err.status = Number.isFinite(Number(st)) ? Number(st) : 0;
      err.responseStatus = err.status;
      throw err;
    }

    const rawSessionUrl = data && typeof data.streamUrl === 'string'
      ? data.streamUrl
      : data && typeof data.url === 'string'
        ? data.url
        : data && typeof data.manifestUrl === 'string'
          ? data.manifestUrl
          : '';
    const sessionIdNext = data && typeof data.sessionId === 'string' ? data.sessionId : sid;
    const playbackToken = data && typeof data.playbackToken === 'string' ? data.playbackToken : '';
    const expiresAtMs = data && typeof data.expiresAtMs === 'number' ? data.expiresAtMs : null;
    const sessionExpiresAtMs = data && typeof data.sessionExpiresAtMs === 'number' ? data.sessionExpiresAtMs : null;
    if (!rawSessionUrl) {
      const err = new Error('DIRECT_SESSION_AUTH_INVALID');
      err.status = 502;
      err.responseStatus = 502;
      throw err;
    }

    const absoluteUrl = this._resolvePlaybackUrl(rawSessionUrl);
    let result = {
      url: absoluteUrl,
      masterUrl: data && typeof data.masterUrl === 'string' ? this._resolvePlaybackUrl(data.masterUrl) : undefined,
      manifestUrl: data && typeof data.manifestUrl === 'string' ? this._resolvePlaybackUrl(data.manifestUrl) : undefined,
      sessionId: sessionIdNext,
      playbackToken: playbackToken || undefined,
      tokenExpiresAtMs: expiresAtMs,
      sessionExpiresAtMs,
      expiresAtMs,
      mime: data && typeof data.mime === 'string' ? data.mime : 'audio/mpeg',
      qualities: null,
    };
    const trackIdForTicket = options?.trackId ?? data?.trackId;
    if (trackIdForTicket != null && String(trackIdForTicket).trim() !== '') {
      try {
        result = await attachMediaTicketToDirectSession(result, trackIdForTicket, options?.signal);
      } catch {
        // fail-open on refresh mint errors
      }
    }
    return result;
  }

  async prefetchDirectSessions(trackIds) {
    void trackIds;
  }

  async getSongMediaUrl(songId, options = {}) {
    void songId;
    void options;
    const err = new Error('LEGACY_STREAM_DISABLED');
    err.status = 410;
    err.responseStatus = 410;
    throw err;
  }

  async getSongMediaUrlMeta(songId, options = {}) {
    void songId;
    void options;
    const err = new Error('LEGACY_STREAM_DISABLED');
    err.status = 410;
    err.responseStatus = 410;
    throw err;
  }

  async resolveSongStreamUrl(songId, options = {}) {
    void songId;
    void options;
    const err = new Error('LEGACY_STREAM_DISABLED');
    err.status = 410;
    err.responseStatus = 410;
    throw err;
  }

  async uploadSong(file, onProgress) {
    void file;
    void onProgress;
    throw this._artistPortalOnlyError();
  }

  async importLyricsFile(file, options = {}) {
    const f = file && typeof file === 'object' ? file : null;
    if (!f) {
      const err = new Error('FILE_REQUIRED');
      err.status = 400;
      err.responseStatus = 400;
      throw err;
    }

    const language = typeof options.language === 'string' ? options.language.trim() : '';
    const formData = new FormData();
    formData.append('file', f);
    if (language) {
      formData.append('language', language);
    }

    const url = `${this.baseUrl}/api/lyrics/import`;
    const csrf = this._getCsrfTokenValue();

    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      if (csrf) {
        try {
          xhr.setRequestHeader('X-CSRF-Token', csrf);
        } catch {
        }
      }

      const signal = options && options.signal ? options.signal : null;
      const onAbort = () => {
        try {
          xhr.abort();
        } catch {
        }
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          try {
            signal.addEventListener('abort', onAbort, { once: true });
          } catch {
          }
        }
      }

      const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            onProgress((e.loaded / e.total) * 100);
          }
        });
      }

      const cleanup = () => {
        if (signal) {
          try {
            signal.removeEventListener('abort', onAbort);
          } catch {
          }
        }
      };

      xhr.addEventListener('load', () => {
        cleanup();
        const status = xhr.status;
        if (status >= 200 && status < 300) {
          try {
            const json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
            resolve(json);
          } catch {
            reject(new Error('Upload failed: invalid server response'));
          }
          return;
        }

        const err = new Error('LYRICS_IMPORT_FAILED');
        err.status = status;
        err.responseStatus = status;
        try {
          const payload = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          if (payload && typeof payload.error === 'string') {
            err.message = payload.error;
          }
          if (payload && typeof payload.code === 'string') {
            err.code = payload.code;
          }
        } catch {
        }
        reject(err);
      });

      xhr.addEventListener('error', () => {
        cleanup();
        const err = new Error('NETWORK_ERROR');
        err.status = 0;
        err.responseStatus = 0;
        reject(err);
      });

      xhr.addEventListener('abort', () => {
        cleanup();
        const err = new Error('UPLOAD_ABORTED');
        err.name = 'AbortError';
        err.status = 0;
        err.responseStatus = 0;
        reject(err);
      });

      xhr.send(formData);
    });
  }

  getPartyWebSocketUrl(partyId) {
    const base = this.baseUrl || (typeof window !== 'undefined' && window.location ? window.location.origin : '');
    let host = '';
    let isHttps = false;
    try {
      const u = new URL(base);
      host = u.host;
      isHttps = u.protocol === 'https:';
    } catch {
      host = String(base).replace(/^https?:\/\//, '');
      isHttps = String(base).startsWith('https://');
    }
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    void partyId;
    // Party v2: signed party scope is in wsToken (HMAC), not a query param.
    return `${wsProtocol}//${host}/ws/v2`;
  }

  getPartyWebSocketUrlWithTicket(partyId, ticket) {
    const u = this.getPartyWebSocketUrl(partyId);
    const t = typeof ticket === 'string' ? ticket.trim() : '';
    if (!t) return u;
    return `${u}?wsToken=${encodeURIComponent(t)}`;
  }

  // ==================== DEVICE SYNC (Connect-like) ====================
  // All endpoints below require an authenticated user and are proxied by
  // go-api-gateway to device-sync-service. The service itself is behind
  // DEVICE_SYNC_ENABLED=true; when false every call returns 503/FEATURE_DISABLED
  // and useDeviceSync degrades to a no-op. Nothing in the base player depends
  // on any of this — safe to ship disabled.

  async registerDevice(payload = {}) {
    const body = {
      name: typeof payload.name === 'string' ? payload.name.slice(0, 48) : undefined,
      kind: typeof payload.kind === 'string' ? payload.kind : undefined,
      clientKey:
        typeof payload.clientKey === 'string' && payload.clientKey.trim() !== ''
          ? payload.clientKey.trim().slice(0, 64)
          : undefined,
      capabilities:
        payload.capabilities && typeof payload.capabilities === 'object'
          ? payload.capabilities
          : undefined,
    };
    return await this.request('/api/devices/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async heartbeatDevice(deviceId) {
    const id = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (!id) throw new Error('INVALID_DEVICE_ID');
    return await this.request('/api/devices/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ deviceId: id }),
    });
  }

  async removeDevice(deviceId) {
    const id = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (!id) throw new Error('INVALID_DEVICE_ID');
    return await this.request(`/api/devices/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async listDevices() {
    return await this.request('/api/devices', { method: 'GET' });
  }

  async transferDevice(deviceId, options = {}) {
    const id = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (!id) throw new Error('INVALID_DEVICE_ID');
    const body = {};
    if (typeof options.resume === 'boolean') {
      body.resume = options.resume;
    }
    const headers = {};
    if (typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim() !== '') {
      headers['Idempotency-Key'] = options.idempotencyKey.trim().slice(0, 128);
    }
    return await this.request(`/api/devices/transfer/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  async getDeviceTransferStatus(transferId) {
    const id = typeof transferId === 'string' ? transferId.trim() : '';
    if (!id) throw new Error('INVALID_TRANSFER_ID');
    return await this.request(`/api/devices/transfer/status/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  async putNowPlaying(state = {}) {
    // The server enforces shape; we only strip server-controlled fields here.
    const body = { ...state };
    delete body.updatedAtMs;
    return await this.request('/api/devices/now-playing', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async getNowPlayingRemote() {
    return await this.request('/api/devices/now-playing', { method: 'GET' });
  }

  async sendDeviceCommand({ fromDeviceId, to = null, cmd, payload = {}, activeRevision = 0 }) {
    const revision = Number(activeRevision);
    const body = {
      fromDeviceId: typeof fromDeviceId === 'string' ? fromDeviceId : '',
      to: typeof to === 'string' ? to : null,
      cmd: typeof cmd === 'string' ? cmd : '',
      payload: payload && typeof payload === 'object' ? payload : {},
    };
    if (Number.isFinite(revision) && revision > 0) {
      body.activeRevision = Math.floor(revision);
    }
    return await this.request('/api/devices/commands', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getDeviceWsTicket(deviceId) {
    const id = typeof deviceId === 'string' ? deviceId.trim() : '';
    if (!id) throw new Error('INVALID_DEVICE_ID');
    return await this.request('/api/devices/ws-ticket', {
      method: 'POST',
      body: JSON.stringify({ deviceId: id }),
    });
  }

  getDeviceWebSocketUrl(ticket) {
    const base = this.baseUrl || (typeof window !== 'undefined' && window.location ? window.location.origin : '');
    let host = '';
    let isHttps = false;
    try {
      const u = new URL(base);
      host = u.host;
      isHttps = u.protocol === 'https:';
    } catch {
      host = String(base).replace(/^https?:\/\//, '');
      isHttps = String(base).startsWith('https://');
    }
    const wsProtocol = isHttps ? 'wss:' : 'ws:';
    const t = typeof ticket === 'string' ? ticket.trim() : '';
    const q = t ? `?ticket=${encodeURIComponent(t)}` : '';
    return `${wsProtocol}//${host}/ws/devices${q}`;
  }

  // ==================== SONGS / LIKES / DISLIKES / EQ ====================

  async getSongWaveform(songId, options = {}) {
    const id = encodeURIComponent(String(songId));
    const bars = Number(options.bars);
    const qs = Number.isFinite(bars)
      ? `?bars=${Math.min(512, Math.max(32, Math.trunc(bars)))}`
      : '';
    return await this.request(`/api/songs/${id}/waveform${qs}`, { signal: options.signal });
  }

  async getSongs(params = {}) {
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    const pageRaw = Number.parseInt(String(params.page ?? ''), 10);

    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 200;
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
    const searchRaw = typeof params.search === 'string' ? params.search : (typeof params.q === 'string' ? params.q : '');
    const search = searchRaw.trim().slice(0, 100);
    const includeUnavailable = String(params.includeUnavailable ?? 'false') === 'true';
    const view = typeof params.view === 'string' && params.view.trim() ? params.view.trim() : 'compact';

    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('page', String(page));
    if (search) qs.set('search', search);
    if (includeUnavailable) qs.set('includeUnavailable', 'true');
    if (view) qs.set('view', view);

    const suffix = qs.toString();
    return await this.request(`/api/songs${suffix ? `?${suffix}` : ''}`, { signal: params.signal });
  }

  async getArtists(params = {}) {
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(params.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const q = typeof params.q === 'string' ? params.q.trim() : '';
    const search = new URLSearchParams();
    if (q) search.set('q', q);
    search.set('limit', String(limit));
    search.set('offset', String(offset));
    const suffix = search.toString();
    return await this.request(`/api/artists${suffix ? `?${suffix}` : ''}`, { signal: params.signal });
  }

  async searchV1(params = {}) {
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(params.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 50) : 20;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.min(offsetRaw, 200) : 0;
    const q = typeof params.q === 'string' ? params.q.normalize('NFC').trim() : '';
    const query = q.replace(/\s+/g, ' ').slice(0, 120);

    const search = new URLSearchParams();
    if (query) search.set('q', query);
    search.set('limit', String(limit));
    search.set('offset', String(offset));
    const suffix = search.toString();
    return await this.request(`/api/search/v1${suffix ? `?${suffix}` : ''}`, {
      signal: params.signal,
      timeoutMs: params.timeoutMs,
      retry: false,
    });
  }

  async getPopularArtists(params = {}) {
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(params.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 48) : 12;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;

    if (!this._popularArtistsCache) {
      this._popularArtistsCache = new LruCache({ maxEntries: 60, ttlMs: 60 * 1000 });
    }

    const cacheKey = `${limit}:${offset}`;
    const cached = this._popularArtistsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const search = new URLSearchParams();
    search.set('limit', String(limit));
    search.set('offset', String(offset));
    const suffix = search.toString();

    const data = await this.request(`/api/artists/popular?${suffix}`, { signal: params.signal });
    if (data && typeof data === 'object') {
      try {
        this._popularArtistsCache.set(cacheKey, data, 60 * 1000);
      } catch {
      }
    }
    return data;
  }

  async getArtistMe(params = {}) {
    return await this.request('/api/artists/me', { signal: params.signal });
  }

  async getArtistMeta(artist, params = {}) {
    const raw = (artist || '').toString().normalize('NFC').trim();
    if (!raw) return null;
    const m = /^([a-f0-9]{32})(?:-.*)?$/i.exec(raw);
    const token = m ? String(m[1] || '').toLowerCase() : raw;
    return await this.request(`/api/artists/${encodeURIComponent(token)}/meta`, { signal: params.signal });
  }

  async getArtistRadio(artist, params = {}) {
    const raw = (artist || '').toString().normalize('NFC').trim();
    if (!raw) return [];
    const qs = new URLSearchParams();
    qs.set('artist', raw);
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    if (Number.isFinite(limitRaw) && limitRaw > 0) qs.set('limit', String(Math.min(limitRaw, 100)));
    if (params.userId != null) qs.set('userId', String(params.userId));
    if (params.exclude) qs.set('exclude', String(params.exclude));
    const suffix = qs.toString();
    return await this.request(`/api/songs/radio?${suffix}`, { signal: params.signal });
  }

  async getArtistTracks(artist, params = {}) {
    const raw = (artist || '').toString().normalize('NFC').trim();
    if (!raw) return [];
    const m = /^([a-f0-9]{32})(?:-.*)?$/i.exec(raw);
    const name = m ? String(m[1] || '').toLowerCase() : raw;
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(params.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 100;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const search = new URLSearchParams();
    search.set('limit', String(limit));
    search.set('offset', String(offset));
    const sort = typeof params.sort === 'string' ? params.sort.trim() : '';
    if (sort) search.set('sort', sort);
    const yearRaw = params.year;
    const year = yearRaw === null || yearRaw === undefined ? null : Number.parseInt(String(yearRaw), 10);
    if (Number.isFinite(year) && year > 0) search.set('year', String(year));
    const suffix = search.toString();
    return await this.request(`/api/artists/${encodeURIComponent(name)}/tracks?${suffix}`, { signal: params.signal });
  }

  async resolveAlbumPublicId(artist, albumName, params = {}) {
    const a = (artist || '').toString().trim();
    const n = (albumName || '').toString().trim();
    if (!a || !n) return null;
    const qs = new URLSearchParams();
    qs.set('artist', a);
    qs.set('name', n);
    const suffix = qs.toString();
    return await this.request(`/api/albums/resolve?${suffix}`, { signal: params.signal });
  }

  async getAlbumByPublicId(albumPublicId, params = {}) {
    const pid = (albumPublicId || '').toString().trim();
    if (!pid) return null;
    return await this.request(`/api/albums/${encodeURIComponent(pid)}`, { signal: params.signal });
  }

  async getAlbumTracksByPublicId(albumPublicId, params = {}) {
    const pid = (albumPublicId || '').toString().trim();
    if (!pid) return [];
    const limitRaw = Number.parseInt(String(params.limit ?? ''), 10);
    const offsetRaw = Number.parseInt(String(params.offset ?? ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : 500;
    const offset = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
    const qs = new URLSearchParams();
    qs.set('limit', String(limit));
    qs.set('offset', String(offset));
    return await this.request(`/api/albums/${encodeURIComponent(pid)}/tracks?${qs.toString()}`, { signal: params.signal });
  }

  async getUserUploadedSongs(userId) {
    void userId;
    throw this._artistPortalOnlyError();
  }

  async deleteSong(songId) {
    void songId;
    throw this._artistPortalOnlyError();
  }

  async updateSong(songId, metadata) {
    void songId;
    void metadata;
    throw this._artistPortalOnlyError();
  }

  async getLyrics(songId, options = {}) {
    const sid = songId === undefined || songId === null ? '' : String(songId).trim();
    if (!sid) return null;

    const isProduction = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';
    let allowPlaintext = false;
    try {
      const env = typeof process !== 'undefined' && process.env ? process.env : null;
      const raw = env && typeof env.REACT_APP_LYRICS_ALLOW_PLAINTEXT === 'string' ? env.REACT_APP_LYRICS_ALLOW_PLAINTEXT : '';
      allowPlaintext = String(raw || '').toLowerCase() === 'true';
    } catch {
    }

    if (!isProduction && allowPlaintext) {
      const json = await this.request(`/api/lyrics/${encodeURIComponent(sid)}`, {
        signal: options.signal,
        suppressAuthLost: true,
      }).catch(() => null);
      if (json && typeof json === 'object') {
        const gotId = json.songId ?? json.song_id ?? json.id;
        if (gotId !== null && gotId !== undefined && String(gotId) === sid) {
          return json;
        }
      }
    }

    const cacheKey = String(Number(sid) || sid);
    let cap = this._lyricsSessionCache?.get?.(cacheKey);
    let keyB64 = cap && typeof cap.keyB64 === 'string' ? cap.keyB64 : '';
    if (!keyB64) {
      try {
        await this.getSongHlsSession(cacheKey, { signal: options.signal });
      } catch {
      }
      cap = this._lyricsSessionCache?.get?.(cacheKey);
      keyB64 = cap && typeof cap.keyB64 === 'string' ? cap.keyB64 : '';
      if (!keyB64) return null;
    }

    const res = await this.request('/api/ebap-hls/v1/lyrics.bin', {
      returnBlob: true,
      headers: { Accept: 'application/octet-stream', 'x-lyrics-key': keyB64 },
      signal: options.signal,
      suppressAuthLost: true,
    });

    const st = res?.status;
    if (!res || st === 204) return null;
    if (!res.ok) return null;

    let buf;
    try {
      buf = await res.arrayBuffer();
    } catch {
      return null;
    }

    const raw = await decryptEbapLyricsPayload(buf, keyB64);
    const gotId = raw && typeof raw === 'object' ? (raw.songId ?? raw.song_id ?? raw.id) : null;
    if (gotId === null || gotId === undefined) return null;
    if (String(gotId) !== sid) return null;
    return raw;
  }

  async likeSong(songId) {
    return await this.request(`/api/likes/${encodeURIComponent(songId)}`, { method: 'POST' });
  }

  async unlikeSong(songId) {
    return await this.request(`/api/likes/${encodeURIComponent(songId)}`, { method: 'DELETE' });
  }

  async getDislikes(params = {}) {
    return await this.request('/api/dislikes', { signal: params.signal });
  }

  async dislikeSong(songId) {
    return await this.request(`/api/dislikes/${encodeURIComponent(songId)}`, { method: 'POST' });
  }

  async undislikeSong(songId) {
    return await this.request(`/api/dislikes/${encodeURIComponent(songId)}`, { method: 'DELETE' });
  }

  async getLikes(params = {}) {
    return await this.request('/api/likes', { signal: params.signal });
  }

  async getSubscriptionPlans() {
    return await this.request('/api/subscriptions/plans');
  }

  async getMySubscription() {
    return await this.request('/api/subscriptions/me');
  }

  async subscribeToPlan(planSlug, provider, providerId) {
    return await this.request('/api/subscriptions/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planSlug, provider, providerId }),
    });
  }

  async cancelSubscription() {
    return await this.request('/api/subscriptions/cancel', { method: 'POST' });
  }

  async getMoodRadar() {
    return await this.request('/api/recommendations/mood-radar');
  }

  async getMoodTracks(mood, limit = 20) {
    return await this.request(`/api/recommendations/mood-tracks/${encodeURIComponent(mood)}?limit=${limit}`);
  }

  async getEqSettings() {
    return await this.request('/api/eq');
  }

  async saveEqSettings(eqSettings, gains) {
    let payload = null;

    if (typeof eqSettings === 'boolean') {
      payload = { enabled: eqSettings, gains };
    } else if (eqSettings && typeof eqSettings === 'object') {
      payload = eqSettings;
    } else {
      payload = {};
    }

    const enabled = typeof payload.enabled === 'boolean' ? payload.enabled : false;
    const rawGains = Array.isArray(payload.gains) ? payload.gains : Array.isArray(gains) ? gains : [];
    const normalizedGains = rawGains
      .slice(0, 10)
      .map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      });
    while (normalizedGains.length < 10) normalizedGains.push(0);

    return await this.request('/api/eq', {
      method: 'POST',
      body: JSON.stringify({ enabled, gains: normalizedGains }),
    });
  }

  async getRecommendationPlaybackRates(genres) {
    const list = Array.isArray(genres) ? genres : [];
    const limited = list.slice(0, 50).map((g) => String(g));
    if (limited.length === 0) {
      return {};
    }

    const query = new URLSearchParams();
    for (const g of limited) {
      query.append('genres', g);
    }

    const qs = query.toString();
    const response = await this.request(`/api/recommendations/playback-rate${qs ? `?${qs}` : ''}`);
    if (response && response.rates && typeof response.rates === 'object') {
      return response.rates;
    }
    return {};
  }

  async setRecommendationPlaybackRatePreference(userId, genre, playbackRate) {
    const uid = Number.parseInt(String(userId), 10);
    const body = {
      genre,
      playbackRate,
      ...(Number.isFinite(uid) && uid > 0 ? { userId: uid } : {}),
    };

    return await this.request('/api/recommendations/playback-rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // ==================== PLAYLISTS / QUEUE / PARTY ====================

  async getPlaylists(params = {}) {
    const { limit, offset, includePublic } = params;
    const query = new URLSearchParams();
    if (limit !== undefined) query.set('limit', String(limit));
    if (offset !== undefined) query.set('offset', String(offset));
    if (includePublic) query.set('includePublic', 'true');
    const qs = query.toString();
    const response = await this.request(`/api/playlists${qs ? `?${qs}` : ''}`);
    if (response && Array.isArray(response.playlists)) return response.playlists;
    return Array.isArray(response) ? response : [];
  }

  async getPlaylist(playlistId) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}`);
  }

  async createPlaylist(data) {
    return await this.request('/api/playlists', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async updatePlaylist(playlistId, data) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'PUT',
      body: JSON.stringify(data || {}),
    });
  }

  async deletePlaylist(playlistId) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'DELETE',
    });
  }

  async addTrackToPlaylist(playlistId, songId) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ song_id: songId }),
    });
  }

  async addTracksToPlaylist(playlistId, songIds) {
    const ids = Array.isArray(songIds) ? songIds : [];
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ song_ids: ids }),
    });
  }

  async removeTrackFromPlaylist(playlistId, songId) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(songId)}`, {
      method: 'DELETE',
    });
  }

  async reorderPlaylistTrack(playlistId, trackId, newPosition) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(trackId)}/position`, {
      method: 'PUT',
      body: JSON.stringify({ position: newPosition }),
    });
  }

  async regeneratePlaylistShareLink(playlistId) {
    return await this.request(`/api/playlists/${encodeURIComponent(playlistId)}/regenerate-link`, {
      method: 'POST',
    });
  }

  async createSharedPlaylist(payload) {
    return await this.request('/api/playlists/share', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  async getPublicPlaylistBySlug(slug) {
    return await this.request(`/api/playlists/public/${encodeURIComponent(slug)}`, { skipAuth: true });
  }

  async getMixByToken(token) {
    return await this.request(`/api/mix/${encodeURIComponent(token)}`, { skipAuth: true });
  }

  async getDiscoverRails(params = {}) {
    const seed = params.seed !== undefined && params.seed !== null ? String(params.seed) : '';
    const query = new URLSearchParams();
    if (seed) query.set('seed', seed);
    const qs = query.toString();
    const endpoint = `/api/playlists/discover${qs ? `?${qs}` : ''}`;

    try {
      return await this.request(endpoint, { signal: params.signal });
    } catch (e) {
      const status = e && typeof e === 'object' && typeof e.status === 'number'
        ? e.status
        : (e && typeof e === 'object' && typeof e.responseStatus === 'number' ? e.responseStatus : null);

      if (status !== 401 && status !== 403) {
        throw e;
      }

      if (this.getUser()) {
        const refreshed = await this.refreshSession({ signal: params.signal }).catch(() => false);
        if (refreshed) {
          return await this.request(endpoint, {
            signal: params.signal,
            suppressAuthLost: true,
          });
        }
        throw e;
      }

      return await this.request(endpoint, {
        signal: params.signal,
        skipAuth: true,
        suppressAuthLost: true,
        credentials: 'omit',
      });
    }
  }

  async resolvePlaylistIdentifier(identifier, params = {}) {
    const id = identifier === undefined || identifier === null ? '' : String(identifier).trim();
    if (!id) return { kind: 'unknown', identifier: '' };
    const qs = new URLSearchParams();
    qs.set('id', id);
    return await this.request(`/api/playlists/resolve?${qs.toString()}`, { signal: params.signal, skipAuth: params.skipAuth });
  }

  async createParty(options = {}) {
    return await this.request('/api/party', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getParty(partyId) {
    return await this.request(`/api/party/${encodeURIComponent(partyId)}`);
  }

  async joinParty(partyId, options = {}) {
    return await this.request(`/api/party/${encodeURIComponent(partyId)}/join`, {
      method: 'POST',
      signal: options.signal,
    });
  }

  async joinPartyByCode(code, userName, options = {}) {
    return await this.request('/api/party/join/code', {
      method: 'POST',
      body: JSON.stringify({ code, userName }),
      signal: options.signal,
    });
  }

  async joinPartyByLink(payload, options = {}) {
    return await this.request(`/api/party/join/${encodeURIComponent(payload)}`, {
      signal: options.signal,
    });
  }

  async createPartyInvite(partyId, options = {}) {
    return await this.request(`/api/party/${encodeURIComponent(partyId)}/invite`, {
      method: 'POST',
      signal: options.signal,
    });
  }

  async getPartyWsTicket(partyId, options = {}) {
    return await this.request(`/api/party/${encodeURIComponent(partyId)}/ws-ticket`, {
      signal: options.signal,
    });
  }

  async leaveParty(partyId) {
    return await this.request(`/api/party/${encodeURIComponent(partyId)}/leave`, { method: 'POST' });
  }

  async endParty(partyId) {
    return await this.request(`/api/party/${encodeURIComponent(partyId)}`, { method: 'DELETE' });
  }

  async getUserParties() {
    return await this.request('/api/party/user/active');
  }

  async cleanupUserParties() {
    return await this.request('/api/party/user/cleanup', { method: 'DELETE' });
  }

  // ==================== USER SETTINGS / STATS ====================

  async getUserStats() {
    return await this.request('/api/user/stats');
  }

  async getUserSettings() {
    return await this.request('/api/user/settings');
  }

  async updateUserSettings(settings) {
    return await this.request('/api/user/settings', {
      method: 'PUT',
      body: JSON.stringify(settings || {}),
    });
  }

  // ==================== COVER URL HELPERS ====================

  getCoverUrl(song, bustCache = false) {
    const coverPathRaw = (song && (song.cover_path || song.coverPath || song.cover)) ? String(song.cover_path || song.coverPath || song.cover) : '';
    const coverPath = coverPathRaw.trim();
    if (!coverPath) return null;

    const updatedAtRaw = song && (song.updated_at ?? song.updatedAt) ? String(song.updated_at ?? song.updatedAt) : '';
    const updatedAt = updatedAtRaw.trim();
    const keyBase = bustCache && updatedAt ? `${coverPath}|t=${updatedAt}` : `${coverPath}`;
    const cached = coverUrlCache.get(keyBase);
    if (cached && !bustCache) {
      return cached;
    }

    const filename = coverPath.split('/').pop();
    if (!filename) return null;
    const cacheBuster = (bustCache && updatedAt) ? `?t=${encodeURIComponent(updatedAt)}` : '';
    const coverOrigin = deriveCoverOrigin() || this.baseUrl;
    const url = `${coverOrigin}/covers/${encodeURIComponent(filename)}${cacheBuster}`;

    coverUrlCache.set(keyBase, url);
    return url;
  }
}

// Экспортируем singleton
const apiClient = new ApiClient();
export default apiClient;
