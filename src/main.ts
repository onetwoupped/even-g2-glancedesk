import {
  closePaperPosition,
  dismissAlert,
  fetchBackendState,
  fetchCandles,
  moveStopToBE,
  placePaperOrder,
  sendTelegramReply,
  sendVoiceReply,
  takePartialProfit,
} from './api';
import { connectEvenBridge, type GlassesHost } from './bridge';
import { drawG2Preview } from './preview';
import {
  PAPER_NOTIONALS,
  createInitialUIState,
  formatPx,
  getActiveFeedMessage,
  getActiveMarket,
  getActivePosition,
  getActiveTriggeredAlert,
  getAlertActions,
  getManageActions,
  getReplyActions,
  renderPage,
  type Gesture,
  type HudAction,
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
    `(${tg.activeChatId ? tg.activeChatTitle || tg.activeChatId : 'waiting for msg'}) · ` +
    `<strong>Hyperliquid:</strong> ${ui.data.markets.length} perps · ` +
    `<strong>Paper:</strong> $${port.cashUsd.toFixed(0)} (${port.totalPnlUsd >= 0 ? '+' : ''}$${port.totalPnlUsd.toFixed(2)}) · ` +
    `<strong>Open:</strong> ${port.openCount} · <strong>Alerts:</strong> ${port.alerts.length}`;
}

async function ensureActiveCandles(): Promise<void> {
  const mkt = getActiveMarket(ui);
  if (!mkt) return;
  if (ui.candles && ui.candles.symbol === mkt.symbol && ui.candles.closes.length >= 2) return;
  try {
    ui.candles = await fetchCandles(mkt.symbol, '15m');
  } catch {
    // Non-fatal
  }
}

async function paint(forceRebuild = false): Promise<void> {
  const page = renderPage(ui);
  updateStatusBar();
  if (host) await host.render(page, forceRebuild);
  else drawG2Preview(canvas, page);
}

async function syncState(refresh = false): Promise<void> {
  try {
    ui.data = await fetchBackendState(refresh);
    if (!ui.candles && ui.data.candles?.closes?.length >= 2) {
      ui.candles = ui.data.candles;
    }
    await ensureActiveCandles();
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

async function executeAction(action: HudAction): Promise<void> {
  const pos = getActivePosition(ui);
  const alert = getActiveTriggeredAlert(ui);
  const mkt = getActiveMarket(ui);
  const msg = getActiveFeedMessage(ui);
  const notional = PAPER_NOTIONALS[ui.orderStakeIndex % PAPER_NOTIONALS.length];

  try {
    if (action.kind === 'MOVE_BE' && pos) {
      const res = await moveStopToBE(pos.id);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `BE set @ ${formatPx(res.position.stopLoss)}`;
      log(`Stop moved to Break-Even on ${pos.symbol}`);
      ui.view = 'GLANCE';
      await paint(true);
      return;
    }

    if (action.kind === 'TAKE_HALF' && pos) {
      const res = await takePartialProfit(pos.id, 0.5);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `50% closed (${res.partial.realizedPnlUsd >= 0 ? '+' : ''}$${res.partial.realizedPnlUsd.toFixed(1)})`;
      log(`Took 50% profit on ${pos.symbol}`);
      ui.view = 'GLANCE';
      await paint(true);
      return;
    }

    if (action.kind === 'CLOSE_POS' && pos) {
      const res = await closePaperPosition({ positionId: pos.id, notifyTelegram: true });
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `Closed ${pos.symbol} (${res.closed.realizedPnlUsd >= 0 ? '+' : ''}$${res.closed.realizedPnlUsd.toFixed(1)})`;
      log(`Closed ${pos.symbol} @ ${formatPx(res.closed.exitPrice)}`);
      ui.view = 'GLANCE';
      await paint(true);
      return;
    }

    if ((action.kind === 'OPEN_SHORT' || action.kind === 'OPEN_LONG') && mkt) {
      const side = action.kind === 'OPEN_SHORT' ? 'SHORT' : 'LONG';
      const res = await placePaperOrder({
        marketId: mkt.id,
        symbol: mkt.symbol,
        side,
        notionalUsd: notional,
        price: mkt.markPx,
        slPct: 1.5,
        rrRatio: 2.0,
        notifyTelegram: true,
      });
      if (ui.data) ui.data.portfolio = res.portfolio;
      if (alert) await dismissAlert(alert.id);
      ui.toast = `${side} ${mkt.symbol} $${notional} (SL/2R)`;
      log(`Opened paper ${side} ${mkt.symbol} @ ${formatPx(mkt.markPx)}`);
      ui.view = 'MANAGE';
      ui.actionIndex = 0;
      await paint(true);
      return;
    }

    if (action.kind === 'DISMISS_ALERT' && alert) {
      const res = await dismissAlert(alert.id);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = 'Alert dismissed';
      ui.actionIndex = 0;
      await paint(true);
      return;
    }

    if (action.kind === 'SEND_TG_REPLY' && action.payload) {
      await sendTelegramReply({
        chatId: msg?.chatId,
        text: action.payload,
        replyToMessageId: msg?.messageId,
      });
      ui.toast = 'Sent';
      log(`Reply sent: ${action.payload}`);
      ui.view = 'GLANCE';
      await syncState(false);
      await paint(true);
      return;
    }

    if (action.kind === 'GO_ENTRY') {
      await ensureActiveCandles();
      ui.view = 'ENTRY';
      await paint(true);
      return;
    }

    if (action.kind === 'GO_MANAGE') {
      ui.actionIndex = 0;
      ui.view = 'MANAGE';
      await paint(true);
      return;
    }

    if (action.kind === 'GO_REPLY') {
      ui.actionIndex = 0;
      ui.view = 'REPLY';
      await paint(true);
    }
  } catch (err) {
    ui.toast = String((err as Error)?.message || err).slice(0, 28);
    await paint(false);
  }
}

async function handleGesture(g: Gesture): Promise<void> {
  log(`Gesture: ${g} (${ui.view})`);
  ui.toast = '';

  if (g === 'LONG_PRESS_START' && ui.view === 'GLANCE') {
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
        fallbackText: mkt ? `Watching ${mkt.symbol} at ${formatPx(mkt.markPx)}, checking structure.` : 'Got it, watching now.',
        chatId: msg?.chatId,
        replyToMessageId: msg?.messageId,
        sendToTelegram: true,
      });
      ui.toast = 'Voice sent';
      log(`Voice sent: "${res.voice.transcript}"`);
    } catch (err) {
      ui.toast = String((err as Error)?.message || err).slice(0, 24);
    }
    ui.view = 'GLANCE';
    await syncState(false);
    await paint(true);
    return;
  }

  if (ui.view === 'VOICE' && g === 'DOUBLE_TAP') {
    await host?.stopMic();
    ui.voiceCapturing = false;
    ui.view = 'GLANCE';
    await paint(true);
    return;
  }

  if (ui.view === 'GLANCE') {
    const alert = getActiveTriggeredAlert(ui);
    const pos = getActivePosition(ui);
    const inPriorityPrompt = Boolean(alert) || Boolean(pos && pos.currentR >= 1.5 && !pos.isBreakEven);

    if (inPriorityPrompt) {
      const actions = alert ? getAlertActions(ui) : getManageActions(ui).slice(0, 3);
      if (g === 'SWIPE_DOWN') {
        ui.actionIndex = (ui.actionIndex + 1) % actions.length;
        await paint(false);
      } else if (g === 'SWIPE_UP') {
        ui.actionIndex = (ui.actionIndex - 1 + actions.length) % actions.length;
        await paint(false);
      } else if (g === 'TAP') {
        await executeAction(actions[ui.actionIndex % actions.length]);
      } else if (g === 'DOUBLE_TAP') {
        await host?.exitRoot();
      }
      return;
    }

    if (g === 'SWIPE_DOWN') {
      if ((ui.data?.feed.length || 0) > 0) ui.feedIndex += 1;
      else ui.marketIndex += 1;
      await ensureActiveCandles();
      await paint(false);
    } else if (g === 'SWIPE_UP') {
      if ((ui.data?.feed.length || 0) > 0) ui.feedIndex -= 1;
      else ui.marketIndex -= 1;
      await ensureActiveCandles();
      await paint(false);
    } else if (g === 'TAP') {
      ui.actionIndex = 0;
      if (pos) ui.view = 'MANAGE';
      else if (getActiveFeedMessage(ui)) ui.view = 'REPLY';
      else ui.view = 'ENTRY';
      await ensureActiveCandles();
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      await host?.exitRoot();
    }
    return;
  }

  if (ui.view === 'MANAGE') {
    const actions = getManageActions(ui);
    if (g === 'SWIPE_DOWN') {
      ui.actionIndex = (ui.actionIndex + 1) % actions.length;
      await paint(false);
    } else if (g === 'SWIPE_UP') {
      ui.actionIndex = (ui.actionIndex - 1 + actions.length) % actions.length;
      await paint(false);
    } else if (g === 'TAP') {
      await executeAction(actions[ui.actionIndex % actions.length]);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'GLANCE';
      await paint(true);
    }
    return;
  }

  if (ui.view === 'ENTRY') {
    if (g === 'SWIPE_DOWN' || g === 'SWIPE_UP') {
      ui.orderSide = ui.orderSide === 'SHORT' ? 'LONG' : 'SHORT';
      if (g === 'SWIPE_UP') ui.orderStakeIndex = (ui.orderStakeIndex + 1) % PAPER_NOTIONALS.length;
      await paint(false);
    } else if (g === 'TAP') {
      await executeAction({
        label: ui.orderSide,
        kind: ui.orderSide === 'SHORT' ? 'OPEN_SHORT' : 'OPEN_LONG',
      });
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'GLANCE';
      await paint(true);
    }
    return;
  }

  if (ui.view === 'REPLY') {
    const actions = getReplyActions(ui);
    if (g === 'SWIPE_DOWN') {
      ui.actionIndex = (ui.actionIndex + 1) % actions.length;
      await paint(false);
    } else if (g === 'SWIPE_UP') {
      ui.actionIndex = (ui.actionIndex - 1 + actions.length) % actions.length;
      await paint(false);
    } else if (g === 'TAP') {
      await executeAction(actions[ui.actionIndex % actions.length]);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'GLANCE';
      await paint(true);
    }
  }
}

async function boot(): Promise<void> {
  host = await connectEvenBridge((page) => drawG2Preview(canvas, page), log);
  badgeEl.textContent = host.mode === 'EVEN_G2_SDK' ? 'EVEN G2 LIVE SDK' : 'G2 SIM PREVIEW';
  host.onGesture((g) => void handleGesture(g));
  host.onMenuSelect((id) => {
    ui.actionIndex = 0;
    if (id === 1) ui.view = 'GLANCE';
    else if (id === 2) ui.view = 'MANAGE';
    else if (id === 3) ui.view = 'ENTRY';
    else if (id === 4) void syncState(true);
    void paint(true);
  });

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
  setInterval(() => void syncState(false), 8000);
}

void boot();
