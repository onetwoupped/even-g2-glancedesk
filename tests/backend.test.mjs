import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ImageContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  TextContainerProperty,
  validateEvenHubPageContainer,
} from '@evenrealities/even_hub_sdk';

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

test('Official Even Hub SDK validateEvenHubPageContainer approves GlanceDesk text + sparkline image + menu layout', () => {
  const result = validateEvenHubPageContainer({
    textObject: [
      new TextContainerProperty({
        containerID: 1,
        containerName: 'hdr',
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 40,
        borderWidth: 1,
        borderColor: 10,
        borderRadius: 4,
        paddingLength: 6,
        textColor: 4,
        isEventCapture: 0,
        content: 'TG [1/1] @oneupped · 1m',
      }),
      new TextContainerProperty({
        containerID: 2,
        containerName: 'main',
        xPosition: 0,
        yPosition: 46,
        width: 372,
        height: 178,
        borderWidth: 1,
        borderColor: 6,
        borderRadius: 4,
        paddingLength: 10,
        textColor: 4,
        isEventCapture: 1,
        content: 'SOL breakout incoming\n\nSOL-PERP $72.13 (+2.05%)',
      }),
      new TextContainerProperty({
        containerID: 3,
        containerName: 'act',
        xPosition: 0,
        yPosition: 230,
        width: 576,
        height: 58,
        borderWidth: 1,
        borderColor: 6,
        borderRadius: 4,
        paddingLength: 6,
        textColor: 2,
        isEventCapture: 0,
        content: 'TAP: Reply/Trade · SWIPE: Next · DBL: Exit',
      }),
    ],
    imageObject: [
      new ImageContainerProperty({
        containerID: 4,
        containerName: 'chart',
        xPosition: 380,
        yPosition: 64,
        width: 192,
        height: 140,
      }),
    ],
    menuObject: new MenuContainerProperty({
      menuItems: [
        new MenuItemProperty({ itemID: 1, itemName: 'Feed' }),
        new MenuItemProperty({ itemID: 2, itemName: 'Paper Order' }),
        new MenuItemProperty({ itemID: 3, itemName: 'Portfolio' }),
        new MenuItemProperty({ itemID: 4, itemName: 'Refresh Live' }),
      ],
    }),
  });
  assert.equal(result.valid, true, `SDK rejected page: ${JSON.stringify(result)}`);
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

test('PaperLedger tracks open, close, realized PnL, and price alerts', () => {
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

    const snap = ledger.snapshot([{ symbol: 'SOL', markPx: 110 }]);
    assert.equal(snap.cashUsd, 9750);
    assert.equal(snap.equityUsd, 10025);
    assert.equal(snap.totalPnlUsd, 25);

    // Close position at 112 => +$30 realized PnL
    const closed = ledger.closePosition(ord.id, 112);
    assert.equal(closed.realizedPnlUsd, 30);
    const afterClose = ledger.snapshot([{ symbol: 'SOL', markPx: 112 }]);
    assert.equal(afterClose.openCount, 0);
    assert.equal(afterClose.cashUsd, 10030);
    assert.equal(afterClose.realizedPnlUsd, 30);

    // Price alert trigger check
    ledger.addAlert({ symbol: 'SOL', targetPrice: 115, currentPrice: 112 });
    assert.equal(ledger.evaluateAlerts([{ symbol: 'SOL', markPx: 114 }]).length, 0);
    const hits = ledger.evaluateAlerts([{ symbol: 'SOL', markPx: 116 }]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].direction, 'ABOVE');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
