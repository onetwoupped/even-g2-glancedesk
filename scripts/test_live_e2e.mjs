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
  defaultChatId: env.TELEGRAM_DEFAULT_CHAT_ID || '',
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
        hint: 'Add your bot to a Telegram group as Admin (or disable Group Privacy in @BotFather) and send a message mentioning a coin like ETH or BTC.',
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
  text: smartReplies[0],
  replyToMessageId: latestIn.messageId,
});

// 2. Execute risk-sized simulated paper order (1% risk, 0.75% SL, 2.25% TP => 3.0R)
const entry = matched.markPx;
const stopLoss = Number((entry * 0.9925).toFixed(4));
const takeProfit = Number((entry * 1.0225).toFixed(4));
const order = ledger.placePaperOrder({
  marketId: matched.id,
  symbol: matched.symbol,
  side: 'LONG',
  riskUsd: 100,
  price: entry,
  stopLoss,
  takeProfit,
  idempotencyKey: `e2e_${Date.now()}`,
});

const sentReceipt = await tg.sendMessage({
  chatId: latestIn.chatId,
  text:
    `Paper ${order.side} ${order.symbol} @ ${formatPrice(order.entryPrice)}\n` +
    `Auto-sized: ${order.sizeQty.toFixed(3)} ${order.symbol} ($${order.notionalUsd.toFixed(0)} notional)\n` +
    `SL ${formatPrice(order.stopLoss)} (-$${order.riskUsd.toFixed(2)}) · TP ${formatPrice(order.takeProfit)} (+$${order.plannedProfitUsd.toFixed(2)} · ${order.plannedRR}R)`,
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
