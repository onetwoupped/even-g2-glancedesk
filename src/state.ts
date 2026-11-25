import type { BackendState, CandleSeries, FeedMessage, MarketItem, PaperPosition, PriceAlert } from './api';
import { buildMinimalHudPage, truncate, type G2CandleChartSpec, type G2ChartLevel, type G2PageSpec } from './layout';

export type ViewName = 'GLANCE' | 'MANAGE' | 'TIMEFRAME' | 'TICKET_SL' | 'TICKET_TP' | 'TICKET_RISK' | 'TICKET_CONFIRM' | 'REPLY';
export type Gesture = 'TAP' | 'DOUBLE_TAP' | 'SWIPE_UP' | 'SWIPE_DOWN';

export interface TimeframeSpec {
  id: '1m' | '3m' | '5m' | '15m' | '1h' | '2h' | '4h' | '1d';
  label: string;
  slStepPct: number;
  tpStepPct: number;
  defaultSlPct: number;
  defaultTpPct: number;
  minSlPct: number;
  maxSlPct: number;
  minTpPct: number;
  maxTpPct: number;
}

export const TIMEFRAMES: readonly TimeframeSpec[] = [
  { id: '1m', label: '1m', slStepPct: 0.05, tpStepPct: 0.08, defaultSlPct: 0.15, defaultTpPct: 0.4, minSlPct: 0.05, maxSlPct: 2.0, minTpPct: 0.08, maxTpPct: 5.0 },
  { id: '3m', label: '3m', slStepPct: 0.08, tpStepPct: 0.12, defaultSlPct: 0.25, defaultTpPct: 0.65, minSlPct: 0.08, maxSlPct: 3.0, minTpPct: 0.12, maxTpPct: 8.0 },
  { id: '5m', label: '5m', slStepPct: 0.1, tpStepPct: 0.18, defaultSlPct: 0.4, defaultTpPct: 1.0, minSlPct: 0.1, maxSlPct: 5.0, minTpPct: 0.18, maxTpPct: 12.0 },
  { id: '15m', label: '15m', slStepPct: 0.2, tpStepPct: 0.35, defaultSlPct: 0.75, defaultTpPct: 2.0, minSlPct: 0.15, maxSlPct: 10.0, minTpPct: 0.35, maxTpPct: 25.0 },
  { id: '1h', label: '1h', slStepPct: 0.4, tpStepPct: 0.75, defaultSlPct: 1.5, defaultTpPct: 4.0, minSlPct: 0.25, maxSlPct: 18.0, minTpPct: 0.5, maxTpPct: 40.0 },
  { id: '2h', label: '2h', slStepPct: 0.5, tpStepPct: 1.0, defaultSlPct: 2.0, defaultTpPct: 5.5, minSlPct: 0.4, maxSlPct: 22.0, minTpPct: 0.75, maxTpPct: 50.0 },
  { id: '4h', label: '4h', slStepPct: 0.75, tpStepPct: 1.5, defaultSlPct: 3.0, defaultTpPct: 8.0, minSlPct: 0.5, maxSlPct: 30.0, minTpPct: 1.0, maxTpPct: 60.0 },
  { id: '1d', label: '1D', slStepPct: 1.25, tpStepPct: 2.5, defaultSlPct: 5.0, defaultTpPct: 14.0, minSlPct: 1.0, maxSlPct: 45.0, minTpPct: 1.5, maxTpPct: 100.0 },
];

export const RISK_NUMPAD: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['<', '0', 'OK'],
];

export interface AppUIState {
  view: ViewName;
  returnAfterTf: ViewName;
  feedIndex: number;
  marketIndex: number;
  posIndex: number;
  actionIndex: number;
  timeframeIndex: number; // 0..7 => 1m..1D (default 3 => 15m)
  // Coin lock prevents background feed updates or unrelated open positions from hijacking active setup
  lockedSymbol: string | null;
  // Structure-first ticket: 1) SL -> 2) TP -> 3) 2D Looping Numpad (any $ length) -> Review -> Are You Sure?
  ticketSide: 'SHORT' | 'LONG';
  ticketSlPct: number;
  ticketTpPct: number;
  riskUsd: number;
  riskDraft: string; // Unrestricted digit string typed via 2D numpad (e.g. "35", "253", "12500")
  padRow: number; // 0..3 (SWIPE_DOWN moves down & wraps)
  padCol: number; // 0..2 (SWIPE_UP moves right & wraps)
  confirmArmed: boolean; // Mandatory second-tap "Are you sure?" gate on EVERY trade
  offline: boolean; // True when backend/network is unreachable
  pendingSync: string; // Non-empty while a stop-move/close is queued for idempotent retry
  toast: string;
  data: BackendState | null;
  candles: CandleSeries | null;
}

export function getActiveTimeframe(st: AppUIState): TimeframeSpec {
  const idx = ((st.timeframeIndex % TIMEFRAMES.length) + TIMEFRAMES.length) % TIMEFRAMES.length;
  return TIMEFRAMES[idx];
}

export function formatPx(px: number): string {
  if (px >= 1000) return `$${px.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (px >= 1) return `$${px.toFixed(2)}`;
  return `$${px.toFixed(4)}`;
}

export function formatNotional(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  return `$${usd.toFixed(0)}`;
}

export function formatQty(qty: number): string {
  if (qty >= 100) return qty.toFixed(1);
  if (qty >= 1) return qty.toFixed(2);
  return qty.toFixed(4);
}

export function formatNumpadRows(padRow: number, padCol: number): string[] {
  return RISK_NUMPAD.map((row, r) =>
    row
      .map((key, c) => {
        const active = r === padRow && c === padCol;
        if (key === 'OK') return active ? '[OK]' : ' OK ';
        return active ? `[${key}]` : ` ${key} `;
      })
      .join('  ')
  );
}

export function createInitialUIState(): AppUIState {
  return {
    view: 'GLANCE',
    returnAfterTf: 'REPLY',
    feedIndex: 0,
    marketIndex: 0,
    posIndex: 0,
    actionIndex: 0,
    timeframeIndex: 3, // 15m default
    lockedSymbol: null,
    ticketSide: 'LONG',
    ticketSlPct: TIMEFRAMES[3].defaultSlPct,
    ticketTpPct: TIMEFRAMES[3].defaultTpPct,
    riskUsd: 100,
    riskDraft: '',
    padRow: 0,
    padCol: 0,
    confirmArmed: false,
    offline: false,
    pendingSync: '',
    toast: '',
    data: null,
    candles: null,
  };
}

export interface RiskGuardResult {
  level: 'OK' | 'WARN' | 'BLOCKED';
  riskPct: number;
  marginUsd: number;
  reason: string;
}

/**
 * Fat-finger & Account-Size Risk Guardrail:
 * - Catches numpad slips like $12,500 instead of $125 OR oversized risks above maxRiskPct (default 10%).
 * - BLOCKED: risk exceeds balance, margin exceeds cash, OR risk % exceeds account maxRiskPct cap.
 * - WARN: risk > 5% of balance (still allowed up to maxRiskPct, highlighted with ! HIGH RISK).
 * - OK: <= 5% balance (still requires mandatory "Are you sure? Risking X% of balance" second tap).
 */
export function evaluateRiskGuard(
  calc: { riskUsd: number; notionalUsd: number },
  portfolio: { cashUsd: number; equityUsd: number; maxRiskPct?: number } | null | undefined
): RiskGuardResult {
  const cash = portfolio?.cashUsd ?? 10000;
  const equity = Math.max(1, portfolio?.equityUsd ?? cash);
  const maxRiskPct = portfolio?.maxRiskPct ?? 10;
  const riskPct = Number(((calc.riskUsd / equity) * 100).toFixed(1));
  const marginUsd = Number(Math.max(calc.riskUsd, calc.notionalUsd / 50).toFixed(2));

  if (calc.riskUsd > cash) {
    return {
      level: 'BLOCKED',
      riskPct,
      marginUsd,
      reason: `Exceeds cash ($${cash.toFixed(0)})`,
    };
  }
  if (riskPct > maxRiskPct) {
    const capUsd = ((equity * maxRiskPct) / 100).toFixed(0);
    return {
      level: 'BLOCKED',
      riskPct,
      marginUsd,
      reason: `Over ${maxRiskPct}% cap (max $${capUsd})`,
    };
  }
  if (marginUsd > cash) {
    return {
      level: 'BLOCKED',
      riskPct,
      marginUsd,
      reason: `Needs $${marginUsd.toFixed(0)} margin`,
    };
  }
  if (riskPct > 5) {
    return {
      level: 'WARN',
      riskPct,
      marginUsd,
      reason: `${riskPct}% of balance`,
    };
  }
  return { level: 'OK', riskPct, marginUsd, reason: '' };
}

/**
 * Risk-Based Position Sizing:
 * - Structure (SL & TP) is placed first on live OHLC candles.
 * - Risk ($ loss if SL hits) determines exact coin quantity: qty = riskUsd / |entry - SL|.
 * - Hitting SL ALWAYS loses exactly `riskUsd`.
 */
export function computeRiskTicket(st: AppUIState, entryPx: number) {
  const riskUsd = Math.max(1, Number(Number(st.riskUsd || 100).toFixed(2)));
  const slFrac = st.ticketSlPct / 100;
  const tpFrac = st.ticketTpPct / 100;

  const stopLoss = st.ticketSide === 'SHORT' ? entryPx * (1 + slFrac) : entryPx * (1 - slFrac);
  const takeProfit = st.ticketSide === 'SHORT' ? entryPx * (1 - tpFrac) : entryPx * (1 + tpFrac);

  const slDist = Math.abs(entryPx - stopLoss);
  const tpDist = Math.abs(takeProfit - entryPx);
  const qty = slDist > 0 ? riskUsd / slDist : 0;
  const notionalUsd = qty * entryPx;
  const profitUsd = tpDist * qty;
  const rr = slDist > 0 ? tpDist / slDist : 0;

  return {
    entryPx,
    riskUsd,
    qty: Number(qty.toFixed(4)),
    notionalUsd: Number(notionalUsd.toFixed(2)),
    stopLoss,
    takeProfit,
    profitUsd: Number(profitUsd.toFixed(2)),
    rr: Number(rr.toFixed(2)),
  };
}

export function getActiveTriggeredAlert(st: AppUIState): PriceAlert | null {
  return st.data?.portfolio.activeTriggeredAlerts?.[0] || null;
}

export function getUrgentBreakEvenPosition(st: AppUIState): PaperPosition | null {
  const list = st.data?.portfolio.positions || [];
  return list.find((p) => p.currentR >= 1.5 && !p.isBreakEven) || null;
}

export function getActivePosition(st: AppUIState): PaperPosition | null {
  const list = st.data?.portfolio.positions || [];
  if (list.length === 0) return null;
  const idx = ((st.posIndex % list.length) + list.length) % list.length;
  return list[idx];
}

export function getPositionForSymbol(st: AppUIState, symbol: string | null | undefined): PaperPosition | null {
  if (!symbol) return null;
  const sym = symbol.toUpperCase();
  return (st.data?.portfolio.positions || []).find((p) => p.symbol.toUpperCase() === sym) || null;
}

export function getActiveFeedMessage(st: AppUIState): FeedMessage | null {
  const feed = st.data?.feed || [];
  if (feed.length === 0) return null;
  const idx = ((st.feedIndex % feed.length) + feed.length) % feed.length;
  return feed[idx];
}

export function getActiveMarket(st: AppUIState): MarketItem | null {
  const mkts = st.data?.markets || [];
  const findBySym = (sym?: string | null) =>
    sym ? mkts.find((m) => m.symbol.toUpperCase() === sym.toUpperCase()) || null : null;

  // 1. Inside MANAGE, always show the currently selected open position's market
  if (st.view === 'MANAGE') {
    const pos = getActivePosition(st);
    const pm = findBySym(pos?.symbol);
    if (pm) return pm;
  }

  // 2. Inside coin context menu or trade ticket, stay locked on the chosen coin
  if (st.lockedSymbol && st.view !== 'GLANCE') {
    const lm = findBySym(st.lockedSymbol);
    if (lm) return lm;
  }

  // 3. On GLANCE, priority prompts (triggered alert or 1.5R BE prompt) take precedence
  if (st.view === 'GLANCE') {
    const al = getActiveTriggeredAlert(st);
    const am = findBySym(al?.symbol);
    if (am) return am;

    const urgent = getUrgentBreakEvenPosition(st);
    const um = findBySym(urgent?.symbol);
    if (um) return um;
  }

  // 4. Otherwise match the active Telegram message's coin (e.g. BTC message => BTC!)
  const msg = getActiveFeedMessage(st);
  if (msg?.linkedMarket) {
    return findBySym(msg.linkedMarket.symbol) || msg.linkedMarket;
  }

  if (mkts.length === 0) return null;
  const idx = ((st.marketIndex % mkts.length) + mkts.length) % mkts.length;
  return mkts[idx];
}

export interface HudAction {
  label: string;
  kind:
    | 'MOVE_BE'
    | 'TAKE_HALF'
    | 'CLOSE_POS'
    | 'NEXT_POS'
    | 'START_SHORT'
    | 'START_LONG'
    | 'GO_TIMEFRAME'
    | 'DISMISS_ALERT'
    | 'GO_MANAGE'
    | 'GO_MANAGE_SYMBOL'
    | 'GO_REPLY'
    | 'SEND_TG_REPLY';
  payload?: string;
}

export function getManageActions(st: AppUIState, overridePos?: PaperPosition | null): HudAction[] {
  const pos = overridePos ?? getActivePosition(st);
  const allPositions = st.data?.portfolio.positions || [];

  if (!pos) {
    const mkt = getActiveMarket(st);
    const sym = mkt?.symbol || 'ETH';
    return [
      { label: `Short ${sym} (SL/TP)`, kind: 'START_SHORT', payload: sym },
      { label: `Long ${sym} (SL/TP)`, kind: 'START_LONG', payload: sym },
      { label: 'Back to feed', kind: 'GO_REPLY' },
    ];
  }

  const halfPnl = pos.unrealizedPnlUsd * 0.5;
  const hSign = halfPnl >= 0 ? '+' : '';
  const fSign = pos.unrealizedPnlUsd >= 0 ? '+' : '';
  const sym = pos.symbol;

  const actions: HudAction[] = [
    {
      label: pos.isBreakEven
        ? `${sym} SL at BE (${formatPx(pos.entryPrice)})`
        : `Move ${sym} SL to BE (${formatPx(pos.entryPrice)})`,
      kind: 'MOVE_BE',
      payload: pos.id,
    },
    { label: `Take 50% ${sym} (${hSign}$${halfPnl.toFixed(1)})`, kind: 'TAKE_HALF', payload: pos.id },
    { label: `Close ${sym} 100% (${fSign}$${pos.unrealizedPnlUsd.toFixed(1)})`, kind: 'CLOSE_POS', payload: pos.id },
  ];

  if (!overridePos && allPositions.length > 1) {
    const curIdx = allPositions.findIndex((p) => p.id === pos.id);
    const nextPos = allPositions[(curIdx + 1) % allPositions.length];
    actions.push({ label: `Switch to ${nextPos.symbol} ${nextPos.side}`, kind: 'NEXT_POS' });
  }

  if (!overridePos) {
    actions.push({ label: `New ${sym} trade`, kind: 'START_LONG', payload: sym });
  }

  return actions;
}

export function getAlertActions(symbol: string): HudAction[] {
  return [
    { label: `Short ${symbol} (place SL/TP)`, kind: 'START_SHORT', payload: symbol },
    { label: `Long ${symbol} (place SL/TP)`, kind: 'START_LONG', payload: symbol },
    { label: 'Dismiss alert', kind: 'DISMISS_ALERT' },
  ];
}

export function getReplyActions(st: AppUIState): HudAction[] {
  const mkt = getActiveMarket(st);
  const sym = mkt?.symbol || 'ETH';
  const tf = getActiveTimeframe(st);
  const msg = getActiveFeedMessage(st);
  const posOnThisCoin = getPositionForSymbol(st, sym);
  const allPositions = st.data?.portfolio.positions || [];
  const otherPositions = allPositions.filter((p) => p.symbol.toUpperCase() !== sym.toUpperCase());

  const smart = (msg?.smartReplies || ['Checking candles now']).slice(0, 1);
  const actions: HudAction[] = [];

  if (posOnThisCoin) {
    actions.push({
      label: `Manage ${sym} ${posOnThisCoin.side} (${posOnThisCoin.currentR >= 0 ? '+' : ''}${posOnThisCoin.currentR}R)`,
      kind: 'GO_MANAGE_SYMBOL',
      payload: sym,
    });
  }

  actions.push({ label: `Short ${sym} (${tf.label} SL/TP)`, kind: 'START_SHORT', payload: sym });
  actions.push({ label: `Long ${sym} (${tf.label} SL/TP)`, kind: 'START_LONG', payload: sym });
  actions.push({ label: `Chart TF: ${tf.label} (1m-1D)`, kind: 'GO_TIMEFRAME', payload: sym });

  for (const label of smart) {
    actions.push({ label, kind: 'SEND_TG_REPLY', payload: label });
  }

  if (otherPositions.length > 0) {
    const names = otherPositions
      .slice(0, 2)
      .map((p) => p.symbol)
      .join(', ');
    actions.push({ label: `Open positions (${names})`, kind: 'GO_MANAGE' });
  }

  return actions;
}

function fmtAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

function buildChart(st: AppUIState, mkt: MarketItem | null, levels?: G2ChartLevel[]): G2CandleChartSpec | null {
  const candles = st.candles || st.data?.candles || null;
  if (!mkt || !candles || candles.symbol !== mkt.symbol || !candles.bars || candles.bars.length < 2) return null;
  return {
    symbol: mkt.symbol,
    interval: candles.interval || '15m',
    bars: candles.bars,
    levels,
  };
}

function withSyncStatus(eyebrow: string, st: AppUIState): string {
  if (st.pendingSync) return `${st.pendingSync} · ${eyebrow}`;
  if (st.offline) return `offline · ${eyebrow}`;
  return eyebrow;
}

export function renderPage(st: AppUIState): G2PageSpec {
  const port = st.data?.portfolio;
  const alert = getActiveTriggeredAlert(st);
  const urgentPos = getUrgentBreakEvenPosition(st);
  const mkt = getActiveMarket(st);

  // 1. ROOT GLANCE
  if (st.view === 'GLANCE') {
    if (alert && mkt) {
      const actions = getAlertActions(mkt.symbol);
      const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
      const sign = mkt.change24hPct >= 0 ? '+' : '';
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `alert hit · ${mkt.symbol.toLowerCase()}`,
        main: [
          `${mkt.symbol} ${formatPx(mkt.markPx)} ${sign}${mkt.change24hPct}%`,
          alert.note ? truncate(alert.note, 28) : `level ${formatPx(alert.targetPrice)}`,
          '',
          ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
        ].join('\n'),
        hint: 'swipe pick · tap open · dbl exit',
        chart: buildChart(st, mkt, [{ price: alert.targetPrice, label: 'ALRT', emphasized: true }]),
      });
    }

    if (urgentPos) {
      const actions = getManageActions(st, urgentPos);
      const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
      const posMkt = st.data?.markets.find((m) => m.symbol === urgentPos.symbol) || mkt;
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `1.5R reached · ${urgentPos.symbol.toLowerCase()} ${urgentPos.side.toLowerCase()}`,
        main: [
          `${urgentPos.symbol} ${urgentPos.side} +${urgentPos.currentR}R`,
          `${formatPx(urgentPos.markPx)} (in ${formatPx(urgentPos.entryPrice)})`,
          '',
          ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
        ].join('\n'),
        hint: 'swipe pick · tap act · dbl exit',
        chart: buildChart(st, posMkt, [
          { price: urgentPos.entryPrice, label: 'IN', emphasized: true },
          { price: urgentPos.stopLoss, label: 'SL', emphasized: false },
        ]),
      });
    }

    const msg = getActiveFeedMessage(st);
    const sameCoinPos = mkt ? getPositionForSymbol(st, mkt.symbol) : null;
    const openCount = port?.openCount || 0;

    if (msg) {
      const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
      // Strictly show THIS message's coin — NEVER hijack a BTC message with an unrelated ETH position!
      const marketLine = sameCoinPos
        ? `${sameCoinPos.symbol} ${sameCoinPos.side} ${sameCoinPos.currentR >= 0 ? '+' : ''}${sameCoinPos.currentR}R${sameCoinPos.isBreakEven ? ' (BE)' : ''}`
        : mkt
          ? `${mkt.symbol} ${formatPx(mkt.markPx)} ${sign}${mkt.change24hPct}%`
          : '';
      const chartLevels: G2ChartLevel[] | undefined = sameCoinPos
        ? [
            { price: sameCoinPos.entryPrice, label: 'IN' },
            { price: sameCoinPos.stopLoss, label: sameCoinPos.isBreakEven ? 'BE' : 'SL', emphasized: true },
          ]
        : undefined;

      const openTag = openCount > 0 ? ` · ${openCount} open` : '';
      const syncTag = st.pendingSync ? ` · ${st.pendingSync}` : st.offline ? ' · offline' : '';
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `${truncate(msg.sender, 14)} · ${fmtAge(msg.timestamp)}${openTag}${syncTag || (st.toast ? ` · ${st.toast}` : '')}`,
        main: [
          truncate(msg.text, 68),
          '',
          marketLine,
          `› Tap for ${mkt?.symbol || 'trade'} / reply`,
        ]
          .filter(Boolean)
          .join('\n'),
        hint: 'tap open · swipe next · dbl exit',
        chart: buildChart(st, mkt, chartLevels),
      });
    }

    const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
    return buildMinimalHudPage({
      view: 'GLANCE',
      eyebrow: withSyncStatus(`glancedesk${openCount > 0 ? ` · ${openCount} open` : ''}`, st),
      main: [
        mkt ? `${mkt.symbol} ${formatPx(mkt.markPx)} ${sign}${mkt.change24hPct}%` : 'Connecting...',
        st.toast || 'Telegram: /alert NEAR 4.20 or /risk 242',
        '',
        sameCoinPos
          ? `Open: ${sameCoinPos.symbol} ${sameCoinPos.side} ${sameCoinPos.currentR >= 0 ? '+' : ''}${sameCoinPos.currentR}R`
          : `› Tap for ${mkt?.symbol || 'trade'} setup`,
      ].join('\n'),
      hint: 'tap open · swipe coin · dbl exit',
      chart: buildChart(st, mkt),
    });
  }

  // 1b. INLINE CHART TIMEFRAME PICKER (1m .. 1D) — NO SEPARATE TAB, LIVE CANDLESTICK PREVIEW
  if (st.view === 'TIMEFRAME') {
    const tf = getActiveTimeframe(st);
    const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
    const row1 = TIMEFRAMES.slice(0, 4)
      .map((t, i) => (i === st.timeframeIndex ? `[${t.label}]` : ` ${t.label} `))
      .join(' ');
    const row2 = TIMEFRAMES.slice(4)
      .map((t, i) => (i + 4 === st.timeframeIndex ? `[${t.label}]` : ` ${t.label} `))
      .join(' ');

    return buildMinimalHudPage({
      view: 'TIMEFRAME',
      eyebrow: `chart tf · ${(mkt?.symbol || 'perp').toLowerCase()} (1m–1D)`,
      main: [
        mkt ? `${mkt.symbol} ${formatPx(mkt.markPx)} ${sign}${mkt.change24hPct}%` : 'Select timeframe',
        row1,
        row2,
        `SL step ${tf.slStepPct}% · TP ${tf.tpStepPct}%`,
        `Tap to use ${tf.label} chart`,
      ].join('\n'),
      hint: 'swipe up/dn TF · tap apply · dbl back',
      chart: buildChart(st, mkt),
    });
  }

  // 2. STEP 1/3 — PLACE STOP LOSS FIRST ON LIVE OHLC CANDLES (TIMEFRAME-ADAPTIVE SENSITIVITY!)
  if (st.view === 'TICKET_SL') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    const tf = getActiveTimeframe(st);
    return buildMinimalHudPage({
      view: 'TICKET_SL',
      eyebrow: `1/3 stop loss · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()} (${tf.label})`,
      main: [
        `Entry ${formatPx(px)}`,
        `› SL ${formatPx(calc.stopLoss)} (${st.ticketSide === 'LONG' ? '-' : '+'}${st.ticketSlPct.toFixed(2)}%)`,
        '',
        `Step ±${tf.slStepPct}% (${tf.label} chart)`,
        `Tap to set Take Profit`,
      ].join('\n'),
      hint: 'swipe move SL · tap TP · dbl back',
      chart: buildChart(st, mkt, [
        { price: px, label: 'IN', emphasized: false },
        { price: calc.stopLoss, label: 'SL', emphasized: true },
      ]),
    });
  }

  // 3. STEP 2/3 — PLACE TAKE PROFIT ON LIVE OHLC CANDLES (TIMEFRAME-ADAPTIVE SENSITIVITY!)
  if (st.view === 'TICKET_TP') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    const tf = getActiveTimeframe(st);
    return buildMinimalHudPage({
      view: 'TICKET_TP',
      eyebrow: `2/3 take profit · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()} (${tf.label})`,
      main: [
        `SL ${formatPx(calc.stopLoss)} (${st.ticketSlPct.toFixed(2)}%)`,
        `› TP ${formatPx(calc.takeProfit)} (${st.ticketTpPct.toFixed(2)}%)`,
        '',
        `Setup R:R  ${calc.rr}R (±${tf.tpStepPct}%)`,
        `Tap to choose $ risk`,
      ].join('\n'),
      hint: 'swipe move TP · tap risk · dbl SL',
      chart: buildChart(st, mkt, [
        { price: calc.stopLoss, label: 'SL', emphasized: false },
        { price: px, label: 'IN', emphasized: false },
        { price: calc.takeProfit, label: 'TP', emphasized: true },
      ]),
    });
  }

  // 4. STEP 3/3 — 2D LOOPING NUMPAD FOR UNRESTRICTED EXACT $ RISK
  // SWIPE_DOWN = down (wraps), SWIPE_UP = right (wraps), TAP = select key, DOUBLE_TAP = confirm & review!
  if (st.view === 'TICKET_RISK') {
    const px = mkt?.markPx || 0;
    const activeVal = st.riskDraft.length > 0 ? Number(st.riskDraft) : st.riskUsd;
    const calc = computeRiskTicket({ ...st, riskUsd: Math.max(1, activeVal) }, px);
    const headerLine =
      st.riskDraft.length > 0
        ? `Risk: $${st.riskDraft}_  (+$${calc.profitUsd.toFixed(0)})`
        : `Enter risk: $_  (def $${st.riskUsd})`;

    return buildMinimalHudPage({
      view: 'TICKET_RISK',
      eyebrow: `3/3 enter $ risk · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()}`,
      main: [headerLine, ...formatNumpadRows(st.padRow, st.padCol)].join('\n'),
      hint: 'dn row · up col · tap pick · dbl ok',
      chart: buildChart(st, mkt, [
        { price: calc.stopLoss, label: 'SL', emphasized: true },
        { price: px, label: 'IN', emphasized: false },
        { price: calc.takeProfit, label: 'TP', emphasized: true },
      ]),
    });
  }

  // 5. REVIEW & MANDATORY "ARE YOU SURE?" GATE ON EVERY TRADE (SHOWS EXACT % OF BALANCE)
  if (st.view === 'TICKET_CONFIRM') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    const guard = evaluateRiskGuard(calc, port);
    const chartLevels: G2ChartLevel[] = [
      { price: calc.stopLoss, label: 'SL', emphasized: true },
      { price: px, label: 'IN', emphasized: false },
      { price: calc.takeProfit, label: 'TP', emphasized: true },
    ];

    if (guard.level === 'BLOCKED') {
      return buildMinimalHudPage({
        view: 'TICKET_CONFIRM',
        eyebrow: `! blocked · fat-finger guard`,
        main: [
          `! Risk -$${calc.riskUsd} (${guard.riskPct}% bal)`,
          `${guard.reason}`,
          `Size  ${formatQty(calc.qty)} ${mkt?.symbol || ''} (${formatNotional(calc.notionalUsd)})`,
          `Execution blocked`,
          `› Double-tap to edit $ risk`,
        ].join('\n'),
        hint: 'dbl edit $ risk · swipe edit TP',
        chart: buildChart(st, mkt, chartLevels),
      });
    }

    if (st.confirmArmed) {
      const highTag = guard.level === 'WARN' ? '! HIGH RISK · ' : '';
      return buildMinimalHudPage({
        view: 'TICKET_CONFIRM',
        eyebrow: `${highTag}are you sure? · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()}`,
        main: [
          `${guard.level === 'WARN' ? '! ' : ''}Risking ${guard.riskPct}% of balance`,
          `Loss -$${calc.riskUsd} -> Gain +$${calc.profitUsd.toFixed(0)}`,
          `Size  ${formatQty(calc.qty)} ${mkt?.symbol || ''} (${formatNotional(calc.notionalUsd)})`,
          `SL ${formatPx(calc.stopLoss)} · TP ${formatPx(calc.takeProfit)}`,
          `› Tap AGAIN to confirm`,
        ].join('\n'),
        hint: 'tap confirm trade · dbl edit $',
        chart: buildChart(st, mkt, chartLevels),
      });
    }

    return buildMinimalHudPage({
      view: 'TICKET_CONFIRM',
      eyebrow: `review paper · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()}`,
      main: [
        `› Risk -$${calc.riskUsd} -> +$${calc.profitUsd.toFixed(0)}`,
        `Size  ${formatQty(calc.qty)} ${mkt?.symbol || ''} (${formatNotional(calc.notionalUsd)})`,
        `SL ${formatPx(calc.stopLoss)} · TP ${formatPx(calc.takeProfit)}`,
        `Reward  ${calc.rr}R (${guard.riskPct}% bal)`,
        `Tap to execute trade`,
      ].join('\n'),
      hint: 'tap execute · dbl edit $ · swipe TP',
      chart: buildChart(st, mkt, chartLevels),
    });
  }

  // 5. MANAGE OPEN POSITION (EXPLICIT PER-COIN ACTIONS)
  if (st.view === 'MANAGE') {
    const allPos = port?.positions || [];
    const pos = getActivePosition(st);
    const actions = getManageActions(st);
    const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
    const posMkt = pos ? st.data?.markets.find((m) => m.symbol === pos.symbol) || mkt : mkt;
    const rStr = pos ? `${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R` : '';
    const idxNum = pos ? allPos.findIndex((p) => p.id === pos.id) + 1 : 0;
    const levels: G2ChartLevel[] | undefined = pos
      ? [
          { price: pos.entryPrice, label: 'IN' },
          { price: pos.stopLoss, label: pos.isBreakEven ? 'BE' : 'SL', emphasized: true },
          { price: pos.takeProfit, label: 'TP' },
        ]
      : undefined;

    return buildMinimalHudPage({
      view: 'MANAGE',
      eyebrow: withSyncStatus(
        pos
          ? `${pos.symbol.toLowerCase()} ${pos.side.toLowerCase()} (${idxNum}/${allPos.length}) · risk $${pos.riskUsd}`
          : 'positions · none open',
        st
      ),
      main: [
        pos ? `${pos.symbol} ${pos.side} ${rStr}` : 'No open paper positions',
        pos ? `${formatPx(pos.markPx)} (SL ${formatPx(pos.stopLoss)})` : `Cash $${(port?.cashUsd ?? 10000).toFixed(0)}`,
        '',
        ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
      ].join('\n'),
      hint: 'swipe pick · tap act · dbl back',
      chart: buildChart(st, posMkt, levels),
    });
  }

  // 6. COIN CONTEXT MENU (SCOPED TO ACTIVE COIN — e.g. BTC stays BTC!)
  const actions = getReplyActions(st);
  const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
  return buildMinimalHudPage({
    view: 'REPLY',
    eyebrow: mkt ? `${mkt.symbol.toLowerCase()} · ${formatPx(mkt.markPx)}` : 'actions',
    main: actions.map((a, i) => `${i === sel ? '› ' : '  '}${truncate(a.label, 38)}`).join('\n'),
    hint: 'swipe pick · tap go · dbl back',
  });
}
