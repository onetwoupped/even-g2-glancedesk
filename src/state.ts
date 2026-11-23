import type { BackendState, CandleSeries, FeedMessage, MarketItem, PaperPosition, PriceAlert } from './api';
import { buildMinimalHudPage, truncate, type G2CandleChartSpec, type G2ChartLevel, type G2PageSpec } from './layout';

export type ViewName = 'GLANCE' | 'MANAGE' | 'TICKET_SL' | 'TICKET_TP' | 'TICKET_RISK' | 'REPLY';
export type Gesture = 'TAP' | 'DOUBLE_TAP' | 'SWIPE_UP' | 'SWIPE_DOWN';

export interface AppUIState {
  view: ViewName;
  feedIndex: number;
  marketIndex: number;
  posIndex: number;
  actionIndex: number;
  // Coin lock prevents background feed updates or unrelated open positions from hijacking active setup
  lockedSymbol: string | null;
  // Structure-first 3-step trade ticket: 1) SL -> 2) TP -> 3) Exact $ Risk (4-digit picker) & Execute
  ticketSide: 'SHORT' | 'LONG';
  ticketSlPct: number;
  ticketTpPct: number;
  riskUsd: number;
  riskDigits: [number, number, number, number]; // [thousands, hundreds, tens, ones] => $0001..$9999
  riskCursor: number; // 0..3 editing digit, 4 = ready to execute
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

/**
 * Convert any dollar amount ($1..$9999) into 4 editable digits [thousands, hundreds, tens, ones]
 * so the user can enter ANY exact risk (e.g. $240, $253, $850, $35) directly on G2 glasses
 * using only Swipe Up/Down + Tap (no phone required, no fixed step jumps).
 */
export function riskToDigits(usd: number): [number, number, number, number] {
  const n = Math.max(1, Math.min(9999, Math.round(Number(usd) || 100)));
  return [Math.floor(n / 1000) % 10, Math.floor(n / 100) % 10, Math.floor(n / 10) % 10, n % 10];
}

export function digitsToRisk(digits: [number, number, number, number]): number {
  return digits[0] * 1000 + digits[1] * 100 + digits[2] * 10 + digits[3];
}

export function formatDigitPicker(digits: [number, number, number, number], cursor: number): string {
  return '$' + digits.map((d, i) => (i === cursor ? `[${d}]` : `${d}`)).join(' ');
}

export function createInitialUIState(): AppUIState {
  return {
    view: 'GLANCE',
    feedIndex: 0,
    marketIndex: 0,
    posIndex: 0,
    actionIndex: 0,
    lockedSymbol: null,
    ticketSide: 'LONG',
    ticketSlPct: 0.75,
    ticketTpPct: 2.0,
    riskUsd: 100,
    riskDigits: [0, 1, 0, 0],
    riskCursor: 0,
    toast: '',
    data: null,
    candles: null,
  };
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
  const msg = getActiveFeedMessage(st);
  const posOnThisCoin = getPositionForSymbol(st, sym);
  const allPositions = st.data?.portfolio.positions || [];
  const otherPositions = allPositions.filter((p) => p.symbol.toUpperCase() !== sym.toUpperCase());

  const smart = (msg?.smartReplies || ['Checking 15m candles', 'Watching on glasses']).slice(0, 2);
  const actions: HudAction[] = [];

  if (posOnThisCoin) {
    actions.push({
      label: `Manage ${sym} ${posOnThisCoin.side} (${posOnThisCoin.currentR >= 0 ? '+' : ''}${posOnThisCoin.currentR}R)`,
      kind: 'GO_MANAGE_SYMBOL',
      payload: sym,
    });
  }

  actions.push({ label: `Short ${sym} (place SL/TP)`, kind: 'START_SHORT', payload: sym });
  actions.push({ label: `Long ${sym} (place SL/TP)`, kind: 'START_LONG', payload: sym });

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
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `${truncate(msg.sender, 16)} · ${fmtAge(msg.timestamp)}${openTag}${st.toast ? ` · ${st.toast}` : ''}`,
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
      eyebrow: `glancedesk${openCount > 0 ? ` · ${openCount} open` : ''}`,
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

  // 2. STEP 1/3 — PLACE STOP LOSS FIRST ON LIVE OHLC CANDLES (STRUCTURE FIRST)
  if (st.view === 'TICKET_SL') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    return buildMinimalHudPage({
      view: 'TICKET_SL',
      eyebrow: `1/3 stop loss · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()}`,
      main: [
        `Entry ${formatPx(px)}`,
        `› SL ${formatPx(calc.stopLoss)} (${st.ticketSide === 'LONG' ? '-' : '+'}${st.ticketSlPct.toFixed(2)}%)`,
        '',
        `Place SL on structure`,
        `Tap to set Take Profit`,
      ].join('\n'),
      hint: 'swipe move SL · tap TP · dbl back',
      chart: buildChart(st, mkt, [
        { price: px, label: 'IN', emphasized: false },
        { price: calc.stopLoss, label: 'SL', emphasized: true },
      ]),
    });
  }

  // 3. STEP 2/3 — PLACE TAKE PROFIT ON LIVE OHLC CANDLES (LOCKS R:R)
  if (st.view === 'TICKET_TP') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    return buildMinimalHudPage({
      view: 'TICKET_TP',
      eyebrow: `2/3 take profit · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()}`,
      main: [
        `SL ${formatPx(calc.stopLoss)} (${st.ticketSlPct.toFixed(2)}%)`,
        `› TP ${formatPx(calc.takeProfit)} (${st.ticketTpPct.toFixed(2)}%)`,
        '',
        `Setup R:R  ${calc.rr}R`,
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

  // 4. STEP 3/3 — EXACT 4-DIGIT $ RISK PICKER ON GLASSES ($0001..$9999) + EXECUTE
  if (st.view === 'TICKET_RISK') {
    const px = mkt?.markPx || 0;
    const calc = computeRiskTicket(st, px);
    const slotNames = ['1000s', '100s', '10s', '1s'];
    const editing = st.riskCursor >= 0 && st.riskCursor < 4;

    if (editing) {
      const nextHint = st.riskCursor < 3 ? `Tap -> ${slotNames[st.riskCursor + 1]} digit` : 'Tap -> review & execute';
      return buildMinimalHudPage({
        view: 'TICKET_RISK',
        eyebrow: `3/3 set $ risk (${slotNames[st.riskCursor]}) · ${(mkt?.symbol || 'perp').toLowerCase()}`,
        main: [
          `Risk  ${formatDigitPicker(st.riskDigits, st.riskCursor)}`,
          `Gain  +$${calc.profitUsd.toFixed(0)} (${calc.rr}R)`,
          `Size  ${formatQty(calc.qty)} ${mkt?.symbol || ''} (${formatNotional(calc.notionalUsd)})`,
          `SL ${formatPx(calc.stopLoss)} · TP ${formatPx(calc.takeProfit)}`,
          nextHint,
        ].join('\n'),
        hint: 'up/dn 0-9 · tap next · dbl back',
        chart: buildChart(st, mkt, [
          { price: calc.stopLoss, label: 'SL', emphasized: true },
          { price: px, label: 'IN', emphasized: false },
          { price: calc.takeProfit, label: 'TP', emphasized: true },
        ]),
      });
    }

    return buildMinimalHudPage({
      view: 'TICKET_RISK',
      eyebrow: `confirm paper · ${(mkt?.symbol || 'perp').toLowerCase()} ${st.ticketSide.toLowerCase()}`,
      main: [
        `› Execute  -$${calc.riskUsd} -> +$${calc.profitUsd.toFixed(0)}`,
        `Size  ${formatQty(calc.qty)} ${mkt?.symbol || ''} (${formatNotional(calc.notionalUsd)})`,
        `SL ${formatPx(calc.stopLoss)} · TP ${formatPx(calc.takeProfit)}`,
        `Reward  ${calc.rr}R`,
        `Tap to execute paper`,
      ].join('\n'),
      hint: 'tap execute · dbl edit $ risk',
      chart: buildChart(st, mkt, [
        { price: calc.stopLoss, label: 'SL', emphasized: true },
        { price: px, label: 'IN', emphasized: false },
        { price: calc.takeProfit, label: 'TP', emphasized: true },
      ]),
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
      eyebrow: pos
        ? `${pos.symbol.toLowerCase()} ${pos.side.toLowerCase()} (${idxNum}/${allPos.length}) · risk $${pos.riskUsd}`
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
