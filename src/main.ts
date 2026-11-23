import {
  closePaperPosition,
  dismissAlert,
  fetchBackendState,
  fetchCandles,
  moveStopToBE,
  placePaperOrder,
  savePrefs,
  sendTelegramReply,
  takePartialProfit,
} from './api';
import { connectEvenBridge, type GlassesHost } from './bridge';
import { drawG2Preview } from './preview';
import {
  LEVERAGE_PRESETS,
  MARGIN_PRESETS,
  computeTicketMath,
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
const marginInput = document.getElementById('inp-margin') as HTMLInputElement | null;
const levInput = document.getElementById('inp-lev') as HTMLInputElement | null;

const ui = createInitialUIState();
let host: GlassesHost | null = null;

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
    `(${tg.activeChatId ? tg.activeChatTitle || tg.activeChatId : 'waiting'}) · ` +
    `<strong>Hyperliquid:</strong> ${ui.data.markets.length} perps · ` +
    `<strong>Paper:</strong> $${port.cashUsd.toFixed(0)} (${port.totalPnlUsd >= 0 ? '+' : ''}$${port.totalPnlUsd.toFixed(2)}) · ` +
    `<strong>Default:</strong> $${ui.ticketMarginUsd} × ${ui.ticketLeverage}x`;
}

async function ensureActiveCandles(): Promise<void> {
  const mkt = getActiveMarket(ui);
  if (!mkt) return;
  if (ui.candles && ui.candles.symbol === mkt.symbol && ui.candles.bars.length >= 2) return;
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
    const prevDefMargin = ui.data?.portfolio.defaultMarginUsd;
    const prevDefLev = ui.data?.portfolio.defaultLeverage;
    ui.data = await fetchBackendState(refresh);

    // Sync /size or /lev changes made in Telegram
    if (ui.data.portfolio.defaultMarginUsd && ui.data.portfolio.defaultMarginUsd !== prevDefMargin) {
      ui.ticketMarginUsd = ui.data.portfolio.defaultMarginUsd;
      if (marginInput) marginInput.value = String(ui.ticketMarginUsd);
    }
    if (ui.data.portfolio.defaultLeverage && ui.data.portfolio.defaultLeverage !== prevDefLev) {
      ui.ticketLeverage = ui.data.portfolio.defaultLeverage;
      if (levInput) levInput.value = String(ui.ticketLeverage);
    }

    if (!ui.candles && ui.data.candles?.bars?.length >= 2) {
      ui.candles = ui.data.candles;
    }
    await ensureActiveCandles();
    await paint(false);
  } catch (err) {
    log(`Sync error: ${String((err as Error)?.message || err)}`);
    await paint(false);
  }
}

function nextMarginPreset(current: number): number {
  const idx = MARGIN_PRESETS.findIndex((v) => v > current);
  return idx >= 0 ? MARGIN_PRESETS[idx] : MARGIN_PRESETS[0];
}

function nextLevPreset(current: number): number {
  const idx = LEVERAGE_PRESETS.findIndex((v) => v > current);
  return idx >= 0 ? LEVERAGE_PRESETS[idx] : LEVERAGE_PRESETS[0];
}

async function executeAction(action: HudAction): Promise<void> {
  const pos = getActivePosition(ui);
  const alert = getActiveTriggeredAlert(ui);
  const msg = getActiveFeedMessage(ui);

  try {
    if (action.kind === 'MOVE_BE' && pos) {
      const res = await moveStopToBE(pos.id);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `BE @ ${formatPx(res.position.stopLoss)}`;
      log(`Stop moved to BE on ${pos.symbol}`);
      ui.view = 'GLANCE';
      await paint(true);
      return;
    }

    if (action.kind === 'TAKE_HALF' && pos) {
      const res = await takePartialProfit(pos.id, 0.5);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `50% (${res.partial.realizedPnlUsd >= 0 ? '+' : ''}$${res.partial.realizedPnlUsd.toFixed(1)})`;
      log(`Took 50% profit on ${pos.symbol}`);
      ui.view = 'GLANCE';
      await paint(true);
      return;
    }

    if (action.kind === 'CLOSE_POS' && pos) {
      const res = await closePaperPosition({ positionId: pos.id, notifyTelegram: true });
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `Closed (${res.closed.realizedPnlUsd >= 0 ? '+' : ''}$${res.closed.realizedPnlUsd.toFixed(1)})`;
      log(`Closed ${pos.symbol} @ ${formatPx(res.closed.exitPrice)}`);
      ui.view = 'GLANCE';
      await paint(true);
      return;
    }

    if (action.kind === 'START_SHORT' || action.kind === 'START_LONG' || action.kind === 'GO_TICKET') {
      if (action.kind === 'START_SHORT') ui.ticketSide = 'SHORT';
      if (action.kind === 'START_LONG') ui.ticketSide = 'LONG';
      await ensureActiveCandles();
      ui.view = 'TICKET_SIDE';
      await paint(true);
      return;
    }

    if (action.kind === 'DISMISS_ALERT' && alert) {
      const res = await dismissAlert(alert.id);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = 'Dismissed';
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

    if (action.kind === 'GO_MANAGE') {
      ui.actionIndex = 0;
      ui.view = 'MANAGE';
      await ensureActiveCandles();
      await paint(true);
      return;
    }

    if (action.kind === 'GO_REPLY') {
      ui.actionIndex = 0;
      ui.view = 'REPLY';
      await paint(true);
    }
  } catch (err) {
    ui.toast = String((err as Error)?.message || err).slice(0, 26);
    await paint(false);
  }
}

async function handleGesture(g: Gesture): Promise<void> {
  log(`Gesture: ${g} (${ui.view})`);
  ui.toast = '';

  if (ui.view === 'GLANCE') {
    const alert = getActiveTriggeredAlert(ui);
    const pos = getActivePosition(ui);
    const inPriorityPrompt = Boolean(alert) || Boolean(pos && pos.currentR >= 1.5 && !pos.isBreakEven);

    if (inPriorityPrompt) {
      const actions = alert ? getAlertActions() : getManageActions(ui).slice(0, 3);
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
      else ui.view = 'TICKET_SIDE';
      await ensureActiveCandles();
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      await host?.exitRoot();
    }
    return;
  }

  // STEP 1/4: Side & Margin Size ($35 etc.)
  if (ui.view === 'TICKET_SIDE') {
    if (g === 'SWIPE_UP') {
      ui.ticketSide = ui.ticketSide === 'SHORT' ? 'LONG' : 'SHORT';
      await paint(false);
    } else if (g === 'SWIPE_DOWN') {
      ui.ticketMarginUsd = nextMarginPreset(ui.ticketMarginUsd);
      if (marginInput) marginInput.value = String(ui.ticketMarginUsd);
      await paint(false);
    } else if (g === 'TAP') {
      ui.view = 'TICKET_SL';
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'GLANCE';
      await paint(true);
    }
    return;
  }

  // STEP 2/4: Interactive Stop Loss on Live Candlesticks (SWIPE UP moves SL higher on chart, DOWN moves lower)
  if (ui.view === 'TICKET_SL') {
    const step = 0.25; // 0.25% precision ticks across the candles
    if (g === 'SWIPE_UP') {
      // Moving SL UP on chart: for SHORT = wider SL (+step), for LONG = tighter SL (-step)
      ui.ticketSlPct =
        ui.ticketSide === 'SHORT'
          ? Math.min(12, Number((ui.ticketSlPct + step).toFixed(2)))
          : Math.max(0.25, Number((ui.ticketSlPct - step).toFixed(2)));
      await paint(false);
    } else if (g === 'SWIPE_DOWN') {
      ui.ticketSlPct =
        ui.ticketSide === 'SHORT'
          ? Math.max(0.25, Number((ui.ticketSlPct - step).toFixed(2)))
          : Math.min(12, Number((ui.ticketSlPct + step).toFixed(2)));
      await paint(false);
    } else if (g === 'TAP') {
      ui.view = 'TICKET_TP';
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'TICKET_SIDE';
      await paint(true);
    }
    return;
  }

  // STEP 3/4: Interactive Take Profit on Live Candlesticks (SWIPE UP moves TP higher on chart, DOWN moves lower)
  if (ui.view === 'TICKET_TP') {
    const step = 0.35;
    if (g === 'SWIPE_UP') {
      // Moving TP UP on chart: for SHORT = closer TP (-step), for LONG = farther TP (+step)
      ui.ticketTpPct =
        ui.ticketSide === 'SHORT'
          ? Math.max(0.35, Number((ui.ticketTpPct - step).toFixed(2)))
          : Math.min(25, Number((ui.ticketTpPct + step).toFixed(2)));
      await paint(false);
    } else if (g === 'SWIPE_DOWN') {
      ui.ticketTpPct =
        ui.ticketSide === 'SHORT'
          ? Math.min(25, Number((ui.ticketTpPct + step).toFixed(2)))
          : Math.max(0.35, Number((ui.ticketTpPct - step).toFixed(2)));
      await paint(false);
    } else if (g === 'TAP') {
      ui.view = 'TICKET_CONFIRM';
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'TICKET_SL';
      await paint(true);
    }
    return;
  }

  // STEP 4/4: Execute custom paper trade with exact SL & TP
  if (ui.view === 'TICKET_CONFIRM') {
    if (g === 'DOUBLE_TAP') {
      ui.view = 'TICKET_TP';
      await paint(true);
      return;
    }
    if (g === 'TAP') {
      const mkt = getActiveMarket(ui);
      const alert = getActiveTriggeredAlert(ui);
      if (!mkt) {
        ui.view = 'GLANCE';
        await paint(true);
        return;
      }
      const calc = computeTicketMath(ui, mkt.markPx);
      try {
        const res = await placePaperOrder({
          marketId: mkt.id,
          symbol: mkt.symbol,
          side: ui.ticketSide,
          marginUsd: ui.ticketMarginUsd,
          leverage: ui.ticketLeverage,
          price: mkt.markPx,
          stopLoss: calc.stopLoss,
          takeProfit: calc.takeProfit,
          notifyTelegram: true,
        });
        if (ui.data) ui.data.portfolio = res.portfolio;
        if (alert) await dismissAlert(alert.id);
        ui.toast = `${ui.ticketSide} ${mkt.symbol} $${ui.ticketMarginUsd}`;
        log(`Opened ${ui.ticketSide} ${mkt.symbol} $${ui.ticketMarginUsd}×${ui.ticketLeverage} | SL ${formatPx(calc.stopLoss)} | TP ${formatPx(calc.takeProfit)}`);
        ui.view = 'MANAGE';
        ui.actionIndex = 0;
        await paint(true);
      } catch (err) {
        ui.toast = String((err as Error)?.message || err).slice(0, 26);
        ui.view = 'GLANCE';
        await paint(true);
      }
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
    else if (id === 2) ui.view = 'TICKET_SIDE';
    else if (id === 3) ui.view = 'MANAGE';
    else if (id === 4) {
      ui.ticketLeverage = nextLevPreset(ui.ticketLeverage);
      if (levInput) levInput.value = String(ui.ticketLeverage);
      void savePrefs({ leverage: ui.ticketLeverage });
      log(`Leverage set to ${ui.ticketLeverage}x`);
    }
    void paint(true);
  });

  document.getElementById('btn-up')?.addEventListener('click', () => void handleGesture('SWIPE_UP'));
  document.getElementById('btn-tap')?.addEventListener('click', () => void handleGesture('TAP'));
  document.getElementById('btn-down')?.addEventListener('click', () => void handleGesture('SWIPE_DOWN'));
  document.getElementById('btn-dbl')?.addEventListener('click', () => void handleGesture('DOUBLE_TAP'));
  document.getElementById('btn-apply-prefs')?.addEventListener('click', async () => {
    const m = Number(marginInput?.value || ui.ticketMarginUsd);
    const l = Number(levInput?.value || ui.ticketLeverage);
    if (Number.isFinite(m) && m >= 1) ui.ticketMarginUsd = m;
    if (Number.isFinite(l) && l >= 1) ui.ticketLeverage = Math.round(l);
    try {
      const res = await savePrefs({ marginUsd: ui.ticketMarginUsd, leverage: ui.ticketLeverage });
      if (ui.data) ui.data.portfolio = res.portfolio;
      log(`Custom size saved: $${ui.ticketMarginUsd} × ${ui.ticketLeverage}x`);
      await paint(false);
    } catch (err) {
      log(`Pref error: ${String((err as Error)?.message || err)}`);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (document.activeElement?.tagName === 'INPUT') return;
    if (e.key === 'ArrowUp') void handleGesture('SWIPE_UP');
    if (e.key === 'ArrowDown') void handleGesture('SWIPE_DOWN');
    if (e.key === 'Enter') void handleGesture('TAP');
    if (e.key === 'Escape') void handleGesture('DOUBLE_TAP');
  });

  await syncState(true);
  setInterval(() => void syncState(false), 8000);
}

void boot();
