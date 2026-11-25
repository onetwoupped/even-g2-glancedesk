export interface MarketItem {
  id: string;
  symbol: string;
  markPx: number;
  prevDayPx: number;
  change24hPct: number;
  fundingHourlyPct: number;
  volume24hUsd: number;
  maxLeverage: number;
}

export interface CandleBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface CandleSeries {
  symbol: string;
  interval: string;
  fetchedAt: number;
  bars: CandleBar[];
  high: number;
  low: number;
}

export interface FeedMessage {
  id: string;
  messageId: number;
  chatId: string;
  chatTitle: string;
  sender: string;
  text: string;
  timestamp: number;
  direction: 'IN' | 'OUT';
  linkedMarket: MarketItem | null;
  smartReplies: string[];
}

export interface PaperPosition {
  id: string;
  marketId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  riskUsd: number;
  marginUsd: number;
  notionalUsd: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  initialRiskUsd: number;
  plannedProfitUsd?: number;
  plannedRR?: number;
  isBreakEven: boolean;
  sizeQty: number;
  markPx: number;
  unrealizedPnlUsd: number;
  currentR: number;
  markValueUsd: number;
  createdAt: string;
}

export interface PriceAlert {
  id: string;
  symbol: string;
  direction: 'ABOVE' | 'BELOW';
  targetPrice: number;
  note?: string;
  triggered: boolean;
  dismissed?: boolean;
  triggeredPrice?: number;
}

export interface PortfolioSnapshot {
  mode: 'PAPER_ONLY';
  cashUsd: number;
  equityUsd: number;
  realizedPnlUsd: number;
  totalPnlUsd: number;
  defaultRiskUsd: number;
  maxRiskPct: number;
  openCount: number;
  positions: PaperPosition[];
  alerts: PriceAlert[];
  activeTriggeredAlerts: PriceAlert[];
  updatedAt: string;
}

export interface BackendState {
  ok: boolean;
  telegram: {
    connected: boolean;
    botUsername: string;
    activeChatId: string | null;
    activeChatTitle: string | null;
    lastError: string | null;
  };
  markets: MarketItem[];
  feed: FeedMessage[];
  candles: CandleSeries;
  portfolio: PortfolioSnapshot;
  updatedAt: string;
}

const DEFAULT_API_BASE = 'http://127.0.0.1:8787';

export function getApiBase(): string {
  const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE;
  return (fromEnv || DEFAULT_API_BASE).replace(/\/+$/, '');
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = await resp.json();
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data as T;
}

export async function fetchBackendState(refresh = false, interval = '15m'): Promise<BackendState> {
  const q = new URLSearchParams();
  if (refresh) q.set('refresh', '1');
  if (interval) q.set('interval', interval);
  return requestJson<BackendState>(`/api/state?${q.toString()}`);
}

export async function fetchCandles(symbol: string, interval = '15m'): Promise<CandleSeries> {
  const res = await requestJson<{ ok: boolean; candles: CandleSeries }>(
    `/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`
  );
  return res.candles;
}

export async function saveRiskBudget(riskUsd: number): Promise<{
  ok: boolean;
  portfolio: PortfolioSnapshot;
}> {
  return requestJson('/api/prefs', {
    method: 'POST',
    body: JSON.stringify({ riskUsd }),
  });
}

export async function sendTelegramReply(params: {
  chatId?: string;
  text: string;
  replyToMessageId?: number;
}): Promise<{ ok: boolean }> {
  return requestJson('/api/telegram/reply', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function placePaperOrder(params: {
  marketId: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  riskUsd: number;
  price: number;
  stopLoss: number;
  takeProfit: number;
  idempotencyKey?: string;
  notifyTelegram?: boolean;
}): Promise<{ ok: boolean; portfolio: PortfolioSnapshot; receiptSent: boolean }> {
  return requestJson('/api/paper/order', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function moveStopToBE(
  positionId?: string,
  idempotencyKey?: string
): Promise<{
  ok: boolean;
  position: PaperPosition;
  portfolio: PortfolioSnapshot;
}> {
  return requestJson('/api/paper/be', {
    method: 'POST',
    body: JSON.stringify({ positionId, idempotencyKey, notifyTelegram: true }),
  });
}

export async function takePartialProfit(
  positionId?: string,
  ratio = 0.5,
  idempotencyKey?: string
): Promise<{
  ok: boolean;
  partial: { symbol: string; realizedPnlUsd: number };
  portfolio: PortfolioSnapshot;
}> {
  return requestJson('/api/paper/partial', {
    method: 'POST',
    body: JSON.stringify({ positionId, ratio, idempotencyKey, notifyTelegram: true }),
  });
}

export async function closePaperPosition(params: {
  positionId?: string;
  idempotencyKey?: string;
  notifyTelegram?: boolean;
}): Promise<{
  ok: boolean;
  closed: { symbol: string; side: string; realizedPnlUsd: number; exitPrice: number };
  portfolio: PortfolioSnapshot;
}> {
  return requestJson('/api/paper/close', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function dismissAlert(alertId: string): Promise<{ ok: boolean; portfolio: PortfolioSnapshot }> {
  return requestJson('/api/alerts/dismiss', {
    method: 'POST',
    body: JSON.stringify({ alertId }),
  });
}
