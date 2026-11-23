import type { BackendState, CandleSeries, FeedMessage, MarketItem, PaperPosition, PriceAlert } from './api';
import { buildMinimalHudPage, truncate, type G2PageSpec, type G2SparklineSpec } from './layout';

export type ViewName = 'GLANCE' | 'MANAGE' | 'ENTRY' | 'REPLY' | 'VOICE';
export type Gesture = 'TAP' | 'DOUBLE_TAP' | 'SWIPE_UP' | 'SWIPE_DOWN' | 'LONG_PRESS_START' | 'LONG_PRESS_END';

export interface AppUIState {
  view: ViewName;
  feedIndex: number;
  marketIndex: number;
  posIndex: number;
  actionIndex: number;
  orderSide: 'SHORT' | 'LONG';
  orderStakeIndex: number;
  toast: string;
  voiceCapturing: boolean;
  data: BackendState | null;
  candles: CandleSeries | null;
}

export const PAPER_NOTIONALS = [100, 250, 500];

export function formatPx(px: number): string {
  if (px >= 1000) return `$${px.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (px >= 1) return `$${px.toFixed(2)}`;
  return `$${px.toFixed(4)}`;
}

export function createInitialUIState(): AppUIState {
  return {
    view: 'GLANCE',
    feedIndex: 0,
    marketIndex: 0,
    posIndex: 0,
    actionIndex: 0,
    orderSide: 'SHORT',
    orderStakeIndex: 1, // $250 default
    toast: '',
    voiceCapturing: false,
    data: null,
    candles: null,
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
    | 'OPEN_SHORT'
    | 'OPEN_LONG'
    | 'DISMISS_ALERT'
    | 'GO_ENTRY'
    | 'GO_MANAGE'
    | 'GO_REPLY'
    | 'SEND_TG_REPLY';
  payload?: string;
}

export function getManageActions(st: AppUIState): HudAction[] {
  const pos = getActivePosition(st);
  if (!pos) {
    return [
      { label: 'New paper setup', kind: 'GO_ENTRY' },
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
    { label: 'New setup / Reply', kind: 'GO_ENTRY' },
  ];
}

export function getAlertActions(st: AppUIState): HudAction[] {
  const notional = PAPER_NOTIONALS[st.orderStakeIndex % PAPER_NOTIONALS.length];
  return [
    { label: `Short $${notional} · SL +1.5% · TP 2R`, kind: 'OPEN_SHORT' },
    { label: `Long  $${notional} · SL -1.5% · TP 2R`, kind: 'OPEN_LONG' },
    { label: 'Dismiss alert', kind: 'DISMISS_ALERT' },
  ];
}

export function getReplyActions(st: AppUIState): HudAction[] {
  const msg = getActiveFeedMessage(st);
  const smart = msg?.smartReplies || [
    'Seeing the move, checking level',
    'In a lecture, managing on glasses',
    'Stop moved to BE, will update',
  ];
  return [
    ...smart.map((label) => ({ label, kind: 'SEND_TG_REPLY' as const, payload: label })),
    { label: 'Open paper trade', kind: 'GO_ENTRY' as const },
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

function buildSparkline(st: AppUIState, mkt: MarketItem | null, refLevel?: number, refLabel?: string): G2SparklineSpec | null {
  const candles = st.candles || st.data?.candles || null;
  if (!mkt || !candles || candles.symbol !== mkt.symbol || candles.closes.length < 2) return null;
  return {
    symbol: mkt.symbol,
    interval: candles.interval || '15m',
    closes: candles.closes,
    change24hPct: mkt.change24hPct,
    refLevel,
    refLabel,
  };
}

export function renderPage(st: AppUIState): G2PageSpec {
  const port = st.data?.portfolio;
  const pos = getActivePosition(st);
  const alert = getActiveTriggeredAlert(st);
  const mkt = getActiveMarket(st);

  if (st.view === 'VOICE') {
    const msg = getActiveFeedMessage(st);
    return buildMinimalHudPage({
      view: 'VOICE',
      eyebrow: 'voice reply · listening',
      main: [
        '● Listening...',
        '',
        msg ? `To ${msg.sender}` : 'To Telegram group',
        'Release when finished.',
      ].join('\n'),
      hint: 'release send · dbl cancel',
    });
  }

  // Root GLANCE view: automatically shows the ONE urgent thing right now
  if (st.view === 'GLANCE') {
    // Priority 1: Active triggered price alert (structure check -> 1-tap short/long)
    if (alert && mkt) {
      const actions = getAlertActions(st);
      const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
      const sign = mkt.change24hPct >= 0 ? '+' : '';
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `alert hit · ${mkt.symbol.toLowerCase()}-perp · paper`,
        main: [
          `${mkt.symbol}  ${formatPx(mkt.markPx)}  ${sign}${mkt.change24hPct}%`,
          alert.note ? truncate(alert.note, 34) : `crossed ${formatPx(alert.targetPrice)}`,
          '',
          ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
        ].join('\n'),
        hint: 'swipe pick · tap execute · dbl exit',
        sparkline: buildSparkline(st, mkt, alert.targetPrice, 'alert'),
      });
    }

    // Priority 2: Open position reached >= 1.5R (Break-Even prompt!)
    if (pos && pos.currentR >= 1.5 && !pos.isBreakEven) {
      const actions = getManageActions(st).slice(0, 3);
      const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
      const posMkt = st.data?.markets.find((m) => m.symbol === pos.symbol) || mkt;
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `1.5R reached · ${pos.symbol.toLowerCase()} ${pos.side.toLowerCase()}`,
        main: [
          `${pos.symbol} ${pos.side}   +${pos.currentR}R`,
          `${formatPx(pos.markPx)}  (in ${formatPx(pos.entryPrice)})`,
          '',
          ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
        ].join('\n'),
        hint: 'swipe pick · tap act · dbl exit',
        sparkline: buildSparkline(st, posMkt, pos.entryPrice, 'entry'),
      });
    }

    // Priority 3: Clean Telegram glance paired with live perp + structure curve
    const msg = getActiveFeedMessage(st);
    if (msg) {
      const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
      const posLine = pos
        ? `${pos.symbol} ${pos.side} ${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R${pos.isBreakEven ? ' (BE)' : ''}`
        : mkt
          ? `${mkt.symbol}  ${formatPx(mkt.markPx)}  ${sign}${mkt.change24hPct}%`
          : '';
      return buildMinimalHudPage({
        view: 'GLANCE',
        eyebrow: `${truncate(msg.sender, 20)} · ${fmtAge(msg.timestamp)}${st.toast ? ` · ${st.toast}` : ''}`,
        main: [
          truncate(msg.text, 88),
          '',
          posLine,
          pos ? '› Tap to manage position' : '› Tap to reply or trade',
        ]
          .filter(Boolean)
          .join('\n'),
        hint: 'tap act · swipe next · hold voice · dbl exit',
        sparkline: buildSparkline(st, mkt, pos && pos.symbol === mkt?.symbol ? pos.stopLoss : undefined, pos?.isBreakEven ? 'BE' : 'SL'),
      });
    }

    // Fallback when no Telegram messages yet: clean perp glance
    const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
    return buildMinimalHudPage({
      view: 'GLANCE',
      eyebrow: `glancedesk · ${mkt ? mkt.symbol.toLowerCase() : 'ready'} · paper`,
      main: [
        mkt ? `${mkt.symbol}  ${formatPx(mkt.markPx)}  ${sign}${mkt.change24hPct}%` : 'Connecting to Hyperliquid...',
        st.toast || 'Send /alert NEAR 4.20 in Telegram',
        '',
        pos ? `Open: ${pos.symbol} ${pos.side} ${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R` : '› Tap to open paper setup',
      ].join('\n'),
      hint: 'tap trade · swipe coin · dbl exit',
      sparkline: buildSparkline(st, mkt),
    });
  }

  if (st.view === 'MANAGE') {
    const actions = getManageActions(st);
    const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
    const posMkt = pos ? st.data?.markets.find((m) => m.symbol === pos.symbol) || mkt : mkt;
    const rStr = pos ? `${pos.currentR >= 0 ? '+' : ''}${pos.currentR}R` : '';
    return buildMinimalHudPage({
      view: 'MANAGE',
      eyebrow: pos
        ? `${pos.symbol.toLowerCase()} ${pos.side.toLowerCase()} · sl ${formatPx(pos.stopLoss)}${pos.isBreakEven ? ' (be)' : ''}`
        : 'positions · none open',
      main: [
        pos ? `${pos.symbol} ${pos.side}   ${rStr}` : 'No open paper positions',
        pos ? `${formatPx(pos.markPx)}  (in ${formatPx(pos.entryPrice)})` : `Cash $${(port?.cashUsd ?? 10000).toFixed(0)}`,
        '',
        ...actions.map((a, i) => `${i === sel ? '› ' : '  '}${a.label}`),
      ].join('\n'),
      hint: 'swipe pick · tap confirm · dbl back',
      sparkline: buildSparkline(st, posMkt, pos?.stopLoss, pos?.isBreakEven ? 'BE' : 'SL'),
    });
  }

  if (st.view === 'ENTRY') {
    const notional = PAPER_NOTIONALS[st.orderStakeIndex % PAPER_NOTIONALS.length];
    const px = mkt?.markPx || 0;
    const slPx = st.orderSide === 'SHORT' ? px * 1.015 : px * 0.985;
    const tpPx = st.orderSide === 'SHORT' ? px * 0.97 : px * 1.03;
    const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
    return buildMinimalHudPage({
      view: 'ENTRY',
      eyebrow: `paper setup · ${mkt ? mkt.symbol.toLowerCase() : 'perp'} · 2R auto`,
      main: [
        mkt ? `${mkt.symbol}  ${formatPx(px)}  ${sign}${mkt.change24hPct}%` : 'Loading mark...',
        '',
        `› ${st.orderSide} $${notional} (paper)`,
        `  SL ${formatPx(slPx)} · TP ${formatPx(tpPx)}`,
      ].join('\n'),
      hint: 'swipe flip side/size · tap enter · dbl back',
      sparkline: buildSparkline(st, mkt, slPx, 'SL'),
    });
  }

  // REPLY view
  const msg = getActiveFeedMessage(st);
  const actions = getReplyActions(st);
  const sel = ((st.actionIndex % actions.length) + actions.length) % actions.length;
  return buildMinimalHudPage({
    view: 'REPLY',
    eyebrow: msg ? `reply to ${truncate(msg.sender, 24)}` : 'quick actions',
    main: actions.map((a, i) => `${i === sel ? '› ' : '  '}${truncate(a.label, 42)}`).join('\n'),
    hint: 'swipe pick · tap send · dbl back',
  });
}
