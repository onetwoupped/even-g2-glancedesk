import {
  closePaperPosition,
  dismissAlert,
  fetchBackendState,
  fetchCandles,
  moveStopToBE,
  placePaperOrder,
  saveRiskBudget,
  sendTelegramReply,
  takePartialProfit,
} from './api';
import { connectEvenBridge, type GlassesHost } from './bridge';
import { drawG2Preview } from './preview';
import {
  adjustRiskUsd,
  computeRiskTicket,
  createInitialUIState,
  formatPx,
  getActiveFeedMessage,
  getActiveMarket,
  getActivePosition,
  getActiveTriggeredAlert,
  getAlertActions,
  getManageActions,
  getReplyActions,
  getUrgentBreakEvenPosition,
  renderPage,
  type Gesture,
  type HudAction,
} from './state';

const canvas = document.getElementById('g2-canvas') as HTMLCanvasElement;
const badgeEl = document.getElementById('runtime-badge') as HTMLElement;
const viewEl = document.getElementById('view-indicator') as HTMLElement;
const statusEl = document.getElementById('status-panel') as HTMLElement;
const logEl = document.getElementById('event-log') as HTMLElement;
const riskInput = document.getElementById('inp-risk') as HTMLInputElement | null;

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
  const openSyms = port.positions.map((p) => p.symbol).join(', ');
  statusEl.innerHTML =
    `<strong>Telegram:</strong> @${tg.botUsername || 'sezirneonbot'} ` +
    `(${tg.activeChatId ? tg.activeChatTitle || tg.activeChatId : 'waiting'}) · ` +
    `<strong>Hyperliquid:</strong> ${ui.data.markets.length} perps · ` +
    `<strong>Paper:</strong> $${port.cashUsd.toFixed(0)} (${port.totalPnlUsd >= 0 ? '+' : ''}$${port.totalPnlUsd.toFixed(2)}) · ` +
    `<strong>Open:</strong> ${openSyms || 'none'} · ` +
    `<strong>Risk:</strong> $${ui.riskUsd}`;
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
    const prevDefaultRisk = ui.data?.portfolio.defaultRiskUsd;
    ui.data = await fetchBackendState(refresh);

    // Sync /risk <amount> changes made in Telegram live into active ticket
    if (ui.data.portfolio.defaultRiskUsd && ui.data.portfolio.defaultRiskUsd !== prevDefaultRisk) {
      ui.riskUsd = ui.data.portfolio.defaultRiskUsd;
      if (riskInput && document.activeElement !== riskInput) {
        riskInput.value = String(ui.riskUsd);
      }
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

async function executeAction(action: HudAction): Promise<void> {
  const alert = getActiveTriggeredAlert(ui);
  const msg = getActiveFeedMessage(ui);
  const allPositions = ui.data?.portfolio.positions || [];
  const targetPos =
    (action.payload ? allPositions.find((p) => p.id === action.payload) : null) || getActivePosition(ui);

  try {
    if (action.kind === 'MOVE_BE' && targetPos) {
      const res = await moveStopToBE(targetPos.id);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `${targetPos.symbol} BE @ ${formatPx(res.position.stopLoss)}`;
      log(`Moved ${targetPos.symbol} stop to BE`);
      ui.view = 'GLANCE';
      ui.lockedSymbol = null;
      await paint(true);
      return;
    }

    if (action.kind === 'TAKE_HALF' && targetPos) {
      const res = await takePartialProfit(targetPos.id, 0.5);
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `50% ${targetPos.symbol} (${res.partial.realizedPnlUsd >= 0 ? '+' : ''}$${res.partial.realizedPnlUsd.toFixed(1)})`;
      log(`Closed 50% of ${targetPos.symbol}`);
      ui.view = 'GLANCE';
      ui.lockedSymbol = null;
      await paint(true);
      return;
    }

    if (action.kind === 'CLOSE_POS' && targetPos) {
      const res = await closePaperPosition({ positionId: targetPos.id, notifyTelegram: true });
      if (ui.data) ui.data.portfolio = res.portfolio;
      ui.toast = `Closed ${targetPos.symbol} (${res.closed.realizedPnlUsd >= 0 ? '+' : ''}$${res.closed.realizedPnlUsd.toFixed(1)})`;
      log(`Closed 100% of ${targetPos.symbol} @ ${formatPx(res.closed.exitPrice)}`);
      ui.view = 'GLANCE';
      ui.lockedSymbol = null;
      await paint(true);
      return;
    }

    if (action.kind === 'NEXT_POS' && allPositions.length > 1) {
      ui.posIndex = (ui.posIndex + 1) % allPositions.length;
      ui.actionIndex = 0;
      await ensureActiveCandles();
      await paint(true);
      return;
    }

    if (action.kind === 'START_SHORT' || action.kind === 'START_LONG') {
      ui.ticketSide = action.kind === 'START_SHORT' ? 'SHORT' : 'LONG';
      ui.lockedSymbol = action.payload || getActiveMarket(ui)?.symbol || ui.lockedSymbol || 'ETH';
      ui.view = 'TICKET_SL';
      await ensureActiveCandles();
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
      ui.lockedSymbol = null;
      await syncState(false);
      await paint(true);
      return;
    }

    if (action.kind === 'GO_MANAGE_SYMBOL' && action.payload) {
      const idx = allPositions.findIndex((p) => p.symbol.toUpperCase() === action.payload!.toUpperCase());
      if (idx >= 0) ui.posIndex = idx;
      ui.actionIndex = 0;
      ui.view = 'MANAGE';
      await ensureActiveCandles();
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
      ui.lockedSymbol = getActiveMarket(ui)?.symbol || null;
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
    const urgentPos = getUrgentBreakEvenPosition(ui);
    const inPriorityPrompt = Boolean(alert) || Boolean(urgentPos);

    if (inPriorityPrompt) {
      const mkt = getActiveMarket(ui);
      const actions = alert ? getAlertActions(mkt?.symbol || alert.symbol) : getManageActions(ui, urgentPos);
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
      // Lock onto the exact coin currently on screen (e.g. BTC message stays BTC!)
      const activeMkt = getActiveMarket(ui);
      ui.lockedSymbol = activeMkt?.symbol || null;
      ui.actionIndex = 0;
      ui.view = 'REPLY';
      await ensureActiveCandles();
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      await host?.exitRoot();
    }
    return;
  }

  // STEP 1/3: Slide Stop Loss directly on 15m candlesticks (Structure First!)
  if (ui.view === 'TICKET_SL') {
    const step = 0.25;
    if (g === 'SWIPE_UP') {
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
      ui.view = 'REPLY';
      ui.actionIndex = 0;
      await paint(true);
    }
    return;
  }

  // STEP 2/3: Slide Take Profit directly on 15m candlesticks (Locks Setup R:R!)
  if (ui.view === 'TICKET_TP') {
    const step = 0.35;
    if (g === 'SWIPE_UP') {
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
      ui.view = 'TICKET_RISK';
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'TICKET_SL';
      await paint(true);
    }
    return;
  }

  // STEP 3/3: Set exact $ Risk for THIS setup & execute (Swipe smoothly or type exact $ live!)
  if (ui.view === 'TICKET_RISK') {
    if (g === 'SWIPE_UP') {
      ui.riskUsd = adjustRiskUsd(ui.riskUsd, 1);
      if (riskInput) riskInput.value = String(ui.riskUsd);
      await paint(false);
      return;
    }
    if (g === 'SWIPE_DOWN') {
      ui.riskUsd = adjustRiskUsd(ui.riskUsd, -1);
      if (riskInput) riskInput.value = String(ui.riskUsd);
      await paint(false);
      return;
    }
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
        ui.lockedSymbol = null;
        await paint(true);
        return;
      }
      const calc = computeRiskTicket(ui, mkt.markPx);
      try {
        const res = await placePaperOrder({
          marketId: mkt.id,
          symbol: mkt.symbol,
          side: ui.ticketSide,
          riskUsd: calc.riskUsd,
          price: mkt.markPx,
          stopLoss: calc.stopLoss,
          takeProfit: calc.takeProfit,
          notifyTelegram: true,
        });
        if (ui.data) ui.data.portfolio = res.portfolio;
        if (alert && alert.symbol.toUpperCase() === mkt.symbol.toUpperCase()) {
          await dismissAlert(alert.id);
        }
        // Focus the newly opened position in MANAGE
        ui.posIndex = 0;
        ui.actionIndex = 0;
        ui.lockedSymbol = null;
        ui.toast = `${ui.ticketSide} ${mkt.symbol} (-$${calc.riskUsd})`;
        log(`Opened ${ui.ticketSide} ${mkt.symbol} | Risk -$${calc.riskUsd} | Qty ${calc.qty} | SL ${formatPx(calc.stopLoss)} | TP ${formatPx(calc.takeProfit)}`);
        ui.view = 'MANAGE';
        await ensureActiveCandles();
        await paint(true);
      } catch (err) {
        ui.toast = String((err as Error)?.message || err).slice(0, 26);
        ui.view = 'GLANCE';
        ui.lockedSymbol = null;
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
      ui.lockedSymbol = null;
      await ensureActiveCandles();
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
      ui.lockedSymbol = null;
      await ensureActiveCandles();
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
    if (id === 1) {
      ui.view = 'GLANCE';
      ui.lockedSymbol = null;
    } else if (id === 2) {
      ui.lockedSymbol = getActiveMarket(ui)?.symbol || 'ETH';
      ui.view = 'TICKET_SL';
    } else if (id === 3) {
      ui.view = 'MANAGE';
    } else if (id === 4) {
      ui.ticketSide = ui.ticketSide === 'SHORT' ? 'LONG' : 'SHORT';
      log(`Flipped direction -> ${ui.ticketSide}`);
    }
    void ensureActiveCandles().then(() => paint(true));
  });

  document.getElementById('btn-up')?.addEventListener('click', () => void handleGesture('SWIPE_UP'));
  document.getElementById('btn-tap')?.addEventListener('click', () => void handleGesture('TAP'));
  document.getElementById('btn-down')?.addEventListener('click', () => void handleGesture('SWIPE_DOWN'));
  document.getElementById('btn-dbl')?.addEventListener('click', () => void handleGesture('DOUBLE_TAP'));

  // Live typing sync: typing 242 or 850 updates active G2 HUD immediately on every keystroke!
  riskInput?.addEventListener('input', () => {
    const r = Number(riskInput.value);
    if (Number.isFinite(r) && r >= 1 && r <= 50000) {
      ui.riskUsd = Number(r.toFixed(2));
      void paint(false);
    }
  });

  const saveDefaultRisk = async () => {
    const r = Number(riskInput?.value || ui.riskUsd);
    if (!Number.isFinite(r) || r < 1 || r > 50000) return;
    ui.riskUsd = Number(r.toFixed(2));
    try {
      const res = await saveRiskBudget(ui.riskUsd);
      if (ui.data) ui.data.portfolio = res.portfolio;
      log(`Default risk saved: $${ui.riskUsd}`);
      await paint(false);
    } catch (err) {
      log(`Risk error: ${String((err as Error)?.message || err)}`);
    }
  };

  document.getElementById('btn-apply-risk')?.addEventListener('click', () => void saveDefaultRisk());
  riskInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void saveDefaultRisk();
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
