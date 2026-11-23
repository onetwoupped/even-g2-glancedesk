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
const hyperliquid = new HyperliquidClient(8000);
const ledger = new PaperLedger(path.join(RUNTIME_DIR, 'ledger.json'));
const handledCommands = new Set();

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

async function notifyTg(text, chatId, replyToMessageId) {
  if (!telegram.configured || !(chatId || telegram.activeChatId)) return false;
  try {
    await telegram.sendMessage({ chatId, text, replyToMessageId });
    return true;
  } catch {
    return false;
  }
}

async function processTelegramCommands(messages, markets) {
  if (!telegram.configured) return;
  for (const msg of messages) {
    if (msg.direction !== 'IN' || !msg.text.startsWith('/') || handledCommands.has(msg.id)) continue;
    handledCommands.add(msg.id);
    const parts = msg.text.trim().split(/\s+/);
    const cmd = parts[0].split('@')[0].toLowerCase();

    try {
      if ((cmd === '/risk' || cmd === '/r') && parts[1]) {
        const res = ledger.setRiskBudget(Number(parts[1].replace(/^\$/, '')));
        await notifyTg(
          `1R risk set to $${res.defaultRiskUsd} (0.5R = $${(res.defaultRiskUsd * 0.5).toFixed(0)} · 2R = $${(res.defaultRiskUsd * 2).toFixed(0)}).`,
          msg.chatId,
          msg.messageId
        );
      } else if (cmd === '/price' && parts[1]) {
        const sym = parts[1].replace(/^\$/, '').toUpperCase();
        const m = markets.find((x) => x.symbol.toUpperCase() === sym);
        const text = m
          ? `${m.symbol} ${formatPrice(m.markPx)} (${m.change24hPct >= 0 ? '+' : ''}${m.change24hPct}% 24h · fund ${m.fundingHourlyPct}%)`
          : `${sym} not found on Hyperliquid.`;
        await notifyTg(text, msg.chatId, msg.messageId);
      } else if (cmd === '/alert' && parts[1] && parts[2]) {
        const sym = parts[1].replace(/^\$/, '').toUpperCase();
        const target = Number(parts[2]);
        const note = parts.slice(3).join(' ');
        const m = markets.find((x) => x.symbol.toUpperCase() === sym);
        const al = ledger.addAlert({ symbol: sym, targetPrice: target, currentPrice: m?.markPx, note });
        await notifyTg(
          `Alert armed: ${al.symbol} ${al.direction.toLowerCase()} ${formatPrice(al.targetPrice)}${note ? ` (${note})` : ''}`,
          msg.chatId,
          msg.messageId
        );
      } else if (cmd === '/be') {
        const pos = ledger.moveStopToBreakEven();
        await notifyTg(`Stop moved to BE (${formatPrice(pos.stopLoss)}) on ${pos.side} ${pos.symbol}.`, msg.chatId, msg.messageId);
      } else if (cmd === '/half') {
        const snap = ledger.snapshot(markets);
        if (snap.positions.length > 0) {
          const top = snap.positions[0];
          const res = ledger.takePartialProfit(top.id, 0.5, top.markPx);
          const sign = res.realizedPnlUsd >= 0 ? '+' : '';
          await notifyTg(
            `Closed 50% of ${res.side} ${res.symbol} @ ${formatPrice(res.exitPrice)} (${sign}$${res.realizedPnlUsd.toFixed(2)}).`,
            msg.chatId,
            msg.messageId
          );
        }
      } else if (cmd === '/pnl') {
        const snap = ledger.snapshot(markets);
        const sign = snap.totalPnlUsd >= 0 ? '+' : '';
        const lines = [`Paper equity $${snap.equityUsd.toFixed(2)} (${sign}$${snap.totalPnlUsd.toFixed(2)}) · 1R = $${snap.defaultRiskUsd}`];
        for (const p of snap.positions.slice(0, 3)) {
          const rs = p.currentR >= 0 ? '+' : '';
          lines.push(`${p.side} ${p.symbol} risk $${p.riskUsd} (${rs}${p.currentR}R) · SL ${formatPrice(p.stopLoss)}${p.isBreakEven ? ' (BE)' : ''}`);
        }
        await notifyTg(lines.join('\n'), msg.chatId, msg.messageId);
      } else if (cmd === '/close') {
        const snap = ledger.snapshot(markets);
        if (snap.positions.length === 0) {
          await notifyTg('No open paper positions.', msg.chatId, msg.messageId);
        } else {
          const top = snap.positions[0];
          const closed = ledger.closePosition(top.id, top.markPx, 'MANUAL');
          const sign = closed.realizedPnlUsd >= 0 ? '+' : '';
          await notifyTg(
            `Closed ${closed.side} ${closed.symbol} @ ${formatPrice(closed.exitPrice)} (${sign}$${closed.realizedPnlUsd.toFixed(2)} paper).`,
            msg.chatId,
            msg.messageId
          );
        }
      } else if (cmd === '/help' || cmd === '/start') {
        await notifyTg(
          'Commands:\n/risk 242 — set your exact 1R dollar risk\n/alert NEAR 4.20 structure\n/be · /half · /close · /pnl · /price NEAR',
          msg.chatId,
          msg.messageId
        );
      }
    } catch {
      // Ignore malformed command
    }
  }
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
      if (!telegram.botInfo && telegram.configured) await telegram.verifyBot();
      return sendJson(res, 200, {
        ok: true,
        app: 'GlanceDesk v5 (Even G2 1R Risk-Sized Candlestick HUD)',
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
      await processTelegramCommands(tgState.messages, markets);

      const triggerEvents = ledger.evaluateTriggers(markets);
      for (const ev of triggerEvents) {
        if (ev.kind === 'PRICE_ALERT') {
          await notifyTg(
            `Alert hit: ${ev.alert.symbol} crossed ${ev.alert.direction.toLowerCase()} ${formatPrice(ev.alert.targetPrice)} (now ${formatPrice(ev.markPx)}).`
          );
        } else if (ev.kind === 'R_TARGET_1_5') {
          await notifyTg(
            `${ev.side} ${ev.symbol} hit +${ev.rMultiple}R (${formatPrice(ev.markPx)}). Tap G2 to move stop to BE (${formatPrice(ev.entryPrice)}).`
          );
        } else if (ev.kind === 'STOP_HIT' || ev.kind === 'TP_HIT') {
          const sign = ev.closed.realizedPnlUsd >= 0 ? '+' : '';
          await notifyTg(
            `${ev.closed.reason}: ${ev.closed.side} ${ev.closed.symbol} closed @ ${formatPrice(ev.closed.exitPrice)} (${sign}$${ev.closed.realizedPnlUsd.toFixed(2)} paper).`
          );
        }
      }

      const incoming = tgState.messages.filter((m) => m.direction === 'IN' && !m.text.startsWith('/'));
      const feedSource = incoming.length > 0 ? incoming : tgState.messages;
      const feed = feedSource.map((msg) => {
        const linkedMarket = matchMarketToText(msg.text, markets);
        return {
          ...msg,
          linkedMarket,
          smartReplies: buildSmartReplies(msg.text, linkedMarket),
        };
      });

      const portfolio = ledger.snapshot(markets);
      const prioritySymbol =
        portfolio.activeTriggeredAlerts[0]?.symbol ||
        portfolio.positions[0]?.symbol ||
        feed[0]?.linkedMarket?.symbol ||
        'ETH';
      const candles = await hyperliquid.getStructureCandles(prioritySymbol, '15m');

      return sendJson(res, 200, {
        ok: true,
        telegram: {
          connected: tgState.connected,
          botUsername: tgState.botUsername || env('TELEGRAM_BOT_USERNAME', ''),
          activeChatId: tgState.activeChatId || null,
          activeChatTitle: tgState.activeChatTitle || null,
          lastError: tgState.lastError,
        },
        markets: markets.slice(0, 60),
        feed,
        candles,
        portfolio,
        updatedAt: new Date().toISOString(),
      });
    }

    if (req.method === 'GET' && pathname === '/api/candles') {
      const sym = urlObj.searchParams.get('symbol') || 'ETH';
      const interval = urlObj.searchParams.get('interval') || '15m';
      const candles = await hyperliquid.getStructureCandles(sym, interval);
      return sendJson(res, 200, { ok: true, candles });
    }

    if (req.method === 'POST' && pathname === '/api/prefs') {
      const body = await readJsonBody(req);
      const prefs = ledger.setRiskBudget(body.riskUsd);
      const hlState = await hyperliquid.getMarkets();
      return sendJson(res, 200, { ok: true, prefs, portfolio: ledger.snapshot(hlState.markets) });
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
      const sym = String(body.symbol || body.marketId || 'ETH').replace(/-PERP$/i, '').toUpperCase();
      const market = hlState.markets.find((m) => m.symbol.toUpperCase() === sym);
      const side = String(body.side || 'LONG').toUpperCase();
      const fillPrice = market ? market.markPx : Number(body.price || 0);

      const order = ledger.placePaperOrder({
        marketId: `${sym}-PERP`,
        symbol: sym,
        side,
        riskUsd: Number(body.riskUsd ?? ledger.state.defaultRiskUsd),
        price: fillPrice,
        stopLoss: Number(body.stopLoss),
        takeProfit: Number(body.takeProfit),
      });

      const receiptSent =
        body.notifyTelegram !== false
          ? await notifyTg(
              `Paper ${order.side} ${order.symbol} @ ${formatPrice(order.entryPrice)}\n` +
                `Auto-sized: ${order.sizeQty.toFixed(3)} ${order.symbol} ($${order.notionalUsd.toFixed(0)} notional)\n` +
                `SL ${formatPrice(order.stopLoss)} (-$${order.riskUsd.toFixed(2)}) · TP ${formatPrice(order.takeProfit)} (+$${order.plannedProfitUsd.toFixed(2)} · ${order.plannedRR}R)`
            )
          : false;

      return sendJson(res, 200, {
        ok: true,
        order,
        receiptSent,
        portfolio: ledger.snapshot(hlState.markets),
      });
    }

    if (req.method === 'POST' && pathname === '/api/paper/be') {
      const body = await readJsonBody(req);
      const hlState = await hyperliquid.getMarkets();
      const pos = ledger.moveStopToBreakEven(body.positionId);
      const receiptSent =
        body.notifyTelegram !== false
          ? await notifyTg(`Stop moved to BE (${formatPrice(pos.stopLoss)}) on ${pos.side} ${pos.symbol}.`)
          : false;
      return sendJson(res, 200, { ok: true, position: pos, receiptSent, portfolio: ledger.snapshot(hlState.markets) });
    }

    if (req.method === 'POST' && pathname === '/api/paper/partial') {
      const body = await readJsonBody(req);
      const hlState = await hyperliquid.getMarkets();
      const snap = ledger.snapshot(hlState.markets);
      const target = body.positionId
        ? snap.positions.find((p) => p.id === body.positionId)
        : snap.positions[0];
      if (!target) throw new Error('No open position for partial close');

      const partial = ledger.takePartialProfit(target.id, Number(body.ratio || 0.5), target.markPx);
      const sign = partial.realizedPnlUsd >= 0 ? '+' : '';
      const receiptSent =
        body.notifyTelegram !== false
          ? await notifyTg(
              `Took 50% on ${partial.side} ${partial.symbol} @ ${formatPrice(partial.exitPrice)} (${sign}$${partial.realizedPnlUsd.toFixed(2)} paper).`
            )
          : false;

      return sendJson(res, 200, { ok: true, partial, receiptSent, portfolio: ledger.snapshot(hlState.markets) });
    }

    if (req.method === 'POST' && pathname === '/api/paper/close') {
      const body = await readJsonBody(req);
      const hlState = await hyperliquid.getMarkets();
      const snapBefore = ledger.snapshot(hlState.markets);
      const target = body.positionId
        ? snapBefore.positions.find((p) => p.id === body.positionId)
        : snapBefore.positions[0];
      if (!target) throw new Error('No open paper position to close');

      const closed = ledger.closePosition(target.id, target.markPx, 'MANUAL');
      const sign = closed.realizedPnlUsd >= 0 ? '+' : '';
      const receiptSent =
        body.notifyTelegram !== false
          ? await notifyTg(
              `Closed ${closed.side} ${closed.symbol} @ ${formatPrice(closed.exitPrice)} (${sign}$${closed.realizedPnlUsd.toFixed(2)} paper).`
            )
          : false;

      return sendJson(res, 200, { ok: true, closed, receiptSent, portfolio: ledger.snapshot(hlState.markets) });
    }

    if (req.method === 'POST' && pathname === '/api/alerts') {
      const body = await readJsonBody(req);
      const hlState = await hyperliquid.getMarkets();
      const sym = String(body.symbol || 'ETH').replace(/-PERP$/i, '').toUpperCase();
      const m = hlState.markets.find((x) => x.symbol.toUpperCase() === sym);
      const alert = ledger.addAlert({
        symbol: sym,
        targetPrice: body.targetPrice,
        currentPrice: m?.markPx,
        note: body.note || '',
      });
      return sendJson(res, 200, { ok: true, alert, portfolio: ledger.snapshot(hlState.markets) });
    }

    if (req.method === 'POST' && pathname === '/api/alerts/dismiss') {
      const body = await readJsonBody(req);
      ledger.dismissAlert(body.alertId);
      const hlState = await hyperliquid.getMarkets();
      return sendJson(res, 200, { ok: true, portfolio: ledger.snapshot(hlState.markets) });
    }

    if (req.method === 'POST' && pathname === '/api/paper/reset') {
      return sendJson(res, 200, { ok: true, portfolio: ledger.reset() });
    }

    return sendJson(res, 404, { ok: false, error: `Unknown route: ${req.method} ${pathname}` });
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  await telegram.verifyBot();
  console.log(`[GlanceDesk v5] Backend listening on http://127.0.0.1:${PORT}`);
  console.log(
    `[GlanceDesk v5] Telegram bot: ${telegram.botInfo?.username ? '@' + telegram.botInfo.username : 'unverified/offline'}`
  );
});
