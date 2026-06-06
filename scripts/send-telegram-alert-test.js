#!/usr/bin/env node
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const ENV_PATH = path.resolve(process.cwd(), '.env');
const TOKEN_KEYS = ['TELEGRAM_OPS_BOT_TOKEN', 'ALERTMANAGER_TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_TOKEN'];
const CHAT_ID_KEYS = ['TELEGRAM_OPS_ALLOWED_CHAT_IDS', 'ALERTMANAGER_TELEGRAM_CHAT_ID'];

function parseDotEnv(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getConfig() {
  const fileEnv = fs.existsSync(ENV_PATH) ? parseDotEnv(fs.readFileSync(ENV_PATH, 'utf8')) : {};
  const token = firstEnv(TOKEN_KEYS, fileEnv);
  const chatId = firstEnv(CHAT_ID_KEYS, fileEnv).split(',').map((v) => v.trim()).find(Boolean) || '';
  return { token: token.trim(), chatId: chatId.trim() };
}

function firstEnv(keys, fileEnv) {
  for (const key of keys) {
    const value = process.env[key] || fileEnv[key] || '';
    if (String(value).trim()) return String(value).trim();
  }
  return '';
}

function postTelegramMessage({ token, chatId, text }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: chatId, text, disable_notification: false });
    const req = https.request({
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${encodeURIComponent(token).replace(/%3A/i, ':')}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 10_000,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`Telegram API returned HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Telegram API request timed out'));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const { token, chatId } = getConfig();
  if (!token || !chatId) {
    throw new Error('Telegram bot token and chat id must be set in .env or environment');
  }

  await postTelegramMessage({
    token,
    chatId,
    text: `Earflow monitoring test alert\nstatus=ok\ntime=${new Date().toISOString()}`,
  });
  process.stdout.write('Telegram alert test sent successfully\n');
}

main().catch((err) => {
  process.stderr.write(`Telegram alert test failed: ${err.message}\n`);
  process.exit(1);
});
