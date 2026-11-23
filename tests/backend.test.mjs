import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PaperLedger } from '../server/ledger.mjs';
import { matchMarketToText, normalizeHyperliquidMarkets } from '../server/hyperliquid.mjs';
import { buildSmartReplies } from '../server/telegram.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('app.json satisfies Even Hub manifest & QA rules', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  assert.match(manifest.package_id, /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/);
  assert.equal(manifest.entrypoint, 'index.html');
  assert.ok(Array.isArray(manifest.permissions) && manifest.permissions.length >= 2);
  const net = manifest.permissions.find((p) => p.name === 'network');
  assert.ok(net && Array.isArray(net.whitelist) && net.whitelist.length >= 1);
  for (const origin of net.whitelist) {
    assert.match(origin, /^https?:\/\/[^*]+$/);
  }
});

test('Hyperliquid normalizer and Telegram ticker matcher link relevant perps', () => {
  const metaAndCtxs = [
    { universe: [{ name: 'BTC', maxLeverage: 50 }, { name: 'SOL', maxLeverage: 20 }] },
    [
      { markPx: '61400', prevDayPx: '60000', funding: '0.0001', dayNtlVlm: '1500000000' },
      { markPx: '142.5', prevDayPx: '135.0', funding: '0.0002', dayNtlVlm: '420000000' },
    ],
  ];
  const markets = normalizeHyperliquidMarkets(metaAndCtxs);
  assert.equal(markets[0].symbol, 'BTC');
  assert.equal(markets[1].symbol, 'SOL');
  assert.ok(markets[1].change24hPct > 5);

  const matchedSol = matchMarketToText('Breaking: Solana funding flipped positive, SOL breakout!', markets);
  assert.equal(matchedSol.symbol, 'SOL');

  const matchedBtc = matchMarketToText('Bitcoin ETF inflows just spiked', markets);
  assert.equal(matchedBtc.symbol, 'BTC');
});

test('Smart replies adapt to linked Hyperliquid mark price', () => {
  const replies = buildSmartReplies('SOL long breakout right now?', { symbol: 'SOL', markPx: 142.5, change24hPct: 5.56 });
  assert.equal(replies.length, 3);
  assert.ok(replies[0].includes('SOL') && replies[0].includes('$142.50'));
});

test('PaperLedger tracks balance, perp size, guards, and live mark-to-market PnL', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glancedesk-'));
  const file = path.join(tmpDir, 'ledger.json');
  try {
    const ledger = new PaperLedger(file);
    const ord = ledger.placePaperOrder({
      marketId: 'SOL-PERP',
      symbol: 'SOL',
      side: 'LONG',
      notionalUsd: 250,
      price: 100,
    });
    assert.equal(ord.sizeQty, 2.5);

    // Mark moves 100 -> 110 => +$25 unrealized PnL on 2.5 SOL
    const snap = ledger.snapshot([{ symbol: 'SOL', markPx: 110 }]);
    assert.equal(snap.mode, 'PAPER_ONLY');
    assert.equal(snap.cashUsd, 9750);
    assert.equal(snap.equityUsd, 10025);
    assert.equal(snap.totalPnlUsd, 25);
    assert.equal(snap.positions[0].unrealizedPnlUsd, 25);

    assert.throws(() => {
      ledger.placePaperOrder({ marketId: 'SOL-PERP', symbol: 'SOL', side: 'LONG', notionalUsd: 5000, price: 100 });
    }, /between \$10 and \$2,500/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
