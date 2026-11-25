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
  RISK_NUMPAD,
  TIMEFRAMES,
  computeRiskTicket,
  createInitialUIState,
  evaluateRiskGuard,
  formatPx,
  getActiveFeedMessage,
  getActiveMarket,
  getActivePosition,
  getActiveTimeframe,
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

interface QueuedAction {
  idempotencyKey: string;
  label: string;
  run: () => Promise<void>;
}
const pendingQueue: QueuedAction[] = [];
let flushingQueue = false;

function makeActionKey(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function isNetworkError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err);
  return err instanceof TypeError || /Failed to fetch|NetworkError|ECONN|Load failed|timeout/i.test(msg);
}

async function flushPendingQueue(): Promise<void> {
  if (flushingQueue || pendingQueue.length === 0) return;
  flushingQueue = true;
  try {
    while (pendingQueue.length > 0) {
      const next = pendingQueue[0];
      try {
        await next.run();
        pendingQueue.shift();
        ui.offline = false;
        ui.pendingSync = pendingQueue.length > 0 ? pendingQueue[0].label : '';
        log(`Synced queued action: ${next.label}`);
        await paint(false);
      } catch (err) {
        if (isNetworkError(err)) {
          ui.offline = true;
          ui.pendingSync = next.label;
          break;
        }
        // Server rejected with definitive business error -> drop from queue
        pendingQueue.shift();
        ui.pendingSync = pendingQueue.length > 0 ? pendingQueue[0].label : '';
        ui.toast = String((err as Error)?.message || err).slice(0, 26);
        await paint(false);
      }
    }
  } finally {
    flushingQueue = false;
  }
}

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
  const tf = getActiveTimeframe(ui);
  statusEl.innerHTML =
    `<strong>Telegram:</strong> @${tg.botUsername || 'telegram_bot'} ` +
    `(${tg.activeChatId ? tg.activeChatTitle || tg.activeChatId : 'waiting'}) · ` +
    `<strong>Hyperliquid:</strong> ${ui.data.markets.length} perps (${tf.label}) · ` +
    `<strong>Paper:</strong> $${port.cashUsd.toFixed(0)} (${port.totalPnlUsd >= 0 ? '+' : ''}$${port.totalPnlUsd.toFixed(2)}) · ` +
    `<strong>Open:</strong> ${openSyms || 'none'} · ` +
    `<strong>Risk:</strong> $${ui.riskUsd}`;
}

async function ensureActiveCandles(force = false): Promise<void> {
  const mkt = getActiveMarket(ui);
  if (!mkt) return;
  const tf = getActiveTimeframe(ui);
  if (!force && ui.candles && ui.candles.symbol === mkt.symbol && ui.candles.interval === tf.id && ui.candles.bars.length >= 2) {
    return;
  }
  try {
    ui.candles = await fetchCandles(mkt.symbol, tf.id);
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
    const tf = getActiveTimeframe(ui);
    ui.data = await fetchBackendState(refresh, tf.id);
    ui.offline = false;

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
    if (pendingQueue.length > 0) void flushPendingQueue();
    await paint(false);
  } catch (err) {
    ui.offline = true;
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
      const key = makeActionKey('be');
      const runBE = async () => {
        const res = await moveStopToBE(targetPos.id, key);
        if (ui.data) ui.data.portfolio = res.portfolio;
        ui.toast = `${targetPos.symbol} BE @ ${formatPx(res.position.stopLoss)}`;
        log(`Moved ${targetPos.symbol} stop to BE`);
      };
      try {
        await runBE();
      } catch (err) {
        if (isNetworkError(err)) {
          ui.offline = true;
          ui.pendingSync = `retrying ${targetPos.symbol} BE`;
          pendingQueue.push({ idempotencyKey: key, label: ui.pendingSync, run: runBE });
          log(`Connection dropped while moving ${targetPos.symbol} SL to BE — queued idempotent retry`);
        } else {
          throw err;
        }
      }
      ui.view = 'GLANCE';
      ui.lockedSymbol = null;
      await paint(true);
      return;
    }

    if (action.kind === 'TAKE_HALF' && targetPos) {
      const key = makeActionKey('half');
      const runHalf = async () => {
        const res = await takePartialProfit(targetPos.id, 0.5, key);
        if (ui.data) ui.data.portfolio = res.portfolio;
        ui.toast = `50% ${targetPos.symbol} (${res.partial.realizedPnlUsd >= 0 ? '+' : ''}$${res.partial.realizedPnlUsd.toFixed(1)})`;
        log(`Closed 50% of ${targetPos.symbol}`);
      };
      try {
        await runHalf();
      } catch (err) {
        if (isNetworkError(err)) {
          ui.offline = true;
          ui.pendingSync = `retrying 50% ${targetPos.symbol}`;
          pendingQueue.push({ idempotencyKey: key, label: ui.pendingSync, run: runHalf });
          log(`Connection dropped during 50% close — queued idempotent retry`);
        } else {
          throw err;
        }
      }
      ui.view = 'GLANCE';
      ui.lockedSymbol = null;
      await paint(true);
      return;
    }

    if (action.kind === 'CLOSE_POS' && targetPos) {
      const key = makeActionKey('close');
      const runClose = async () => {
        const res = await closePaperPosition({ positionId: targetPos.id, idempotencyKey: key, notifyTelegram: true });
        if (ui.data) ui.data.portfolio = res.portfolio;
        ui.toast = `Closed ${targetPos.symbol} (${res.closed.realizedPnlUsd >= 0 ? '+' : ''}$${res.closed.realizedPnlUsd.toFixed(1)})`;
        log(`Closed 100% of ${targetPos.symbol} @ ${formatPx(res.closed.exitPrice)}`);
      };
      try {
        await runClose();
      } catch (err) {
        if (isNetworkError(err)) {
          ui.offline = true;
          ui.pendingSync = `retrying close ${targetPos.symbol}`;
          pendingQueue.push({ idempotencyKey: key, label: ui.pendingSync, run: runClose });
          log(`Connection dropped during close — queued idempotent retry`);
        } else {
          throw err;
        }
      }
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

    if (action.kind === 'GO_TIMEFRAME') {
      ui.lockedSymbol = action.payload || getActiveMarket(ui)?.symbol || ui.lockedSymbol || 'ETH';
      ui.returnAfterTf = ui.view;
      ui.view = 'TIMEFRAME';
      await ensureActiveCandles();
      await paint(true);
      return;
    }

    if (action.kind === 'START_SHORT' || action.kind === 'START_LONG') {
      const tf = getActiveTimeframe(ui);
      ui.ticketSide = action.kind === 'START_SHORT' ? 'SHORT' : 'LONG';
      ui.lockedSymbol = action.payload || getActiveMarket(ui)?.symbol || ui.lockedSymbol || 'ETH';
      ui.ticketSlPct = tf.defaultSlPct;
      ui.ticketTpPct = tf.defaultTpPct;
      ui.confirmArmed = false;
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

  // INLINE CHART TIMEFRAME PICKER (1m · 3m · 5m · 15m · 1h · 2h · 4h · 1D)
  if (ui.view === 'TIMEFRAME') {
    if (g === 'SWIPE_DOWN' || g === 'SWIPE_UP') {
      const dir = g === 'SWIPE_DOWN' ? 1 : -1;
      ui.timeframeIndex = (ui.timeframeIndex + dir + TIMEFRAMES.length) % TIMEFRAMES.length;
      const tf = getActiveTimeframe(ui);
      ui.ticketSlPct = tf.defaultSlPct;
      ui.ticketTpPct = tf.defaultTpPct;
      log(`Chart timeframe -> ${tf.label} (SL step ±${tf.slStepPct}%, TP step ±${tf.tpStepPct}%)`);
      await paint(false); // Instant text highlight before candle fetch lands
      await ensureActiveCandles(true);
      await paint(false);
      return;
    }
    if (g === 'TAP' || g === 'DOUBLE_TAP') {
      const tf = getActiveTimeframe(ui);
      ui.toast = `TF ${tf.label}`;
      ui.view = ui.returnAfterTf || 'REPLY';
      if (ui.view === 'GLANCE') ui.lockedSymbol = null;
      await paint(true);
      return;
    }
    return;
  }

  // STEP 1/3: Slide Stop Loss directly on live candlesticks (Timeframe-Adaptive Sensitivity!)
  if (ui.view === 'TICKET_SL') {
    const tf = getActiveTimeframe(ui);
    const step = tf.slStepPct;
    if (g === 'SWIPE_UP') {
      ui.ticketSlPct =
        ui.ticketSide === 'SHORT'
          ? Math.min(tf.maxSlPct, Number((ui.ticketSlPct + step).toFixed(2)))
          : Math.max(tf.minSlPct, Number((ui.ticketSlPct - step).toFixed(2)));
      await paint(false);
    } else if (g === 'SWIPE_DOWN') {
      ui.ticketSlPct =
        ui.ticketSide === 'SHORT'
          ? Math.max(tf.minSlPct, Number((ui.ticketSlPct - step).toFixed(2)))
          : Math.min(tf.maxSlPct, Number((ui.ticketSlPct + step).toFixed(2)));
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

  // STEP 2/3: Slide Take Profit directly on live candlesticks (Timeframe-Adaptive Sensitivity!)
  if (ui.view === 'TICKET_TP') {
    const tf = getActiveTimeframe(ui);
    const step = tf.tpStepPct;
    if (g === 'SWIPE_UP') {
      ui.ticketTpPct =
        ui.ticketSide === 'SHORT'
          ? Math.max(tf.minTpPct, Number((ui.ticketTpPct - step).toFixed(2)))
          : Math.min(tf.maxTpPct, Number((ui.ticketTpPct + step).toFixed(2)));
      await paint(false);
    } else if (g === 'SWIPE_DOWN') {
      ui.ticketTpPct =
        ui.ticketSide === 'SHORT'
          ? Math.min(tf.maxTpPct, Number((ui.ticketTpPct + step).toFixed(2)))
          : Math.max(tf.minTpPct, Number((ui.ticketTpPct - step).toFixed(2)));
      await paint(false);
    } else if (g === 'TAP') {
      ui.riskDraft = '';
      ui.padRow = 0;
      ui.padCol = 0;
      ui.view = 'TICKET_RISK';
      await paint(true);
    } else if (g === 'DOUBLE_TAP') {
      ui.view = 'TICKET_SL';
      await paint(true);
    }
    return;
  }

  // STEP 3/3: 2D Looping Numpad for unrestricted exact $ Risk
  // SWIPE_DOWN = move down (wraps), SWIPE_UP = move right (wraps), TAP = pick key, DOUBLE_TAP = confirm & review
  if (ui.view === 'TICKET_RISK') {
    const confirmNumpad = async () => {
      const parsed = Number(ui.riskDraft);
      if (ui.riskDraft.length > 0 && Number.isFinite(parsed) && parsed >= 1) {
        ui.riskUsd = parsed;
        if (riskInput) riskInput.value = String(ui.riskUsd);
      }
      ui.confirmArmed = false;
      ui.view = 'TICKET_CONFIRM';
      await paint(true);
    };

    if (g === 'SWIPE_DOWN') {
      ui.padRow = (ui.padRow + 1) % RISK_NUMPAD.length;
      await paint(false);
      return;
    }
    if (g === 'SWIPE_UP') {
      ui.padCol = (ui.padCol + 1) % RISK_NUMPAD[0].length;
      await paint(false);
      return;
    }
    if (g === 'DOUBLE_TAP') {
      await confirmNumpad();
      return;
    }
    if (g === 'TAP') {
      const key = RISK_NUMPAD[ui.padRow][ui.padCol];
      if (key === '<') {
        ui.riskDraft = ui.riskDraft.slice(0, -1);
        const parsed = Number(ui.riskDraft);
        if (ui.riskDraft.length > 0 && Number.isFinite(parsed) && parsed >= 1) {
          ui.riskUsd = parsed;
          if (riskInput) riskInput.value = ui.riskDraft;
        }
        await paint(false);
        return;
      }
      if (key === 'OK') {
        await confirmNumpad();
        return;
      }
      // Digit '0'..'9' (unrestricted length up to 7 digits, ignore leading zero)
      if (ui.riskDraft === '' && key === '0') {
        await paint(false);
        return;
      }
      if (ui.riskDraft.length < 7) {
        ui.riskDraft += key;
        ui.riskUsd = Number(ui.riskDraft);
        if (riskInput) riskInput.value = ui.riskDraft;
      }
      await paint(false);
      return;
    }
    return;
  }

  // REVIEW & EXECUTE SCREEN (FAT-FINGER GUARDRAIL + "ARE YOU SURE?" HIGH-RISK GATE)
  if (ui.view === 'TICKET_CONFIRM') {
    if (g === 'DOUBLE_TAP') {
      ui.confirmArmed = false;
      ui.riskDraft = String(Math.round(ui.riskUsd));
      ui.padRow = 0;
      ui.padCol = 0;
      ui.view = 'TICKET_RISK';
      await paint(true);
      return;
    }
    if (g === 'SWIPE_UP' || g === 'SWIPE_DOWN') {
      ui.confirmArmed = false;
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
      const guard = evaluateRiskGuard(calc, ui.data?.portfolio);

      // Tier 1: Hard-block impossible/fat-finger risk (e.g. $12,500 on $10,000 account)
      if (guard.level === 'BLOCKED') {
        log(`Fat-finger guard blocked $${calc.riskUsd} (${guard.reason})`);
        await paint(false);
        return;
      }

      // Tier 2: Mandatory "Are you sure?" gate on EVERY trade showing exact % of balance risked
      if (!ui.confirmArmed) {
        ui.confirmArmed = true;
        log(`Are you sure? Risking $${calc.riskUsd} (${guard.riskPct}% of balance) — tap again to confirm`);
        await paint(false);
        return;
      }

      ui.confirmArmed = false;
      try {
        const res = await placePaperOrder({
          marketId: mkt.id,
          symbol: mkt.symbol,
          side: ui.ticketSide,
          riskUsd: calc.riskUsd,
          price: mkt.markPx,
          stopLoss: calc.stopLoss,
          takeProfit: calc.takeProfit,
          idempotencyKey: makeActionKey('ord'),
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
        // Asymmetric offline policy: protective stop/close moves retry, NEW entries fail fast (never stale-fill!)
        if (isNetworkError(err)) {
          ui.offline = true;
          ui.toast = 'OFFLINE · order NOT sent';
          log(`Connection dropped during new order — failed fast so no stale entry fills later`);
        } else {
          ui.toast = String((err as Error)?.message || err).slice(0, 26);
        }
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
      ui.lockedSymbol = getActiveMarket(ui)?.symbol || ui.lockedSymbol || 'ETH';
      ui.returnAfterTf = ui.view === 'TIMEFRAME' ? 'GLANCE' : ui.view;
      ui.view = 'TIMEFRAME';
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
      if (ui.view === 'TICKET_RISK') ui.riskDraft = String(Math.round(ui.riskUsd));
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
  setInterval(() => void flushPendingQueue(), 3000);
}

void boot();
