import type { BackendState, CandleSeries, FeedMessage, MarketItem, PaperPosition, PriceAlert } from './api';
import { buildMinimalHudPage, truncate, type G2CandleChartSpec, type G2ChartLevel, type G2PageSpec } from './layout';

export type ViewName = 'GLANCE' | 'MANAGE' | 'TICKET_SIDE' | 'TICKET_SL' | 'TICKET_TP' | 'TICKET_CONFIRM' | 'REPLY';
export type Gesture = 'TAP' | 'DOUBLE_TAP' | 'SWIPE_UP' | 'SWIPE_DOWN';

// Clean 3-option R-multiplier on glasses (zero swipe fatigue!); base 1R is ANY exact $ via /risk or companion!
export const RISK_MULTIPLIERS = [0.5, 1.0, 2.0];

export interface AppUIState {
  view: ViewName;
  feedIndex: number;
  marketIndex: number;
  posIndex: number;
  actionIndex: number;
  // True 1R Risk-Based Order Ticket
  ticketSide: 'SHORT' | 'LONG';
  baseRiskUsd: number; // Exact 1R dollar risk (e.g. $100, $242, $850)
  riskMultIndex: number; // 0 => 0.5R, 1 => 1R, 2 => 2R
  ticketSlPct: number; // SL distance % from entry (slides live on candlesticks)
  ticketTpPct: number; // TP distance % from entry (slides live on candlesticks)
  toast: string;
  data: BackendState | null;
  candles: CandleSeries | null;
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

export function createInitialUIState(): AppUIState {
  return {
    view: 'GLANCE',
    feedIndex: 0,
    marketIndex: 0,
    posIndex: 0,
    actionIndex: 0,
    ticketSide: 'LONG',
    baseRiskUsd: 100,
    riskMultIndex: 1, // 1.0R default
    ticketSlPct: 0.75,
    ticketTpPct: 2.0,
    toast: '',
    data: null,
    candles: null,
  };
}

/**
 * True Risk-Based Position Math:
 * - Risk ($ loss if SL hits) is FIXED to exact chosen dollar risk (e.g. $100, $242, $850).
 * - Moving SL tighter increases coin qty/notional; moving SL wider decreases qty/notional.
 * - Hitting SL ALWAYS loses exactly `riskUsd`.
 */
export function computeRiskTicket(st: AppUIState, entryPx: number) {
  const mult = RISK_MULTIPLIERS[st.riskMultIndex % RISK_MULTIPLIERS.length];
  const riskUsd = Number((st.baseRiskUsd * mult).toFixed(2));
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
    mult,
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

export function getActivePosition(st: AppUIState): PaperPosition | null {
  const list = st.data?.portfolio.positions || [];
  if (list.length === 0) return null;
  const idx = ((st.posIndex % list.length) + list.length) % list.length;
  return list[idx];
}

export function getActiveFeedMessage(st: AppUIState): FeedMessage | null {
  const feed = st.data?.feed || [];
  if (feed.length === 0) return null;
  const idx = ((st.feedIndex % feed.length) + feed.length) % feed.length;
  return feed[idx];
}

export function getActiveMarket(st: AppUIState): MarketItem | null {
  const al = getActiveTriggeredAlert(st);
  if (al && st.data?.markets) {
    const found = st.data.markets.find((m) => m.symbol.toUpperCase() === al.symbol.toUpperCase());
    if (found) return found;
  }
  const pos = getActivePosition(st);
  if (st.view === 'MANAGE' && pos && st.data?.markets) {
    const found = st.data.markets.find((m) => m.symbol.toUpperCase() === pos.symbol.toUpperCase());
    if (found) return found;
  }
  const msg = getActiveFeedMessage(st);
  if (msg?.linkedMarket) return msg.linkedMarket;
  const mkts = st.data?.markets || [];
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
    | 'START_SHORT'
    | 'START_LONG'
    | 'DISMISS_ALERT'
    | 'GO_TICKET'
    | 'GO_MANAGE'
    | 'GO_REPLY'
    | 'SEND_TG_REPLY';
  payload?: string;
}

export function getManageActions(st: AppUIState): HudAction[] {
  const pos = getActivePosition(st);
  if (!pos) {
    return [
      { label: 'New setup', kind: 'GO_TICKET' },
      { label: 'Reply in Telegram', kind: 'GO_REPLY' },
    ];
  }
  const halfPnl = pos.unrealizedPnlUsd * 0.5;
  const hSign = halfPnl >= 0 ? '+' : '';
  const fSign = pos.unrealizedPnlUsd >= 0 ? '+' : '';
  return [
    {
      label: pos.isBreakEven ? `Stop at BE (${formatPx(pos.entryPrice)})` : `Move stop to BE (${formatPx(pos.entryPrice)})`,
      kind: 'MOVE_BE',
    },
    { label: `Take 50% (${hSign}$${halfPnl.toFixed(1)})`, kind: 'TAKE_HALF' },
    { label: `Close all (${fSign}$${pos.unrealizedPnlUsd.toFixed(1)})`, kind: 'CLOSE_POS' },
    { label: 'New trade setup', kind: 'GO_TICKET' },
  ];
}

export function getAlertActions(): HudAction[] {
  return [
    { label: 'Short (place SL & TP)', kind: 'START_SHORT' },
    { label: 'Long (place SL & TP)', kind: 'START_LONG' },
    { label: 'Dismiss alert', kind: 'DISMISS_ALERT' },
  ];
}

export function getReplyActions(st: AppUIState): HudAction[] {
  const msg = getActiveFeedMessage(st);
  const smart = msg?.smartReplies || [
    'Checking 15m candles now',
    'In a session, watching on glasses',
    'Stop moved to BE',
  ];
  return [
    { label: 'Set up trade (Risk + SL/TP)', kind: 'GO_TICKET' as const },
    ...smart.map((label) => ({ label, kind: 'SEND_TG_REPLY' as const, payload: label })),
    { label: 'Manage open position', kind: 'GO_MANAGE' as const },
  ];
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

export function renderPage(st: AppUIState): G2PageSpec {
  const port = st.data?.portfolio;
  const pos = getActivePosition(st);
  const alert = getActiveTriggeredAlert(st);
  const mkt = getActiveMarket(st);

  // 1. ROOT GLANCE
  if (st.view === 'GLANCE') {
    if (alert && mkt) {
      const actions = getAlertActions();
      const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
      const sign = mkt.change24hPct >= 0 ? '+' : '';
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `alert hit · ${mkt.symbol.toLowerCase()} · 1R $${st.baseRiskUsd}`,
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

    if (pos && pos.currentR >= 1.5 && !pos.isBreakEven) {
      const actions = getManageActions(st).slice(0, 3);
      const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
      const posMkt = st.data?.markets.find((m) => m.symbol === pos.symbol) || mkt;
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `1.5R reached · ${pos.symbol.toLowerCase()} ${pos.side.toLowerCase()}`,
        main: [
          `${pos.symbol} ${pos.side} +${pos.currentR}R`,
          `${formatPx(pos.markPx)} (in ${formatPx(pos.entryPrice)})`,
          '',
          ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
        ].join('\n'),
        hint: 'swipe pick · tap act · dbl exit',
        chart: buildChart(st, posMkt, [
          { price: pos.entryPrice, label: 'IN', emphasized: true },
          { price: pos.stopLoss, label: 'SL', emphasized: false },
        ]),
      });
    }

    const msg = getActiveFeedMessage(st);
    if (msg) {
      const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
      const posLine = pos
        ? `${pos.symbol} ${pos.side} ${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R${pos.isBreakEven ? ' (BE)' : ''}`
        : mkt
          ? `${mkt.symbol} ${formatPx(mkt.markPx)} ${sign}${mkt.change24hPct}%`
          : '';
      const chartLevels: G2ChartLevel[] | undefined =
        pos && pos.symbol === mkt?.symbol
          ? [
              { price: pos.entryPrice, label: 'IN' },
              { price: pos.stopLoss, label: pos.isBreakEven ? 'BE' : 'SL', emphasized: true },
            ]
          : undefined;

      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `${truncate(msg.sender, 16)} · ${fmtAge(msg.timestamp)} · 1R $${st.baseRiskUsd}${st.toast ? ` · ${st.toast}` : ''}`,
        main: [
          truncate(msg.text, 68),
          '',
          posLine,
          pos ? '› Tap to manage' : '› Tap to trade / reply',
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
      eyebrow: `glancedesk · 1R $${st.baseRiskUsd}`,
      main: [
        mkt ? `${mkt.symbol} ${formatPx(mkt.markPx)} ${sign}${mkt.change24hPct}%` : 'Connecting...',
        st.toast || 'Telegram: /risk 242 or /alert NEAR 4.20',
        '',
        pos ? `Open: ${pos.symbol} ${pos.side} ${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R` : '› Tap to set up trade',
      ].join('\n'),
      hint: 'tap setup · swipe coin · dbl exit',
      chart: buildChart(st, mkt),
    });
  }

  // 2. STEP 1/4 — SIDE & RISK (0.5R / 1R / 2R of your exact 1R dollar risk!)
  if (st.view === 'TICKET_SIDE') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    return buildMinimalHudPage({
      view: 'TICKET_SIDE',
      eyebrow: `1/4 risk · ${mkt?.symbol.toLowerCase() || 'perp'} · 1R = $${st.baseRiskUsd}`,
      main: [
        `${mkt?.symbol || 'PERP'} ${formatPx(px)}`,
        '',
        `› ${st.ticketSide}  Risk -$${calc.riskUsd} (${calc.mult}R)`,
        `  Auto-sizes to exact SL`,
        `  Tap to place Stop Loss`,
      ].join('\n'),
      hint: 'up flip side · dn 0.5/1/2R · tap SL',
      chart: buildChart(st, mkt, px > 0 ? [{ price: px, label: 'NOW' }] : undefined),
    });
  }

  // 3. STEP 2/4 — PLACE STOP LOSS ON CANDLES (RISK LOCKED, POSITION SIZE AUTO-CALCULATES!)
  if (st.view === 'TICKET_SL') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    return buildMinimalHudPage({
      view: 'TICKET_SL',
      eyebrow: `2/4 stop loss · risk locked -$${calc.riskUsd}`,
      main: [
        `Entry ${formatPx(px)}`,
        `› SL ${formatPx(calc.stopLoss)} (${st.ticketSlPct.toFixed(2)}%)`,
        '',
        `Max loss -$${calc.riskUsd}`,
        `Size ${formatQty(calc.qty)} ${mkt?.symbol || ''} (${formatNotional(calc.notionalUsd)})`,
      ].join('\n'),
      hint: 'swipe move SL · tap set TP · dbl back',
      chart: buildChart(st, mkt, [
        { price: px, label: 'IN', emphasized: false },
        { price: calc.stopLoss, label: 'SL', emphasized: true },
      ]),
    });
  }

  // 4. STEP 3/4 — PLACE TAKE PROFIT ON CANDLES (EXACT $ GAIN & R:R!)
  if (st.view === 'TICKET_TP') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    return buildMinimalHudPage({
      view: 'TICKET_TP',
      eyebrow: `3/4 take profit · risk -$${calc.riskUsd}`,
      main: [
        `SL ${formatPx(calc.stopLoss)} (-$${calc.riskUsd})`,
        `› TP ${formatPx(calc.takeProfit)} (${st.ticketTpPct.toFixed(2)}%)`,
        '',
        `Gain +$${calc.profitUsd.toFixed(0)}`,
        `Reward ${calc.rr}R`,
      ].join('\n'),
      hint: 'swipe move TP · tap review · dbl back',
      chart: buildChart(st, mkt, [
        { price: calc.stopLoss, label: 'SL', emphasized: false },
        { price: px, label: 'IN', emphasized: false },
        { price: calc.takeProfit, label: 'TP', emphasized: true },
      ]),
    });
  }

  // 5. STEP 4/4 — CONFIRM EXACT RISK-SIZED ORDER
  if (st.view === 'TICKET_CONFIRM') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    return buildMinimalHudPage({
      view: 'TICKET_CONFIRM',
      eyebrow: `4/4 confirm · size ${formatNotional(calc.notionalUsd)}`,
      main: [
        `${mkt?.symbol || 'PERP'} ${st.ticketSide} @ ${formatPx(px)}`,
        `SL ${formatPx(calc.stopLoss)} (-$${calc.riskUsd})`,
        `TP ${formatPx(calc.takeProfit)} (+$${calc.profitUsd.toFixed(0)} · ${calc.rr}R)`,
        `Qty ${formatQty(calc.qty)} ${mkt?.symbol || ''}`,
        '› Tap to execute paper',
      ].join('\n'),
      hint: 'tap confirm · dbl edit TP',
      chart: buildChart(st, mkt, [
        { price: calc.stopLoss, label: 'SL', emphasized: true },
        { price: px, label: 'IN', emphasized: false },
        { price: calc.takeProfit, label: 'TP', emphasized: true },
      ]),
    });
  }

  // 6. MANAGE OPEN POSITION
  if (st.view === 'MANAGE') {
    const actions = getManageActions(st);
    const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
    const posMkt = pos ? st.data?.markets.find((m) => m.symbol === pos.symbol) || mkt : mkt;
    const rStr = pos ? `${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R` : '';
    const levels: G2ChartLevel[] | undefined = pos
      ? [
          { price: pos.entryPrice, label: 'IN' },
          { price: pos.stopLoss, label: pos.isBreakEven ? 'BE' : 'SL', emphasized: true },
          { price: pos.takeProfit, label: 'TP' },
        ]
      : undefined;

    return buildMinimalHudPage({
      view: 'MANAGE',
      eyebrow: pos
        ? `${pos.symbol.toLowerCase()} ${pos.side.toLowerCase()} · risk $${pos.riskUsd}`
        : 'positions · none open',
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

  // 7. REPLY / QUICK ACTIONS
  const msg = getActiveFeedMessage(st);
  const actions = getReplyActions(st);
  const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
  return buildMinimalHudPage({
    view: 'REPLY',
    eyebrow: msg ? `reply · ${truncate(msg.sender, 22)}` : 'actions',
    main: actions.map((a, i) => `${i === sel ? '› ' : '  '}${truncate(a.label, 38)}`).join('\n'),
    hint: 'swipe pick · tap go · dbl back',
  });
}
