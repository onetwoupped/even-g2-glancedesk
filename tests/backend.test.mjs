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

test('Official Even Hub SDK validateEvenHubPageContainer approves v6 structure-first 3-step HUD layout', () => {
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
        content: '3/3 risk & execute · eth short',
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
        content: '› Risk -$242 -> +$608\nSize 18.47 ETH ($31.9k)\nSL $1,738.0 · TP $1,692.0\nReward 2.51R\nTap to execute paper',
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
        content: 'swipe $ risk · tap execute · dbl TP',
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
        new MenuItemProperty({ itemID: 3, itemName: 'Open Positions' }),
        new MenuItemProperty({ itemID: 4, itemName: 'Flip LONG/SHORT' }),
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

test('PaperLedger computes true 1R risk-based sizing ($242 / $850 exact risk), 1.5R BE, partial, and exact SL loss', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glancedesk-'));
  const file = path.join(tmpDir, 'ledger.json');
  try {
    const ledger = new PaperLedger(file);
    const pref = ledger.setRiskBudget(242);
    assert.equal(pref.defaultRiskUsd, 242);

    // True 1R risk sizing: SHORT NEAR @ $4.00, SL = $4.08 ($0.08 dist), TP = $3.80 ($0.20 dist)
    // Auto-sized qty = $242 / $0.08 = 3025 NEAR ($12,100 notional)
    // Exact loss at SL = -$242.00; exact profit at TP = +$605.00 (2.5R)
    const ord = ledger.placePaperOrder({
      marketId: 'NEAR-PERP',
      symbol: 'NEAR',
      side: 'SHORT',
      riskUsd: 242,
      price: 4.0,
      stopLoss: 4.08,
      takeProfit: 3.8,
    });
    assert.equal(ord.riskUsd, 242);
    assert.equal(ord.initialRiskUsd, 242);
    assert.equal(ord.sizeQty, 3025);
    assert.equal(ord.notionalUsd, 12100);
    assert.equal(ord.plannedProfitUsd, 605);
    assert.equal(ord.plannedRR, 2.5);

    // Reject invalid SL direction for SHORT (SL below entry)
    assert.throws(() => {
      ledger.placePaperOrder({
        marketId: 'NEAR-PERP',
        symbol: 'NEAR',
        side: 'SHORT',
        riskUsd: 242,
        price: 4.0,
        stopLoss: 3.9,
        takeProfit: 3.8,
      });
    }, /Stop Loss must be above entry/);

    // Price drops to $3.88 => +$363.00 PnL / $242.00 risk = +1.5R -> emits R_TARGET_1_5
    const triggers = ledger.evaluateTriggers([{ symbol: 'NEAR', markPx: 3.88 }]);
    assert.ok(triggers.some((e) => e.kind === 'R_TARGET_1_5'));

    // Move stop to Break-Even
    const bePos = ledger.moveStopToBreakEven(ord.id);
    assert.equal(bePos.stopLoss, 4.0);
    assert.equal(bePos.isBreakEven, true);

    // Take 50% profit at $3.88 (+$181.50 realized)
    const partial = ledger.takePartialProfit(ord.id, 0.5, 3.88);
    assert.equal(partial.realizedPnlUsd, 181.5);

    // Price bounces back to $4.00 BE -> closes remaining 50% at $0 extra loss
    const stopEv = ledger.evaluateTriggers([{ symbol: 'NEAR', markPx: 4.0 }]);
    assert.ok(stopEv.some((e) => e.kind === 'STOP_HIT' && e.closed.reason === 'BREAK_EVEN'));

    // Second trade: exact $850 risk on tight 0.5% ETH LONG stop -> hitting SL loses EXACTLY -$850.00
    ledger.setRiskBudget(850);
    const ethOrd = ledger.placePaperOrder({
      marketId: 'ETH-PERP',
      symbol: 'ETH',
      side: 'LONG',
      riskUsd: 850,
      price: 2000,
      stopLoss: 1990, // $10 stop distance => qty = 85 ETH ($170,000 notional, $3,400 margin @ 50x)
      takeProfit: 2030, // $30 target => +$2,550 (3R)
    });
    assert.equal(ethOrd.sizeQty, 85);
    assert.equal(ethOrd.plannedProfitUsd, 2550);
    assert.equal(ethOrd.plannedRR, 3);

    const slHit = ledger.evaluateTriggers([{ symbol: 'ETH', markPx: 1990 }]);
    assert.ok(slHit.some((e) => e.kind === 'STOP_HIT' && e.closed.reason === 'STOP_LOSS' && e.closed.realizedPnlUsd === -850));

    const finalSnap = ledger.snapshot([{ symbol: 'ETH', markPx: 1990 }]);
    assert.equal(finalSnap.openCount, 0);
    assert.equal(finalSnap.realizedPnlUsd, Number((181.5 - 850).toFixed(2)));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Multi-position isolation: closing ETH 100% leaves open BTC position completely intact', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glancedesk-multi-'));
  const file = path.join(tmpDir, 'ledger.json');
  try {
    const ledger = new PaperLedger(file);
    const eth = ledger.placePaperOrder({
      marketId: 'ETH-PERP',
      symbol: 'ETH',
      side: 'LONG',
      riskUsd: 100,
      price: 2000,
      stopLoss: 1980,
      takeProfit: 2060,
    });
    const btc = ledger.placePaperOrder({
      marketId: 'BTC-PERP',
      symbol: 'BTC',
      side: 'SHORT',
      riskUsd: 242,
      price: 60000,
      stopLoss: 60600,
      takeProfit: 58200,
    });
    assert.equal(ledger.snapshot([]).openCount, 2);

    // Closing ETH by positionId MUST only close ETH and keep BTC open
    ledger.closePosition(eth.id, 2020, 'MANUAL');
    const snap = ledger.snapshot([
      { symbol: 'ETH', markPx: 2020 },
      { symbol: 'BTC', markPx: 59700 },
    ]);
    assert.equal(snap.openCount, 1);
    assert.equal(snap.positions[0].id, btc.id);
    assert.equal(snap.positions[0].symbol, 'BTC');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('UX invariants in src/state.ts: no "Close all" ambiguity, no 50/100/200 preset carousel, coin locking present', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'state.ts'), 'utf8');
  assert.doesNotMatch(src, /Close all/i, 'Ambiguous "Close all" label must not exist');
  assert.doesNotMatch(src, /RISK_MULTIPLIERS/, 'Artificial 0.5R/1R/2R multiplier carousel must not exist');
  assert.match(src, /Close \$\{sym\} 100%/, 'Must explicitly name the coin being closed (Close <SYM> 100%)');
  assert.match(src, /lockedSymbol/, 'Must lock active coin context so unrelated open positions never hijack feed messages');
});
