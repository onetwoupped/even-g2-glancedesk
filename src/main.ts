import {
  fetchBackendState,
  placePaperOrder,
  sendTelegramReply,
  sendVoiceReply,
} from './api';
import { connectEvenBridge, type GlassesHost } from './bridge';
import { drawG2Preview } from './preview';
import {
  PAPER_NOTIONALS,
  createInitialUIState,
  formatPx,
  getActiveFeedMessage,
  getActiveMarket,
  getReplyOptions,
  renderPage,
  type Gesture,
} from './state';

const canvas = document.getElementById('g2-canvas') as HTMLCanvasElement;
const badgeEl = document.getElementById('runtime-badge') as HTMLElement;
const viewEl = document.getElementById('view-indicator') as HTMLElement;
const statusEl = document.getElementById('status-panel') as HTMLElement;
const logEl = document.getElementById('event-log') as HTMLElement;

const ui = createInitialUIState();
let host: GlassesHost | null = null;
let pcmChunks: Uint8Array[] = [];

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  const row = document.createElement('div');
  row.textContent = `[${ts}] ${msg}`;
  logEl.prepend(row);
}

function updateStatusBar(): void {
  viewEl.textContent = `VIEW: ${ui.view}`;
  if (!ui.data) return;
  const tg = ui.data.telegram;
  const port = ui.data.portfolio;
  statusEl.innerHTML =
    `<strong>Telegram:</strong> @${tg.botUsername || 'sezirneonbot'} ` +
    `(${tg.activeChatId ? `chat ${tg.activeChatTitle || tg.activeChatId}` : 'waiting for 1st group msg'}) · ` +
    `<strong>Hyperliquid:</strong> ${ui.data.markets.length} live perps · ` +
    `<strong>Paper Cash:</strong> $${port.cashUsd.toFixed(2)} · ` +
    `<strong>PnL:</strong> ${port.totalPnlUsd >= 0 ? '+' : ''}$${port.totalPnlUsd.toFixed(2)} (PAPER ONLY)`;
}

async function paint(forceRebuild = false): Promise<void> {
  const page = renderPage(ui);
  updateStatusBar();
  if (host) {
    await host.render(page, forceRebuild);
  } else {
    drawG2Preview(canvas, page);
  }
}

async function syncState(refresh = false): Promise<void> {
  try {
    ui.data = await fetchBackendState(refresh);
    await paint(false);
  } catch (err) {
    log(`Sync error: ${String((err as Error)?.message || err)}`);
    await paint(false);
  }
}

function concatUint8(chunks: Uint8Array[]): string {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.length;
  }
  let bin = '';
  for (let i = 0; i < merged.length; i++) bin += String.fromCharCode(merged[i]);
  return btoa(bin);
}

async function handleGesture(g: Gesture): Promise<void> {
  log(`Gesture: ${g} (on ${ui.view})`);
  ui.toast = '';

  if (g === 'LONG_PRESS_START' && ui.view === 'FEED') {
    ui.view = 'VOICE';
    ui.voiceCapturing = true;
    pcmChunks = [];
    await paint(true);
    await host?.startMic((chunk) => pcmChunks.push(chunk));
    return;
  }

  if (g === 'LONG_PRESS_END' && ui.view === 'VOICE') {
    await host?.stopMic();
    ui.voiceCapturing = false;
    const msg = getActiveFeedMessage(ui);
    const mkt = getActiveMarket(ui);
    try {
      const res = await sendVoiceReply({
        pcmBase64: concatUint8(pcmChunks),
        fallbackText: mkt
          ? `Voice note from G2: tracking ${mkt.symbol}-PERP @ ${formatPx(mkt.markPx)}`
          : 'Voice ack from Even G2: saw your message.',
        chatId: msg?.chatId,
        replyToMessageId: msg?.messageId,
        sendToTelegram: true,
      });
      ui.toast = `VOICE SENT (${res.voice.provider})`;
      log(`Voice reply sent: "${res.voice.transcript}"`);
    } catch (err) {
      ui.toast = `VOICE ERR: ${String((err as Error)?.message || err).slice(0, 32)}`;
    }
    ui.view = 'FEED';
    await syncState(false);
    await paint(true);
    return;
  }

  if (ui.view === 'VOICE' && g === 'DOUBLE_TAP') {
    await host?.stopMic();
    ui.voiceCapturing = false;
    ui.view = 'FEED';
    await paint(true);
    return;
  }

  if (ui.view === 'FEED') {
    if (g === 'SWIPE_DOWN') {
      if ((ui.data?.feed.length || 0) > 0) ui.feedIndex += 1;
      else ui.marketIndex += 1;
      await paint(false);
    } else if (g === 'SWIPE_UP') {
      if ((ui.data?.feed.length || 0) > 0) ui.feedIndex -= 1;
      else ui.marketIndex -= 1;
      await paint(false);
    } else if (g === 'TAP') {
      if (getActiveFeedMessage(ui)) {
        ui.replyOptionIndex = 0;
        ui.view = 'REPLY';
      } else {
        ui.view = 'ORDER';
      }
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      await host?.exitRoot();
    }
    return;
  }

  if (ui.view === 'REPLY') {
    const opts = getReplyOptions(ui);
    if (g === 'SWIPE_DOWN') {
      ui.replyOptionIndex = (ui.replyOptionIndex + 1) % opts.length;
      await paint(false);
    } else if (g === 'SWIPE_UP') {
      ui.replyOptionIndex = (ui.replyOptionIndex - 1 + opts.length) % opts.length;
      await paint(false);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'FEED';
      await paint(true);
    } else if (g === 'TAP') {
      const selected = opts[ui.replyOptionIndex % opts.length];
      if (selected.kind === 'GO_ORDER') {
        ui.view = 'ORDER';
        await paint(true);
        return;
      }
      if (selected.kind === 'GO_PORT') {
        ui.view = 'PORT';
        await paint(true);
        return;
      }
      const msg = getActiveFeedMessage(ui);
      try {
        await sendTelegramReply({
          chatId: msg?.chatId,
          text: `[G2] ${selected.label}`,
          replyToMessageId: msg?.messageId,
        });
        ui.toast = 'SENT TO TELEGRAM';
        log(`Telegram reply sent: ${selected.label}`);
      } catch (err) {
        ui.toast = `TG ERR: ${String((err as Error)?.message || err).slice(0, 34)}`;
      }
      ui.view = 'FEED';
      await syncState(false);
      await paint(true);
    }
    return;
  }

  if (ui.view === 'ORDER') {
    if (g === 'SWIPE_DOWN' || g === 'SWIPE_UP') {
      ui.orderSide = ui.orderSide === 'LONG' ? 'SHORT' : 'LONG';
      if (g === 'SWIPE_UP') {
        ui.orderStakeIndex = (ui.orderStakeIndex + 1) % PAPER_NOTIONALS.length;
      }
      await paint(false);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'FEED';
      await paint(true);
    } else if (g === 'TAP') {
      const mkt = getActiveMarket(ui);
      if (!mkt) {
        ui.toast = 'NO MARKET LOADED';
        ui.view = 'FEED';
        await paint(true);
        return;
      }
      const notional = PAPER_NOTIONALS[ui.orderStakeIndex % PAPER_NOTIONALS.length];
      try {
        const res = await placePaperOrder({
          marketId: mkt.id,
          symbol: mkt.symbol,
          side: ui.orderSide,
          notionalUsd: notional,
          price: mkt.markPx,
          notifyTelegram: true,
        });
        if (ui.data) ui.data.portfolio = res.portfolio;
        ui.toast = `PAPER ${ui.orderSide} ${mkt.symbol} $${notional}${res.receiptSent ? ' + TG' : ''}`;
        log(`Paper order filled: ${ui.orderSide} ${mkt.symbol}-PERP $${notional} @ ${formatPx(mkt.markPx)}`);
        ui.view = 'PORT';
        await paint(true);
      } catch (err) {
        ui.toast = `ORDER ERR: ${String((err as Error)?.message || err).slice(0, 30)}`;
        ui.view = 'FEED';
        await paint(true);
      }
    }
    return;
  }

  if (ui.view === 'PORT') {
    if (g === 'SWIPE_DOWN') {
      ui.portIndex += 1;
      await paint(false);
    } else if (g === 'SWIPE_UP') {
      ui.portIndex = Math.max(0, ui.portIndex - 1);
      await paint(false);
    } else if (g === 'TAP') {
      await syncState(true);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'FEED';
      await paint(true);
    }
  }
}

async function boot(): Promise<void> {
  host = await connectEvenBridge((page) => drawG2Preview(canvas, page), log);
  badgeEl.textContent = host.mode === 'EVEN_G2_SDK' ? 'EVEN G2 LIVE SDK' : 'G2 SIM PREVIEW';
  host.onGesture((g) => void handleGesture(g));

  document.getElementById('btn-up')?.addEventListener('click', () => void handleGesture('SWIPE_UP'));
  document.getElementById('btn-tap')?.addEventListener('click', () => void handleGesture('TAP'));
  document.getElementById('btn-down')?.addEventListener('click', () => void handleGesture('SWIPE_DOWN'));
  document.getElementById('btn-dbl')?.addEventListener('click', () => void handleGesture('DOUBLE_TAP'));
  const voiceBtn = document.getElementById('btn-voice');
  voiceBtn?.addEventListener('mousedown', () => void handleGesture('LONG_PRESS_START'));
  voiceBtn?.addEventListener('mouseup', () => void handleGesture('LONG_PRESS_END'));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') void handleGesture('SWIPE_UP');
    if (e.key === 'ArrowDown') void handleGesture('SWIPE_DOWN');
    if (e.key === 'Enter') void handleGesture('TAP');
    if (e.key === 'Escape') void handleGesture('DOUBLE_TAP');
    if (e.key.toLowerCase() === 'v' && !e.repeat) void handleGesture('LONG_PRESS_START');
  });
  window.addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 'v') void handleGesture('LONG_PRESS_END');
  });

  await syncState(true);
  setInterval(() => void syncState(false), 10000);
}

void boot();
