const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

export const INTERVAL_MS = {
  '1m': 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

export const SUPPORTED_INTERVALS = Object.keys(INTERVAL_MS);

export function normalizeInterval(interval) {
  const raw = String(interval || '15m').toLowerCase().trim();
  if (raw === 'daily' || raw === 'd') return '1d';
  return Object.prototype.hasOwnProperty.call(INTERVAL_MS, raw) ? raw : '15m';
}

const TICKER_ALIASES = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  near: 'NEAR',
  hyperliquid: 'HYPE',
  hype: 'HYPE',
  dogecoin: 'DOGE',
  doge: 'DOGE',
  sui: 'SUI',
  arbitrum: 'ARB',
  arb: 'ARB',
  optimism: 'OP',
  avalanche: 'AVAX',
  avax: 'AVAX',
  ripple: 'XRP',
  xrp: 'XRP',
  chainlink: 'LINK',
  link: 'LINK',
  bnb: 'BNB',
  ada: 'ADA',
  pepe: 'kPEPE',
};

export function normalizeHyperliquidMarkets(metaAndCtxs) {
  if (!Array.isArray(metaAndCtxs) || metaAndCtxs.length < 2) return [];
  const universe = metaAndCtxs[0]?.universe || [];
  const ctxs = metaAndCtxs[1] || [];
  const out = [];

  for (let i = 0; i < Math.min(universe.length, ctxs.length); i++) {
    const asset = universe[i];
    const ctx = ctxs[i];
    if (!asset?.name || !ctx) continue;
    const markPx = Number(ctx.markPx ?? ctx.midPx ?? 0);
    const prevDayPx = Number(ctx.prevDayPx ?? markPx);
    if (!Number.isFinite(markPx) || markPx <= 0) continue;
    const change24hPct = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : 0;
    const fundingRateHourlyPct = Number(ctx.funding ?? 0) * 100;
    const volume24hUsd = Number(ctx.dayNtlVlm ?? 0);

    out.push({
      id: `${asset.name}-PERP`,
      symbol: asset.name,
      markPx,
      prevDayPx,
      change24hPct: Number(change24hPct.toFixed(2)),
      fundingHourlyPct: Number(fundingRateHourlyPct.toFixed(4)),
      volume24hUsd: Number(volume24hUsd.toFixed(0)),
      maxLeverage: Number(asset.maxLeverage ?? 20),
    });
  }

  out.sort((a, b) => b.volume24hUsd - a.volume24hUsd);
  return out;
}

export function matchMarketToText(text, markets) {
  if (!Array.isArray(markets) || markets.length === 0) return null;
  const tokens = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\$/, ''))
    .filter(Boolean);

  const bySym = new Map(markets.map((m) => [m.symbol.toUpperCase(), m]));
  for (const tok of tokens) {
    const aliased = TICKER_ALIASES[tok];
    if (aliased && bySym.has(aliased.toUpperCase())) {
      return bySym.get(aliased.toUpperCase());
    }
    const upper = tok.toUpperCase();
    if (upper.length >= 2 && bySym.has(upper)) {
      return bySym.get(upper);
    }
  }
  return bySym.get('BTC') || markets[0];
}

export class HyperliquidClient {
  constructor(ttlMs = 8000) {
    this.ttlMs = ttlMs;
    this.cache = [];
    this.fetchedAt = 0;
    this.lastError = null;
    this.candleCache = new Map();
  }

  async getMarkets(force = false) {
    const now = Date.now();
    if (!force && this.cache.length > 0 && now - this.fetchedAt < this.ttlMs) {
      return { markets: this.cache, cached: true, source: 'hyperliquid_live', lastError: this.lastError };
    }
    try {
      const resp = await fetch(HL_INFO_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'GlanceDesk-EvenG2/4.0',
        },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`Hyperliquid HTTP ${resp.status}`);
      const data = await resp.json();
      const normalized = normalizeHyperliquidMarkets(data);
      if (normalized.length > 0) {
        this.cache = normalized;
        this.fetchedAt = now;
        this.lastError = null;
      }
      return { markets: this.cache, cached: false, source: 'hyperliquid_live', lastError: this.lastError };
    } catch (err) {
      this.lastError = String(err?.message || err);
      return { markets: this.cache, cached: true, source: 'hyperliquid_cache', lastError: this.lastError };
    }
  }

  /**
   * Fetch live OHLC candlestick bars (open, high, low, close, timestamp) from Hyperliquid.
   * Supports 1m, 3m, 5m, 15m, 1h, 2h, 4h, 1d (daily) with calibrated 26-bar lookback.
   */
  async getStructureCandles(symbol, rawInterval = '15m') {
    const coin = String(symbol || 'BTC').replace(/-PERP$/i, '').toUpperCase();
    const interval = normalizeInterval(rawInterval);
    const cacheKey = `${coin}:${interval}`;
    const now = Date.now();
    const ttlMs = interval === '1m' || interval === '3m' ? 10000 : interval === '5m' || interval === '15m' ? 25000 : 60000;
    const existing = this.candleCache.get(cacheKey);
    if (existing && now - existing.fetchedAt < ttlMs) {
      return existing;
    }

    const barMs = INTERVAL_MS[interval] || INTERVAL_MS['15m'];
    const lookbackMs = barMs * 26;

    try {
      const resp = await fetch(HL_INFO_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'GlanceDesk-EvenG2/4.0',
        },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin, interval, startTime: now - lookbackMs, endTime: now },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`Hyperliquid candles HTTP ${resp.status}`);
      const raw = await resp.json();
      const bars = (Array.isArray(raw) ? raw : [])
        .map((c) => ({
          t: Number(c.t),
          o: Number(c.o),
          h: Number(c.h),
          l: Number(c.l),
          c: Number(c.c),
        }))
        .filter((b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0)
        .slice(-22);

      if (bars.length >= 2) {
        const entry = {
          symbol: coin,
          interval,
          fetchedAt: now,
          bars,
          high: Math.max(...bars.map((b) => b.h)),
          low: Math.min(...bars.map((b) => b.l)),
        };
        this.candleCache.set(cacheKey, entry);
        return entry;
      }
    } catch {
      // Fallback to cached
    }
    return existing || { symbol: coin, interval, fetchedAt: 0, bars: [], high: 0, low: 0 };
  }
}
