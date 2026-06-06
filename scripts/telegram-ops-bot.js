#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BOT_TOKEN = firstNonEmpty(
  process.env.TELEGRAM_OPS_BOT_TOKEN,
  process.env.ALERTMANAGER_TELEGRAM_BOT_TOKEN,
  process.env.TELEGRAM_BOT_TOKEN,
);
const BOOTSTRAP_SECRET = String(process.env.TELEGRAM_OPS_BOOTSTRAP_SECRET || '').trim();
const PROMETHEUS_URL = String(process.env.TELEGRAM_OPS_PROMETHEUS_URL || process.env.PROMETHEUS_URL || 'http://prometheus:9090').replace(/\/+$/, '');
const STATE_FILE = String(process.env.TELEGRAM_OPS_STATE_FILE || '/data/state.json');
const POLL_TIMEOUT_SECONDS = positiveInt(process.env.TELEGRAM_OPS_POLL_TIMEOUT_SECONDS, 25);
const ALERT_POLL_INTERVAL_MS = positiveInt(process.env.TELEGRAM_OPS_ALERT_POLL_INTERVAL_MS, 60_000);
const ALERT_REPEAT_MS = positiveInt(process.env.TELEGRAM_OPS_ALERT_REPEAT_MS, 30 * 60_000);
const SEND_RESOLVED = boolEnv(process.env.TELEGRAM_OPS_SEND_RESOLVED, true);
const ALLOW_GROUPS = boolEnv(process.env.TELEGRAM_OPS_ALLOW_GROUPS, false);
const ALLOW_MULTIPLE_CLAIMS = boolEnv(process.env.TELEGRAM_OPS_ALLOW_MULTIPLE_CLAIMS, false);
const DELETE_WEBHOOK_ON_START = boolEnv(process.env.TELEGRAM_OPS_DELETE_WEBHOOK, true);
const STATIC_ALLOWED_USER_IDS = parseIdSet(process.env.TELEGRAM_OPS_ALLOWED_USER_IDS);
const STATIC_ALLOWED_CHAT_IDS = parseIdSet(process.env.TELEGRAM_OPS_ALLOWED_CHAT_IDS);

if (!BOT_TOKEN) {
  process.stderr.write('TELEGRAM_OPS_BOT_TOKEN or TELEGRAM_BOT_TOKEN is required\n');
  process.exit(1);
}

let shuttingDown = false;
let state = loadState();

process.on('SIGTERM', () => { shuttingDown = true; });
process.on('SIGINT', () => { shuttingDown = true; });

function firstNonEmpty(...values) {
  for (const value of values) {
    const s = typeof value === 'string' ? value.trim() : '';
    if (s) return s;
  }
  return '';
}

function positiveInt(value, fallback) {
  const n = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(value, fallback) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseIdSet(value) {
  const set = new Set();
  const raw = typeof value === 'string' ? value : '';
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (/^-?\d+$/.test(s)) set.add(s);
  }
  return set;
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      lastUpdateId: Number.isInteger(parsed.lastUpdateId) ? parsed.lastUpdateId : 0,
      claims: Array.isArray(parsed.claims) ? parsed.claims : [],
      sentAlerts: parsed.sentAlerts && typeof parsed.sentAlerts === 'object' ? parsed.sentAlerts : {},
      activeAlerts: parsed.activeAlerts && typeof parsed.activeAlerts === 'object' ? parsed.activeAlerts : {},
    };
  } catch {
    return { lastUpdateId: 0, claims: [], sentAlerts: {}, activeAlerts: {} };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
}

function claimedUserIds() {
  return new Set(state.claims.map((c) => String(c.userId)).filter(Boolean));
}

function claimedChatIds() {
  return new Set(state.claims.map((c) => String(c.chatId)).filter(Boolean));
}

function isPrivateChat(message) {
  return message?.chat?.type === 'private';
}

function isAuthorized(message) {
  const userId = message?.from?.id != null ? String(message.from.id) : '';
  const chatId = message?.chat?.id != null ? String(message.chat.id) : '';
  if (userId && STATIC_ALLOWED_USER_IDS.has(userId)) return true;
  if (chatId && STATIC_ALLOWED_CHAT_IDS.has(chatId)) return true;
  if (userId && claimedUserIds().has(userId)) return true;
  if (chatId && claimedChatIds().has(chatId)) return true;
  return false;
}

function authorizedChatIds() {
  const ids = new Set([...STATIC_ALLOWED_CHAT_IDS, ...claimedChatIds()]);
  return [...ids].filter(Boolean);
}

async function telegram(method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { }
  if (!res.ok || !json?.ok) {
    const description = json?.description || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new Error(`telegram ${method} failed: ${description}`);
  }
  return json.result;
}

async function sendMessage(chatId, text) {
  const chunks = splitMessage(String(text || '').trim() || 'Нет данных');
  for (const chunk of chunks) {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

function splitMessage(text) {
  const max = 3800;
  if (text.length <= max) return [text];
  const out = [];
  let rest = text;
  while (rest.length > max) {
    let idx = rest.lastIndexOf('\n', max);
    if (idx < 1000) idx = max;
    out.push(rest.slice(0, idx));
    rest = rest.slice(idx).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

async function prometheusQuery(query) {
  const url = `${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { method: 'GET' });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch { }
  if (!res.ok || json?.status !== 'success') {
    throw new Error(`Prometheus query failed: ${json?.error || body.slice(0, 200) || res.status}`);
  }
  return Array.isArray(json.data?.result) ? json.data.result : [];
}

async function prometheusAlerts() {
  const res = await fetch(`${PROMETHEUS_URL}/api/v1/alerts`, { method: 'GET' });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch { }
  if (!res.ok || json?.status !== 'success') {
    throw new Error(`Prometheus alerts failed: ${json?.error || body.slice(0, 200) || res.status}`);
  }
  return Array.isArray(json.data?.alerts) ? json.data.alerts : [];
}

function scalar(result, fallback = 0) {
  const first = result[0];
  const raw = first?.value?.[1];
  const n = Number.parseFloat(String(raw));
  return Number.isFinite(n) ? n : fallback;
}

function table(result, labelName, valueSuffix = '') {
  if (!result.length) return 'нет данных';
  return result.map((row) => {
    const label = row.metric?.[labelName] || row.metric?.instance || row.metric?.job || 'unknown';
    const value = Number.parseFloat(row.value?.[1] || '0');
    const formatted = Number.isFinite(value) ? formatNumber(value) : '0';
    return `- ${label}: ${formatted}${valueSuffix}`;
  }).join('\n');
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function percent(value) {
  return `${formatNumber(value)}%`;
}

function helpText() {
  return [
    'Команды Earflow ops bot:',
    '/status - здоровье платформы, RPS, latency, ошибки',
    '/alerts - активные алерты Prometheus',
    '/traffic - трафик gateway по статусам и top routes',
    '/db - нагрузка Postgres и PgBouncer',
    '/redis - память Redis и evictions',
    '/whoami - показать ваши Telegram ID',
    '/help - список команд',
    '',
    'Первичная привязка:',
    '/claim <bootstrap-secret>',
  ].join('\n');
}

async function buildStatus() {
  const [targetsDown, probesDown, rps, errorRate, p95, infiniteRps] = await Promise.all([
    prometheusQuery('count(up{job!~"blackbox-http|alertmanager|pgbouncer"} == 0) or on() vector(0)'),
    prometheusQuery('count(probe_success{job="blackbox-http"} == 0) or on() vector(0)'),
    prometheusQuery('sum(rate(gateway_http_requests_total[5m])) or on() vector(0)'),
    prometheusQuery('(sum(rate(gateway_http_requests_total{status_class="5xx"}[5m])) / clamp_min(sum(rate(gateway_http_requests_total[5m])), 1)) * 100 or on() vector(0)'),
    prometheusQuery('histogram_quantile(0.95, sum(rate(gateway_http_request_duration_seconds_bucket[5m])) by (le)) or on() vector(0)'),
    prometheusQuery('sum(rate(reco_http_requests_total{route=~"^(/api/recommendations)?/infinite$"}[5m])) or on() vector(0)'),
  ]);

  return [
    'Статус Earflow',
    `Недоступные scrape targets: ${formatNumber(scalar(targetsDown))}`,
    `Недоступные HTTP health probes: ${formatNumber(scalar(probesDown))}`,
    `Gateway RPS: ${formatNumber(scalar(rps))}`,
    `Gateway 5xx: ${percent(scalar(errorRate))}`,
    `Gateway p95: ${formatNumber(scalar(p95) * 1000)}ms`,
    `Reco infinite RPS: ${formatNumber(scalar(infiniteRps))}`,
  ].join('\n');
}

async function buildTraffic() {
  const [byStatus, topRoutes] = await Promise.all([
    prometheusQuery('sum(rate(gateway_http_requests_total[5m])) by (status_class) or on() vector(0)'),
    prometheusQuery('topk(10, sum(rate(gateway_http_requests_total[5m])) by (route))'),
  ]);

  return [
    'Трафик',
    'По статусам:',
    table(byStatus, 'status_class', ' rps'),
    '',
    'Top routes:',
    table(topRoutes, 'route', ' rps'),
  ].join('\n');
}

async function buildDb() {
  const [pgConn, pgMax, pgbWait, pgbMaxWait] = await Promise.all([
    prometheusQuery('sum(pg_stat_activity_count{datname!~"template.*"}) or on() vector(0)'),
    prometheusQuery('max(pg_settings_max_connections) or on() vector(0)'),
    prometheusQuery('sum(pgbouncer_pools_client_waiting_connections) or on() vector(0)'),
    prometheusQuery('max(pgbouncer_pools_client_maxwait_seconds) or on() vector(0)'),
  ]);
  const used = scalar(pgConn);
  const max = scalar(pgMax);
  const ratio = max > 0 ? (used / max) * 100 : 0;

  return [
    'База данных',
    `Подключения Postgres: ${formatNumber(used)} / ${formatNumber(max)} (${percent(ratio)})`,
    `Клиенты PgBouncer в ожидании: ${formatNumber(scalar(pgbWait))}`,
    `Максимальное ожидание PgBouncer: ${formatNumber(scalar(pgbMaxWait))}s`,
  ].join('\n');
}

async function buildRedis() {
  const [used, max, evictions] = await Promise.all([
    prometheusQuery('sum(redis_memory_used_bytes) or on() vector(0)'),
    prometheusQuery('sum(redis_memory_max_bytes) or on() vector(0)'),
    prometheusQuery('sum(increase(redis_evicted_keys_total[5m])) or on() vector(0)'),
  ]);
  const usedBytes = scalar(used);
  const maxBytes = scalar(max);
  const ratio = maxBytes > 0 ? (usedBytes / maxBytes) * 100 : 0;

  return [
    'Redis',
    `Память: ${formatBytes(usedBytes)} / ${formatBytes(maxBytes)} (${percent(ratio)})`,
    `Evictions за 5 минут: ${formatNumber(scalar(evictions))}`,
  ].join('\n');
}

function formatBytes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${formatNumber(v)}${units[i]}`;
}

async function buildAlerts() {
  const alerts = (await prometheusAlerts()).filter((a) => a.state === 'firing');
  if (!alerts.length) return 'Активных алертов нет';
  return ['Активные алерты:', ...alerts.slice(0, 20).map(formatAlert)].join('\n\n');
}

function alertKey(alert) {
  const labels = alert.labels || {};
  return [labels.alertname, labels.job, labels.service, labels.instance].filter(Boolean).join('|');
}

function formatAlert(alert) {
  const labels = alert.labels || {};
  const annotations = alert.annotations || {};
  const title = annotations.summary || labels.alertname || 'unknown';
  return [
    `Алерт: ${title}`,
    labels.alertname ? `ID: ${labels.alertname}` : '',
    labels.severity ? `Важность: ${severityLabel(labels.severity)}` : '',
    labels.job ? `Job: ${labels.job}` : '',
    labels.service ? `Сервис: ${labels.service}` : '',
    labels.instance ? `Instance: ${labels.instance}` : '',
    annotations.description ? `Описание: ${annotations.description}` : '',
  ].filter(Boolean).join('\n');
}

function severityLabel(value) {
  if (value === 'critical') return 'критично';
  if (value === 'warning') return 'предупреждение';
  return value || 'unknown';
}

async function handleClaim(message, args) {
  const chatId = String(message.chat.id);
  const userId = String(message.from.id);
  if (!ALLOW_GROUPS && !isPrivateChat(message)) {
    await sendMessage(chatId, 'Привязка разрешена только в личном чате.');
    return;
  }
  if (!BOOTSTRAP_SECRET) {
    await sendMessage(chatId, 'Bootstrap выключен: TELEGRAM_OPS_BOOTSTRAP_SECRET не настроен.');
    return;
  }
  const provided = args.trim();
  if (!provided || provided !== BOOTSTRAP_SECRET) {
    await sendMessage(chatId, 'Неверный claim secret.');
    return;
  }
  if (!ALLOW_MULTIPLE_CLAIMS && state.claims.length > 0 && !isAuthorized(message)) {
    await sendMessage(chatId, 'Этот бот уже привязан.');
    return;
  }
  const exists = state.claims.some((c) => String(c.userId) === userId || String(c.chatId) === chatId);
  if (!exists) {
    state.claims.push({
      userId,
      chatId,
      username: message.from.username || '',
      firstName: message.from.first_name || '',
      claimedAt: new Date().toISOString(),
    });
    saveState();
  }
  await sendMessage(chatId, 'Earflow ops bot привязан. Используйте /help.');
}

async function handleMessage(message) {
  if (!message || typeof message.text !== 'string') return;
  const text = message.text.trim();
  if (!text.startsWith('/')) return;
  const chatId = String(message.chat.id);
  const [rawCommand, ...rest] = text.split(/\s+/);
  const command = rawCommand.split('@')[0].toLowerCase();
  const args = rest.join(' ');

  if (command === '/claim') {
    await handleClaim(message, args);
    return;
  }

  if (!isAuthorized(message)) {
    await sendMessage(chatId, 'Доступ запрещён. Используйте /claim <secret> в личном чате.');
    return;
  }

  if (!ALLOW_GROUPS && !isPrivateChat(message)) {
    await sendMessage(chatId, 'Ops-команды в группах отключены.');
    return;
  }

  if (command === '/help' || command === '/start') {
    await sendMessage(chatId, helpText());
    return;
  }
  if (command === '/whoami') {
    await sendMessage(chatId, `user_id=${message.from.id}\nchat_id=${message.chat.id}\nchat_type=${message.chat.type}`);
    return;
  }
  if (command === '/status') {
    await sendMessage(chatId, await buildStatus());
    return;
  }
  if (command === '/traffic') {
    await sendMessage(chatId, await buildTraffic());
    return;
  }
  if (command === '/db') {
    await sendMessage(chatId, await buildDb());
    return;
  }
  if (command === '/redis') {
    await sendMessage(chatId, await buildRedis());
    return;
  }
  if (command === '/alerts') {
    await sendMessage(chatId, await buildAlerts());
    return;
  }

  await sendMessage(chatId, 'Неизвестная команда. Используйте /help.');
}

async function pollTelegram() {
  while (!shuttingDown) {
    try {
      const result = await telegram('getUpdates', {
        offset: state.lastUpdateId ? state.lastUpdateId + 1 : undefined,
        timeout: POLL_TIMEOUT_SECONDS,
        allowed_updates: ['message'],
      });
      for (const update of result || []) {
        if (Number.isInteger(update.update_id)) {
          state.lastUpdateId = update.update_id;
          saveState();
        }
        await handleMessage(update.message).catch(async (err) => {
          const chatId = update?.message?.chat?.id;
          if (chatId) await sendMessage(chatId, `Команда не выполнена: ${err.message}`).catch(() => undefined);
        });
      }
    } catch (err) {
      process.stderr.write(`telegram polling error: ${err.message}\n`);
      await sleep(5000);
    }
  }
}

async function alertLoop() {
  while (!shuttingDown) {
    try {
      await sendPrometheusAlerts();
    } catch (err) {
      process.stderr.write(`alert polling error: ${err.message}\n`);
    }
    await sleep(ALERT_POLL_INTERVAL_MS);
  }
}

async function sendPrometheusAlerts() {
  const chats = authorizedChatIds();
  if (!chats.length) return;

  const now = Date.now();
  const alerts = await prometheusAlerts();
  const firing = alerts.filter((a) => a.state === 'firing');
  const activeKeys = new Set(firing.map(alertKey).filter(Boolean));

  for (const alert of firing) {
    const key = alertKey(alert);
    if (!key) continue;
    const previous = state.sentAlerts[key] || 0;
    if (now - previous < ALERT_REPEAT_MS) continue;
    const message = ['Earflow: сработал алерт', formatAlert(alert)].join('\n\n');
    for (const chatId of chats) await sendMessage(chatId, message).catch(() => undefined);
    state.sentAlerts[key] = now;
    state.activeAlerts[key] = true;
  }

  if (SEND_RESOLVED) {
    for (const key of Object.keys(state.activeAlerts)) {
      if (activeKeys.has(key)) continue;
      for (const chatId of chats) await sendMessage(chatId, `Earflow: алерт восстановился\n${key}`).catch(() => undefined);
      delete state.activeAlerts[key];
      delete state.sentAlerts[key];
    }
  }

  saveState();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!BOOTSTRAP_SECRET && STATIC_ALLOWED_USER_IDS.size === 0 && STATIC_ALLOWED_CHAT_IDS.size === 0 && state.claims.length === 0) {
    process.stderr.write('TELEGRAM_OPS_BOOTSTRAP_SECRET or static allowed ids are required\n');
    process.exit(1);
  }
  if (DELETE_WEBHOOK_ON_START) {
    await telegram('deleteWebhook', { drop_pending_updates: false }).catch((err) => {
      process.stderr.write(`deleteWebhook failed: ${err.message}\n`);
    });
  }
  await Promise.all([pollTelegram(), alertLoop()]);
}

main().catch((err) => {
  process.stderr.write(`telegram ops bot fatal: ${err.message}\n`);
  process.exit(1);
});
