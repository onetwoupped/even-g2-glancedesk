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
      realizedPnlUsd: 0,
      positions: [],
      closed: [],
      alerts: [],
      updatedAt: new Date().toISOString(),
    };
    this.load();
  }

  load() {
    if (!this.storagePath || !fs.existsSync(this.storagePath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (raw && typeof raw.cashUsd === 'number' && Array.isArray(raw.positions)) {
        this.state = {
          mode: 'PAPER_ONLY',
          startingBalanceUsd: raw.startingBalanceUsd ?? INITIAL_BALANCE_USD,
          cashUsd: raw.cashUsd,
          realizedPnlUsd: Number(raw.realizedPnlUsd ?? 0),
          positions: raw.positions,
          closed: Array.isArray(raw.closed) ? raw.closed : [],
          alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
          updatedAt: raw.updatedAt || new Date().toISOString(),
        };
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
      realizedPnlUsd: 0,
      positions: [],
      closed: [],
      alerts: [],
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
      symbol: String(symbol || marketId).replace(/-PERP$/i, '').toUpperCase(),
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

  closePosition(positionId, closePrice) {
    const idx = positionId
      ? this.state.positions.findIndex((p) => p.id === positionId)
      : 0;
    if (idx < 0 || idx >= this.state.positions.length) {
      throw new Error('No open paper position found to close');
    }
    const pos = this.state.positions[idx];
    const exitPx = Number(closePrice);
    if (!Number.isFinite(exitPx) || exitPx <= 0) {
      throw new Error('Close price must be positive');
    }

    const diff = pos.side === 'LONG' ? exitPx - pos.entryPrice : pos.entryPrice - exitPx;
    const realizedPnlUsd = Number((diff * pos.sizeQty).toFixed(2));
    const returnedCash = Math.max(0, Number((pos.notionalUsd + realizedPnlUsd).toFixed(2)));

    this.state.positions.splice(idx, 1);
    this.state.cashUsd = Number((this.state.cashUsd + returnedCash).toFixed(2));
    this.state.realizedPnlUsd = Number((this.state.realizedPnlUsd + realizedPnlUsd).toFixed(2));

    const closedRecord = {
      ...pos,
      exitPrice: exitPx,
      realizedPnlUsd,
      closedAt: new Date().toISOString(),
    };
    this.state.closed.unshift(closedRecord);
    this.state.closed = this.state.closed.slice(0, 25);
    this.save();
    return closedRecord;
  }

  addAlert({ symbol, targetPrice, currentPrice }) {
    const sym = String(symbol || '').replace(/-PERP$/i, '').toUpperCase();
    const target = Number(targetPrice);
    if (!sym || !Number.isFinite(target) || target <= 0) {
      throw new Error('Invalid alert parameters');
    }
    const direction = Number.isFinite(currentPrice) && target < currentPrice ? 'BELOW' : 'ABOVE';
    const alert = {
      id: `al_${crypto.randomBytes(3).toString('hex')}`,
      symbol: sym,
      direction,
      targetPrice: target,
      triggered: false,
      triggeredAt: null,
      createdAt: new Date().toISOString(),
    };
    this.state.alerts.unshift(alert);
    this.state.alerts = this.state.alerts.slice(0, 15);
    this.save();
    return alert;
  }

  evaluateAlerts(liveMarkets = []) {
    const bySym = new Map(liveMarkets.map((m) => [String(m.symbol).toUpperCase(), m]));
    const newlyTriggered = [];
    for (const al of this.state.alerts) {
      if (al.triggered) continue;
      const m = bySym.get(al.symbol);
      if (!m) continue;
      const hit =
        (al.direction === 'ABOVE' && m.markPx >= al.targetPrice) ||
        (al.direction === 'BELOW' && m.markPx <= al.targetPrice);
      if (hit) {
        al.triggered = true;
        al.triggeredAt = new Date().toISOString();
        al.triggeredPrice = m.markPx;
        newlyTriggered.push({ ...al, markPx: m.markPx });
      }
    }
    if (newlyTriggered.length > 0) this.save();
    return newlyTriggered;
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
      realizedPnlUsd: this.state.realizedPnlUsd,
      totalPnlUsd,
      openCount: positions.length,
      positions,
      alerts: this.state.alerts.filter((a) => !a.triggered),
      recentTriggeredAlerts: this.state.alerts.filter((a) => a.triggered).slice(0, 3),
      updatedAt: this.state.updatedAt,
    };
  }
}
