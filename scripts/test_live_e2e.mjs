import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TelegramService, buildSmartReplies, formatPrice } from '../server/telegram.mjs';
import { HyperliquidClient, matchMarketToText } from '../server/hyperliquid.mjs';
import { PaperLedger } from '../server/ledger.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const env = {};
for (const raw of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#') || !line.includes('=')) continue;
  const eq = line.indexOf('=');
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
}

const runtimeDir = path.join(root, 'server', '.runtime');
const tg = new TelegramService({
  token: env.TELEGRAM_BOT_TOKEN || '',
  storagePath: path.join(runtimeDir, 'telegram_cache.json'),
});
const hl = new HyperliquidClient(1000);
const ledger = new PaperLedger(path.join(runtimeDir, 'ledger.json'));

await tg.verifyBot();
const tgState = await tg.pollUpdates();
const hlState = await hl.getMarkets(true);

const latestIn = tgState.messages.find((m) => m.direction === 'IN') || tgState.messages[0];
if (!latestIn || !tgState.activeChatId) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        reason: 'No group message received yet via getUpdates',
        bot: tg.botInfo?.username,
        activeChatId: tgState.activeChatId,
        hint: 'If Group Privacy is ON in BotFather, either ensure bot is Admin or send a message mentioning @sezirneonbot or run /setprivacy -> Disable in @BotFather.',
      },
      null,
      2
    )
  );
  process.exit(0);
}

const matched = matchMarketToText(latestIn.text, hlState.markets);
const smartReplies = buildSmartReplies(latestIn.text, matched);

// 1. Send real smart reply back to Telegram
const sentReply = await tg.sendMessage({
  chatId: latestIn.chatId,
  text: `[G2] ${smartReplies[0]}`,
  replyToMessageId: latestIn.messageId,
});

// 2. Execute simulated paper order at live Hyperliquid mark price + send Telegram receipt
const order = ledger.placePaperOrder({
  marketId: matched.id,
  symbol: matched.symbol,
  side: 'LONG',
  notionalUsd: 250,
  price: matched.markPx,
});

const sentReceipt = await tg.sendMessage({
  chatId: latestIn.chatId,
  text:
    `[GlanceDesk G2 · HYPERLIQUID PAPER]\n` +
    `Perp: ${order.symbol}-PERP\n` +
    `Action: ${order.side} $${order.notionalUsd} @ ${formatPrice(order.entryPrice)} (${order.sizeQty} ${order.symbol})\n` +
    `Simulated paper execution only — no real funds.`,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      received_telegram_message: {
        chatId: latestIn.chatId,
        chatTitle: latestIn.chatTitle,
        sender: latestIn.sender,
        text: latestIn.text,
      },
      matched_hyperliquid_perp: {
        id: matched.id,
        markPx: matched.markPx,
        change24hPct: matched.change24hPct,
      },
      sent_smart_reply: sentReply.text,
      paper_order: order,
      sent_receipt_msg_id: sentReceipt.messageId,
      portfolio: ledger.snapshot(hlState.markets),
    },
    null,
    2
  )
);
