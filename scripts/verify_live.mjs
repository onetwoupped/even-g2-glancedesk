import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramService } from '../server/telegram.mjs';
import { HyperliquidClient, matchMarketToText } from '../server/hyperliquid.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
}

const tg = new TelegramService({
  token: env.TELEGRAM_BOT_TOKEN || '',
  storagePath: path.resolve(__dirname, '..', 'server', '.runtime', 'telegram_cache.json'),
});
const hl = new HyperliquidClient(1000);

const bot = await tg.verifyBot();
const updates = await tg.pollUpdates();
const marketsRes = await hl.getMarkets(true);
const sampleMatch = matchMarketToText('Solana SOL breakout incoming!', marketsRes.markets);

console.log(
  JSON.stringify(
    {
      telegram_bot: bot ? { id: bot.id, username: bot.username } : null,
      telegram_error: tg.lastError,
      telegram_active_chat: updates.activeChatId ? { chatId: updates.activeChatId, title: updates.activeChatTitle } : null,
      telegram_messages_count: updates.messages.length,
      hyperliquid_live_count: marketsRes.markets.length,
      hyperliquid_error: marketsRes.lastError,
      top_3_perps: marketsRes.markets.slice(0, 3).map((m) => ({
        id: m.id,
        markPx: m.markPx,
        change24hPct: `${m.change24hPct}%`,
        fundingHourlyPct: `${m.fundingHourlyPct}%`,
      })),
      sample_match: sampleMatch ? { id: sampleMatch.id, markPx: sampleMatch.markPx, change24hPct: sampleMatch.change24hPct } : null,
    },
    null,
    2
  )
);
