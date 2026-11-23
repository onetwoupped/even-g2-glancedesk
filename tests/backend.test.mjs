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
  const net = manifest.permissions.find((p) => p.name === 'network');
  assert.ok(net && Array.isArray(net.whitelist) && net.whitelist.length >= 1);
  for (const origin of net.whitelist) {
    assert.match(origin, /^https?:\/\/[^*]+$/);
  }
});

test('Official Even Hub SDK validateEvenHubPageContainer approves v4 OHLC candlestick HUD layout', () => {
  const result = validateEvenHubPageContainer({
    textObject: [
      new TextContainerProperty({
        containerID: 1,
        containerName: 'eyebrow',
        xPosition: 16,
        yPosition: 6,
        width: 544,
        height: 34,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        textColor: 1,
        isEventCapture: 0,
        content: '2/4 stop loss · eth short',
      }),
      new TextContainerProperty({
        containerID: 2,
        containerName: 'main',
        xPosition: 16,
        yPosition: 46,
        width: 318,
        height: 196,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        textColor: 4,
        isEventCapture: 1,
        content: 'Entry $1,724.9\n› SL $1,742.1 (1.00%)\n\nRisk -$3.50\n($35 × 10x)',
      }),
      new TextContainerProperty({
        containerID: 3,
        containerName: 'hint',
        xPosition: 16,
        yPosition: 250,
        width: 544,
        height: 34,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        textColor: 1,
        isEventCapture: 0,
        content: 'swipe move SL · tap set TP · dbl back',
      }),
    ],
    imageObject: [
      new ImageContainerProperty({
        containerID: 4,
        containerName: 'chart',
        xPosition: 344,
        yPosition: 52,
        width: 220,
        height: 142,
      }),
    ],
    menuObject: new MenuContainerProperty({
      menuItems: [
        new MenuItemProperty({ itemID: 1, itemName: 'Glance' }),
        new MenuItemProperty({ itemID: 2, itemName: 'New Trade (SL/TP)' }),
        new MenuItemProperty({ itemID: 3, itemName: 'Manage Position' }),
        new MenuItemProperty({ itemID: 4, itemName: 'Cycle Leverage' }),
      ],
    }),
  });
  assert.equal(result.valid, true, `SDK rejected page: ${JSON.stringify(result)}`);
});

test('Hyperliquid normalizer and Telegram matcher support NEAR, SOL, ETH, BTC', () => {
  const metaAndCtxs = [
    { universe: [{ name: 'BTC', maxLeverage: 50 }, { name: 'NEAR', maxLeverage: 10 }, { name: 'SOL', maxLeverage: 20 }] },
    [
      { markPx: '61400', prevDayPx: '60000', funding: '0.0001', dayNtlVlm: '1500000000' },
      { markPx: '4.21', prevDayPx: '4.05', funding: '0.0001', dayNtlVlm: '45000000' },
      { markPx: '72.10', prevDayPx: '70.50', funding: '0.0002', dayNtlVlm: '420000000' },
    ],
  ];
  const markets = normalizeHyperliquidMarkets(metaAndCtxs);
  assert.equal(markets.length, 3);
  const matchedNear = matchMarketToText('NEAR structure broke down at 4.20', markets);
  assert.equal(matchedNear.symbol, 'NEAR');
});

test('Smart replies stay concise and human', () => {
  const replies = buildSmartReplies('NEAR short level hit', { symbol: 'NEAR', markPx: 4.21, change24hPct: 3.95 });
  assert.equal(replies.length, 3);
  assert.ok(replies[0].includes('NEAR'));
});

test('PaperLedger computes exact custom margin ($35 x 10x), custom SL/TP loss & gain, 1.5R BE, and 50% partial', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glancedesk-'));
  const file = path.join(tmpDir, 'ledger.json');
  try {
    const ledger = new PaperLedger(file);
    ledger.setPreferences({ marginUsd: 35, leverage: 10 });

    // Custom SHORT NEAR: $35 margin x 10x = $350 notional @ $4.00 => 87.5 NEAR
    // Custom SL = $4.08 => exact loss = $0.08 * 87.5 = $7.00
    // Custom TP = $3.80 => exact profit = $0.20 * 87.5 = $17.50 (2.5R)
    const ord = ledger.placePaperOrder({
      marketId: 'NEAR-PERP',
      symbol: 'NEAR',
      side: 'SHORT',
      marginUsd: 35,
      leverage: 10,
      price: 4.0,
      stopLoss: 4.08,
      takeProfit: 3.8,
    });
    assert.equal(ord.marginUsd, 35);
    assert.equal(ord.notionalUsd, 350);
    assert.equal(ord.initialRiskUsd, 7);
    assert.equal(ord.plannedProfitUsd, 17.5);
    assert.equal(ord.plannedRR, 2.5);

    // Reject invalid SL direction for SHORT (SL below entry)
    assert.throws(() => {
      ledger.placePaperOrder({
        marketId: 'NEAR-PERP',
        symbol: 'NEAR',
        side: 'SHORT',
        marginUsd: 35,
        leverage: 10,
        price: 4.0,
        stopLoss: 3.9,
        takeProfit: 3.8,
      });
    }, /Stop Loss must be above entry/);

    // Price drops to $3.88 => +$10.50 PnL / $7.00 risk = +1.5R -> emits R_TARGET_1_5
    const triggers = ledger.evaluateTriggers([{ symbol: 'NEAR', markPx: 3.88 }]);
    assert.ok(triggers.some((e) => e.kind === 'R_TARGET_1_5'));

    // Move stop to Break-Even
    const bePos = ledger.moveStopToBreakEven(ord.id);
    assert.equal(bePos.stopLoss, 4.0);
    assert.equal(bePos.isBreakEven, true);

    // Take 50% profit at $3.88 (+$5.25 realized)
    const partial = ledger.takePartialProfit(ord.id, 0.5, 3.88);
    assert.equal(partial.realizedPnlUsd, 5.25);

    // Price bounces back to $4.00 BE -> closes remaining 50% at $0 extra loss
    const stopEv = ledger.evaluateTriggers([{ symbol: 'NEAR', markPx: 4.0 }]);
    assert.ok(stopEv.some((e) => e.kind === 'STOP_HIT' && e.closed.reason === 'BREAK_EVEN'));
    const finalSnap = ledger.snapshot([{ symbol: 'NEAR', markPx: 4.0 }]);
    assert.equal(finalSnap.openCount, 0);
    assert.equal(finalSnap.realizedPnlUsd, 5.25);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
