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

test('Official Even Hub SDK validateEvenHubPageContainer approves borderless v3 AR HUD layout', () => {
  const result = validateEvenHubPageContainer({
    textObject: [
      new TextContainerProperty({
        containerID: 1,
        containerName: 'eyebrow',
        xPosition: 16,
        yPosition: 12,
        width: 544,
        height: 26,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        textColor: 1,
        isEventCapture: 0,
        content: '1.5R reached · sol short',
      }),
      new TextContainerProperty({
        containerID: 2,
        containerName: 'main',
        xPosition: 16,
        yPosition: 48,
        width: 348,
        height: 196,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        textColor: 4,
        isEventCapture: 1,
        content: 'SOL SHORT   +1.52R\n$70.75 (in $72.40)\n\n› Move stop to BE ($72.40)',
      }),
      new TextContainerProperty({
        containerID: 3,
        containerName: 'hint',
        xPosition: 16,
        yPosition: 254,
        width: 544,
        height: 24,
        borderWidth: 0,
        borderColor: 0,
        borderRadius: 0,
        paddingLength: 0,
        textColor: 1,
        isEventCapture: 0,
        content: 'swipe pick · tap act · dbl exit',
      }),
    ],
    imageObject: [
      new ImageContainerProperty({
        containerID: 4,
        containerName: 'chart',
        xPosition: 374,
        yPosition: 56,
        width: 186,
        height: 126,
      }),
    ],
    menuObject: new MenuContainerProperty({
      menuItems: [
        new MenuItemProperty({ itemID: 1, itemName: 'Glance' }),
        new MenuItemProperty({ itemID: 2, itemName: 'Manage Position' }),
        new MenuItemProperty({ itemID: 3, itemName: 'New Setup' }),
        new MenuItemProperty({ itemID: 4, itemName: 'Refresh Live' }),
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

test('PaperLedger enforces R-multiple 1.5R trigger, Move-to-BE, 50% partial, and SL/TP execution', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glancedesk-'));
  const file = path.join(tmpDir, 'ledger.json');
  try {
    const ledger = new PaperLedger(file);
    // Open SHORT NEAR @ $4.00 with 2% SL ($4.08) and 2R TP ($3.84)
    const ord = ledger.placePaperOrder({
      marketId: 'NEAR-PERP',
      symbol: 'NEAR',
      side: 'SHORT',
      notionalUsd: 400,
      price: 4.0,
      slPct: 2.0,
      rrRatio: 2.0,
    });
    assert.equal(ord.stopLoss, 4.08);
    assert.equal(ord.takeProfit, 3.84);
    assert.equal(ord.initialRiskUsd, 8);

    // Price drops to $3.88 => +1.5R (+$12 / $8 risk) -> MUST emit R_TARGET_1_5 trigger
    const triggers = ledger.evaluateTriggers([{ symbol: 'NEAR', markPx: 3.88 }]);
    assert.ok(triggers.some((e) => e.kind === 'R_TARGET_1_5'));

    // 1-tap Move Stop to Break-Even
    const bePos = ledger.moveStopToBreakEven(ord.id);
    assert.equal(bePos.stopLoss, 4.0);
    assert.equal(bePos.isBreakEven, true);

    // 1-tap Take 50% profit at $3.88 (+$6 realized)
    const partial = ledger.takePartialProfit(ord.id, 0.5, 3.88);
    assert.equal(partial.realizedPnlUsd, 6);

    // If price bounces back to $4.00 BE stop -> auto closes remaining 50% at $0 extra loss (BREAK_EVEN)
    const stopEv = ledger.evaluateTriggers([{ symbol: 'NEAR', markPx: 4.0 }]);
    assert.ok(stopEv.some((e) => e.kind === 'STOP_HIT' && e.closed.reason === 'BREAK_EVEN'));
    const finalSnap = ledger.snapshot([{ symbol: 'NEAR', markPx: 4.0 }]);
    assert.equal(finalSnap.openCount, 0);
    assert.equal(finalSnap.realizedPnlUsd, 6);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
