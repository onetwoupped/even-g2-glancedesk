const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

const TICKER_ALIASES = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  hyperliquid: 'HYPE',
  hype: 'HYPE',
  dogecoin: 'DOGE',
  doge: 'DOGE',
  sui: 'SUI',
  arbitrum: 'ARB',
  arb: 'ARB',
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
  constructor(ttlMs = 10000) {
    this.ttlMs = ttlMs;
    this.cache = [];
    this.fetchedAt = 0;
    this.lastError = null;
    this.candleCache = new Map(); // symbol -> { fetchedAt, closes, high, low }
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
          'User-Agent': 'GlanceDesk-EvenG2/2.0',
        },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`Hyperliquid HTTP ${resp.status}`);
      const data = await resp.json();
      const normalized = normalizeHyperliquidMarkets(data).slice(0, 25);
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

  async getCandles24h(symbol) {
    const coin = String(symbol || 'BTC').replace(/-PERP$/i, '').toUpperCase();
    const now = Date.now();
    const existing = this.candleCache.get(coin);
    if (existing && now - existing.fetchedAt < 60000) {
      return existing;
    }

    try {
      const startTime = now - 24 * 60 * 60 * 1000;
      const resp = await fetch(HL_INFO_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'GlanceDesk-EvenG2/2.0',
        },
        body: JSON.stringify({
          type: 'candleSnapshot',
          req: { coin, interval: '1h', startTime, endTime: now },
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`Hyperliquid candles HTTP ${resp.status}`);
      const raw = await resp.json();
      const closes = (Array.isArray(raw) ? raw : [])
        .map((c) => Number(c.c))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (closes.length >= 2) {
        const entry = {
          symbol: coin,
          fetchedAt: now,
          closes,
          high: Math.max(...closes),
          low: Math.min(...closes),
        };
        this.candleCache.set(coin, entry);
        return entry;
      }
    } catch {
      // Fallback to cached or null
    }
    return existing || { symbol: coin, fetchedAt: 0, closes: [], high: 0, low: 0 };
  }
}
