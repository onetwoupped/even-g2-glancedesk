import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const INITIAL_BALANCE_USD = 10000.0;

export class PaperLedger {
  constructor(storagePath) {
    this.storagePath = storagePath;
    this.state = {
      mode: 'PAPER_ONLY',
      startingBalanceUsd: INITIAL_BALANCE_USD,
      cashUsd: INITIAL_BALANCE_USD,
      positions: [],
      updatedAt: new Date().toISOString(),
    };
    this.load();
  }

  load() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (raw && typeof raw.cashUsd === 'number' && Array.isArray(raw.positions)) {
        this.state = raw;
      }
    } catch {
      // Keep clean default state
    }
  }

  save() {
    if (!this.storagePath) return;
    fs.mkdirSync(path.dirname(this.storagePath), { recursive: true });
    this.state.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2), 'utf8');
  }

  reset() {
    this.state = {
      mode: 'PAPER_ONLY',
      startingBalanceUsd: INITIAL_BALANCE_USD,
      cashUsd: INITIAL_BALANCE_USD,
      positions: [],
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.snapshot([]);
  }

  placePaperOrder({ marketId, symbol, side, notionalUsd, price }) {
    const cleanSide = String(side || '').toUpperCase();
    if (cleanSide !== 'LONG' && cleanSide !== 'SHORT') {
      throw new Error('Side must be LONG or SHORT');
    }
    const notional = Number(notionalUsd);
    const fillPrice = Number(price);
    if (!Number.isFinite(notional) || notional < 10 || notional > 2500) {
      throw new Error('Paper notional must be between $10 and $2,500');
    }
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      throw new Error('Mark price must be positive');
    }
    if (notional > this.state.cashUsd) {
      throw new Error(`Insufficient paper balance ($${this.state.cashUsd.toFixed(2)} available)`);
    }

    const sizeQty = Number((notional / fillPrice).toFixed(6));
    const order = {
      id: `hlp_${crypto.randomBytes(4).toString('hex')}`,
      marketId: String(marketId || `${symbol}-PERP`),
      symbol: String(symbol || marketId).replace(/-PERP$/i, ''),
      side: cleanSide,
      notionalUsd: Number(notional.toFixed(2)),
      entryPrice: fillPrice,
      sizeQty,
      createdAt: new Date().toISOString(),
    };

    this.state.cashUsd = Number((this.state.cashUsd - order.notionalUsd).toFixed(2));
    this.state.positions.unshift(order);
    this.save();
    return order;
  }

  snapshot(liveMarkets = []) {
    const bySym = new Map(liveMarkets.map((m) => [String(m.symbol).toUpperCase(), m]));
    let totalMarkValue = 0;

    const positions = this.state.positions.map((pos) => {
      const m = bySym.get(String(pos.symbol).toUpperCase());
      const markPx = m ? m.markPx : pos.entryPrice;
      const diff = pos.side === 'LONG' ? markPx - pos.entryPrice : pos.entryPrice - markPx;
      const unrealizedPnlUsd = Number((diff * pos.sizeQty).toFixed(2));
      const pctPnl = Number(((unrealizedPnlUsd / pos.notionalUsd) * 100).toFixed(2));
      const markValueUsd = Number((pos.notionalUsd + unrealizedPnlUsd).toFixed(2));
      totalMarkValue += markValueUsd;

      return {
        ...pos,
        markPx,
        unrealizedPnlUsd,
        pctPnl,
        markValueUsd,
      };
    });

    const equityUsd = Number((this.state.cashUsd + totalMarkValue).toFixed(2));
    const totalPnlUsd = Number((equityUsd - this.state.startingBalanceUsd).toFixed(2));

    return {
      mode: 'PAPER_ONLY',
      cashUsd: this.state.cashUsd,
      equityUsd,
      totalPnlUsd,
      openCount: positions.length,
      positions,
      updatedAt: this.state.updatedAt,
    };
  }
}
