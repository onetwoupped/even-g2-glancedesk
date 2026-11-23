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
  notionalUsd: number;
  entryPrice: number;
  sizeQty: number;
  markPx: number;
  unrealizedPnlUsd: number;
  pctPnl: number;
  markValueUsd: number;
  createdAt: string;
}

export interface PortfolioSnapshot {
  mode: 'PAPER_ONLY';
  cashUsd: number;
  equityUsd: number;
  totalPnlUsd: number;
  openCount: number;
  positions: PaperPosition[];
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

export async function fetchBackendState(refresh = false): Promise<BackendState> {
  return requestJson<BackendState>(`/api/state${refresh ? '?refresh=1' : ''}`);
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
  notionalUsd: number;
  price: number;
  notifyTelegram?: boolean;
}): Promise<{ ok: boolean; portfolio: PortfolioSnapshot; receiptSent: boolean }> {
  return requestJson('/api/paper/order', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function sendVoiceReply(params: {
  pcmBase64: string;
  fallbackText: string;
  chatId?: string;
  replyToMessageId?: number;
  sendToTelegram?: boolean;
}): Promise<{ ok: boolean; voice: { provider: string; durationMs: number; transcript: string } }> {
  return requestJson('/api/voice/reply', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
