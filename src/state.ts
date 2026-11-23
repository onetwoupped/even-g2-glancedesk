import type { BackendState, FeedMessage, MarketItem } from './api';
import { buildThreeZonePage, truncate, type G2PageSpec } from './layout';

export type ViewName = 'FEED' | 'REPLY' | 'ORDER' | 'PORT' | 'VOICE';
export type Gesture = 'TAP' | 'DOUBLE_TAP' | 'SWIPE_UP' | 'SWIPE_DOWN' | 'LONG_PRESS_START' | 'LONG_PRESS_END';

export interface AppUIState {
  view: ViewName;
  feedIndex: number;
  marketIndex: number;
  replyOptionIndex: number;
  orderSide: 'LONG' | 'SHORT';
  orderStakeIndex: number;
  portIndex: number;
  toast: string;
  voiceCapturing: boolean;
  data: BackendState | null;
}

export const PAPER_NOTIONALS = [100, 250, 500];

export function formatPx(px: number): string {
  if (px >= 1000) return `$${px.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (px >= 1) return `$${px.toFixed(2)}`;
  return `$${px.toFixed(4)}`;
}

export function createInitialUIState(): AppUIState {
  return {
    view: 'FEED',
    feedIndex: 0,
    marketIndex: 0,
    replyOptionIndex: 0,
    orderSide: 'LONG',
    orderStakeIndex: 1, // $250 default
    portIndex: 0,
    toast: '',
    voiceCapturing: false,
    data: null,
  };
}

export function getActiveFeedMessage(st: AppUIState): FeedMessage | null {
  const feed = st.data?.feed || [];
  if (feed.length === 0) return null;
  const idx = ((st.feedIndex % feed.length) + feed.length) % feed.length;
  return feed[idx];
}

export function getActiveMarket(st: AppUIState): MarketItem | null {
  const msg = getActiveFeedMessage(st);
  if (msg?.linkedMarket) return msg.linkedMarket;
  const mkts = st.data?.markets || [];
  if (mkts.length === 0) return null;
  const idx = ((st.marketIndex % mkts.length) + mkts.length) % mkts.length;
  return mkts[idx];
}

export function getReplyOptions(st: AppUIState): Array<{ label: string; kind: 'TG_REPLY' | 'GO_ORDER' | 'GO_PORT' }> {
  const msg = getActiveFeedMessage(st);
  const smart = msg?.smartReplies || [
    'Checking Hyperliquid mark now',
    'Locked in, watching on G2',
    'Share target/stop? Hands-free',
  ];
  return [
    ...smart.map((label) => ({ label, kind: 'TG_REPLY' as const })),
    { label: 'Open Paper Order (Hyperliquid)', kind: 'GO_ORDER' as const },
    { label: 'View Paper Portfolio & Live PnL', kind: 'GO_PORT' as const },
  ];
}

function fmtAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h`;
}

export function renderPage(st: AppUIState): G2PageSpec {
  const port = st.data?.portfolio;
  const bal = port ? `$${port.cashUsd.toFixed(0)}` : '$10000';
  const pnl = port ? `${port.totalPnlUsd >= 0 ? '+' : ''}$${port.totalPnlUsd.toFixed(2)}` : '+$0.00';

  if (st.view === 'VOICE') {
    const msg = getActiveFeedMessage(st);
    return buildThreeZonePage({
      view: 'VOICE',
      header: 'G2 MIC LIVE · VOICE REPLY',
      body: [
        '● LISTENING ON EVEN G2 MICROPHONE...',
        '',
        `Target: ${msg ? `${msg.sender} (${msg.chatTitle})` : 'Active Telegram Group'}`,
        'Speak short reply or perp action.',
        'Release temple / ring to send to Telegram.',
      ].join('\n'),
      footer: 'RELEASE: Send Voice Reply · DBL-TAP: Cancel',
    });
  }

  if (st.view === 'FEED') {
    const msg = getActiveFeedMessage(st);
    const mkt = getActiveMarket(st);
    if (!msg) {
      const mSign = mkt && mkt.change24hPct >= 0 ? '+' : '';
      const mLine = mkt
        ? `${mkt.symbol}-PERP  ${formatPx(mkt.markPx)}  (${mSign}${mkt.change24hPct}% 24h)\nFunding: ${mkt.fundingHourlyPct >= 0 ? '+' : ''}${mkt.fundingHourlyPct}%/hr · Vol: $${Math.round(mkt.volume24hUsd / 1e6)}M`
        : 'Loading live Hyperliquid perps...';
      return buildThreeZonePage({
        view: 'FEED',
        header: `GLANCEDESK · TG READY · BAL ${bal}`,
        body: [
          st.toast ? `[!] ${st.toast}` : `Bot @${st.data?.telegram.botUsername || 'sezirneonbot'} connected.`,
          'Send a message in Telegram (e.g. "SOL breakout") to link live perps.',
          '',
          'HYPERLIQUID LIVE:',
          mLine,
        ].join('\n'),
        footer: 'TAP: Paper Perp · SWIPE: Next Perp · DBL: Exit',
      });
    }

    const total = st.data?.feed.length || 1;
    const pos = (((st.feedIndex % total) + total) % total) + 1;
    const mSign = mkt && mkt.change24hPct >= 0 ? '+' : '';
    const mktLine = mkt
      ? `HL: ${mkt.symbol}-PERP ${formatPx(mkt.markPx)} (${mSign}${mkt.change24hPct}%) · F:${mkt.fundingHourlyPct >= 0 ? '+' : ''}${mkt.fundingHourlyPct}%`
      : 'HL: Syncing live mark...';
    return buildThreeZonePage({
      view: 'FEED',
      header: `TG [${pos}/${total}] ${truncate(msg.sender, 18)} · ${fmtAge(msg.timestamp)}`,
      body: [
        st.toast ? `✓ ${st.toast}` : '',
        truncate(msg.text, 150),
        '',
        mktLine,
      ]
        .filter(Boolean)
        .join('\n'),
      footer: 'TAP: Reply/Trade · SWIPE: Next · HOLD: Voice · DBL: Exit',
    });
  }

  if (st.view === 'REPLY') {
    const msg = getActiveFeedMessage(st);
    const opts = getReplyOptions(st);
    const idx = ((st.replyOptionIndex % opts.length) + opts.length) % opts.length;
    const lines = opts.map((o, i) => `${i === idx ? '▶ ' : '  '}${truncate(o.label, 48)}`);
    return buildThreeZonePage({
      view: 'REPLY',
      header: `ACT ON: ${msg ? truncate(msg.sender, 24) : 'TELEGRAM'}`,
      body: lines.join('\n'),
      footer: 'SWIPE: Select · TAP: Confirm/Send · DBL: Back',
    });
  }

  if (st.view === 'ORDER') {
    const mkt = getActiveMarket(st);
    const notional = PAPER_NOTIONALS[st.orderStakeIndex % PAPER_NOTIONALS.length];
    const px = mkt ? mkt.markPx : 0;
    const qty = px > 0 ? (notional / px).toFixed(4) : '0';
    const sign = mkt && mkt.change24hPct >= 0 ? '+' : '';
    return buildThreeZonePage({
      view: 'ORDER',
      header: `HYPERLIQUID PAPER (SIM) · ${bal}`,
      body: [
        mkt
          ? `${mkt.symbol}-PERP · Mark ${formatPx(mkt.markPx)} (${sign}${mkt.change24hPct}% 24h)`
          : 'No live market loaded',
        '',
        `ACTION: [ ${st.orderSide} $${notional} ]  (${qty} ${mkt?.symbol || ''})`,
        `Simulated paper trade · Receipt auto-posts to Telegram`,
      ].join('\n'),
      footer: 'SWIPE: Flip LONG/SHORT · TAP: Confirm · DBL: Back',
    });
  }

  // PORT view
  const positions = port?.positions || [];
  let bodyLines: string[];
  if (positions.length === 0) {
    bodyLines = [
      'No open paper perp positions yet.',
      `Cash: ${bal} (Simulated USD)`,
      'Go back to FEED -> TAP -> Open Paper Order.',
    ];
  } else {
    const start = ((st.portIndex % positions.length) + positions.length) % positions.length;
    const slice = positions.slice(start, start + 3);
    bodyLines = slice.map((p) => {
      const sign = p.unrealizedPnlUsd >= 0 ? '+' : '';
      return `${p.side} ${p.symbol} $${p.notionalUsd} @${formatPx(p.entryPrice)}→${formatPx(p.markPx)} (${sign}$${p.unrealizedPnlUsd.toFixed(2)})`;
    });
  }

  return buildThreeZonePage({
    view: 'PORT',
    header: `PAPER PORTFOLIO · PNL ${pnl} · ${bal}`,
    body: bodyLines.join('\n'),
    footer: 'SWIPE: Scroll · TAP: Refresh Live Mark · DBL: Feed',
  });
}
