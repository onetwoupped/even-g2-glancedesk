import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HyperliquidClient, matchMarketToText } from './hyperliquid.mjs';
import { PaperLedger } from './ledger.mjs';
import { TelegramService, buildSmartReplies, formatPrice } from './telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

function loadDotEnv(envPath) {
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    out[k] = v;
  }
  return out;
}

const dotEnv = loadDotEnv(path.join(ROOT_DIR, '.env'));
const env = (key, fallback = '') => process.env[key] ?? dotEnv[key] ?? fallback;

const PORT = Number(env('PORT', '8787'));
const RUNTIME_DIR = path.join(__dirname, '.runtime');

const telegram = new TelegramService({
  token: env('TELEGRAM_BOT_TOKEN', ''),
  defaultChatId: env('TELEGRAM_DEFAULT_CHAT_ID', ''),
  storagePath: path.join(RUNTIME_DIR, 'telegram_cache.json'),
});
const hyperliquid = new HyperliquidClient(10000);
const ledger = new PaperLedger(path.join(RUNTIME_DIR, 'ledger.json'));

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  setCorsHeaders(res);
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 2 * 1024 * 1024) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function buildWavFromPcm16(pcmBuffer, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function handleVoiceTranscription(pcmBase64, fallbackText) {
  const pcmBuf = Buffer.from(String(pcmBase64 || ''), 'base64');
  const durationMs = Math.round((pcmBuf.length / 2 / 16000) * 1000);
  const openaiKey = env('OPENAI_API_KEY', '');

  if (openaiKey && pcmBuf.length > 640) {
    const wav = buildWavFromPcm16(pcmBuf, 16000);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'g2_voice.wav');
    form.append('model', 'whisper-1');
    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        provider: 'whisper-1',
        durationMs,
        bytes: pcmBuf.length,
        transcript: String(data.text || '').trim(),
      };
    }
  }

  return {
    provider: 'g2-local-command',
    durationMs,
    bytes: pcmBuf.length,
    transcript: String(fallbackText || 'Voice ack from Even G2: checking live Hyperliquid mark now.').trim(),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  const urlObj = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      if (!telegram.botInfo && telegram.configured) {
        await telegram.verifyBot();
      }
      return sendJson(res, 200, {
        ok: true,
        app: 'GlanceDesk Backend Proxy (Telegram + Hyperliquid)',
        mode: 'PAPER_ONLY',
        telegramConfigured: telegram.configured,
        botUsername: telegram.botInfo?.username || env('TELEGRAM_BOT_USERNAME', ''),
        activeChatId: telegram.activeChatId || null,
        activeChatTitle: telegram.activeChatTitle || null,
        time: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      const [tgState, hlState] = await Promise.all([
        telegram.pollUpdates(),
        hyperliquid.getMarkets(urlObj.searchParams.get('refresh') === '1'),
      ]);

      const markets = hlState.markets;
      const incoming = tgState.messages.filter((m) => m.direction === 'IN');
      const feedSource = incoming.length > 0 ? incoming : tgState.messages;

      const feed = feedSource.map((msg) => {
        const linkedMarket = matchMarketToText(msg.text, markets);
        return {
          ...msg,
          linkedMarket,
          smartReplies: buildSmartReplies(msg.text, linkedMarket),
        };
      });

      return sendJson(res, 200, {
        ok: true,
        telegram: {
          connected: tgState.connected,
          botUsername: tgState.botUsername || env('TELEGRAM_BOT_USERNAME', ''),
          activeChatId: tgState.activeChatId || null,
          activeChatTitle: tgState.activeChatTitle || null,
          lastError: tgState.lastError,
        },
        markets: markets.slice(0, 15),
        feed,
        portfolio: ledger.snapshot(markets),
        updatedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'POST' && pathname === '/api/telegram/reply') {
      const body = await readJsonBody(req);
      const sent = await telegram.sendMessage({
        chatId: body.chatId,
        text: body.text,
        replyToMessageId: body.replyToMessageId,
      });
      return sendJson(res, 200, { ok: true, sent });
    }

    if (req.method === 'POST' && pathname === '/api/paper/order') {
      const body = await readJsonBody(req);
      const hlState = await hyperliquid.getMarkets();
      const sym = String(body.symbol || body.marketId || 'BTC').replace(/-PERP$/i, '').toUpperCase();
      const market = hlState.markets.find((m) => m.symbol.toUpperCase() === sym);
      const side = String(body.side || 'LONG').toUpperCase();
      const fillPrice = market ? market.markPx : Number(body.price || 0);

      const order = ledger.placePaperOrder({
        marketId: `${sym}-PERP`,
        symbol: sym,
        side,
        notionalUsd: Number(body.notionalUsd || 250),
        price: fillPrice,
      });

      let receiptSent = false;
      if (body.notifyTelegram !== false && telegram.configured && telegram.activeChatId) {
        try {
          await telegram.sendMessage({
            text:
              `[GlanceDesk G2 · HYPERLIQUID PAPER]\n` +
              `Perp: ${order.symbol}-PERP\n` +
              `Action: ${order.side} $${order.notionalUsd} @ ${formatPrice(order.entryPrice)} (${order.sizeQty} ${order.symbol})\n` +
              `Simulated paper execution only — no real funds.`,
          });
          receiptSent = true;
        } catch {
          receiptSent = false;
        }
      }

      return sendJson(res, 200, {
        ok: true,
        order,
        receiptSent,
        portfolio: ledger.snapshot(hlState.markets),
      });
    }

    if (req.method === 'POST' && pathname === '/api/paper/reset') {
      return sendJson(res, 200, { ok: true, portfolio: ledger.reset() });
    }

    if (req.method === 'POST' && pathname === '/api/voice/reply') {
      const body = await readJsonBody(req);
      const result = await handleVoiceTranscription(body.pcmBase64, body.fallbackText);
      let sent = null;
      if (body.sendToTelegram && result.transcript && telegram.configured && telegram.activeChatId) {
        sent = await telegram.sendMessage({
          chatId: body.chatId,
          text: `[G2 Voice] ${result.transcript}`,
          replyToMessageId: body.replyToMessageId,
        });
      }
      return sendJson(res, 200, { ok: true, voice: result, sent });
    }

    return sendJson(res, 404, { ok: false, error: `Unknown route: ${req.method} ${pathname}` });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  await telegram.verifyBot();
  console.log(`[GlanceDesk] Backend listening on http://127.0.0.1:${PORT}`);
  console.log(
    `[GlanceDesk] Telegram bot: ${telegram.botInfo?.username ? '@' + telegram.botInfo.username : 'unverified/offline'}`
  );
});
