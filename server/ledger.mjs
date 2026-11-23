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

  /**
   * Open a simulated perp position with explicit Stop Loss, Take Profit, and R-multiple tracking.
   * Default risk template: 1.5% SL distance, 2.0R TP target (3.0% move).
   */
  placePaperOrder({
    marketId,
    symbol,
    side,
    notionalUsd,
    price,
    slPct = 1.5,
    rrRatio = 2.0,
    stopLoss = null,
    takeProfit = null,
  }) {
    const cleanSide = String(side || '').toUpperCase();
    if (cleanSide !== 'LONG' && cleanSide !== 'SHORT') {
      throw new Error('Side must be LONG or SHORT');
    }
    const notional = Number(notionalUsd);
    const entry = Number(price);
    if (!Number.isFinite(notional) || notional < 10 || notional > 2500) {
      throw new Error('Paper notional must be between $10 and $2,500');
    }
    if (!Number.isFinite(entry) || entry <= 0) {
      throw new Error('Mark price must be positive');
    }
    if (notional > this.state.cashUsd) {
      throw new Error(`Insufficient paper balance ($${this.state.cashUsd.toFixed(2)} available)`);
    }

    const slFrac = Math.max(0.2, Math.min(20, Number(slPct))) / 100;
    const rr = Math.max(0.5, Math.min(10, Number(rrRatio)));

    const computedSl =
      stopLoss && Number(stopLoss) > 0
        ? Number(stopLoss)
        : cleanSide === 'LONG'
          ? entry * (1 - slFrac)
          : entry * (1 + slFrac);

    const riskPerUnit = Math.max(entry * 0.001, Math.abs(entry - computedSl));
    const computedTp =
      takeProfit && Number(takeProfit) > 0
        ? Number(takeProfit)
        : cleanSide === 'LONG'
          ? entry + riskPerUnit * rr
          : Math.max(entry * 0.01, entry - riskPerUnit * rr);

    const sizeQty = Number((notional / entry).toFixed(6));
    const initialRiskUsd = Number((riskPerUnit * sizeQty).toFixed(2));

    const order = {
      id: `hlp_${crypto.randomBytes(4).toString('hex')}`,
      marketId: String(marketId || `${symbol}-PERP`),
      symbol: String(symbol || marketId).replace(/-PERP$/i, '').toUpperCase(),
      side: cleanSide,
      notionalUsd: Number(notional.toFixed(2)),
      entryPrice: entry,
      stopLoss: Number(computedSl.toFixed(6)),
      takeProfit: Number(computedTp.toFixed(6)),
      initialRiskUsd: Math.max(0.5, initialRiskUsd),
      isBreakEven: false,
      rAlertTriggered: false,
      sizeQty,
      createdAt: new Date().toISOString(),
    };

    this.state.cashUsd = Number((this.state.cashUsd - order.notionalUsd).toFixed(2));
    this.state.positions.unshift(order);
    this.save();
    return order;
  }

  moveStopToBreakEven(positionId) {
    const idx = positionId ? this.state.positions.findIndex((p) => p.id === positionId) : 0;
    if (idx < 0 || idx >= this.state.positions.length) {
      throw new Error('No open position found');
    }
    const pos = this.state.positions[idx];
    pos.stopLoss = pos.entryPrice;
    pos.isBreakEven = true;
    this.save();
    return { ...pos };
  }

  takePartialProfit(positionId, ratio = 0.5, markPrice) {
    const idx = positionId ? this.state.positions.findIndex((p) => p.id === positionId) : 0;
    if (idx < 0 || idx >= this.state.positions.length) {
      throw new Error('No open position found');
    }
    const pos = this.state.positions[idx];
    const exitPx = Number(markPrice);
    if (!Number.isFinite(exitPx) || exitPx <= 0) throw new Error('Invalid mark price');

    const frac = Math.max(0.1, Math.min(0.9, Number(ratio)));
    const closeQty = Number((pos.sizeQty * frac).toFixed(6));
    const closeNotional = Number((pos.notionalUsd * frac).toFixed(2));
    const diff = pos.side === 'LONG' ? exitPx - pos.entryPrice : pos.entryPrice - exitPx;
    const realizedPnlUsd = Number((diff * closeQty).toFixed(2));

    pos.sizeQty = Number((pos.sizeQty - closeQty).toFixed(6));
    pos.notionalUsd = Number((pos.notionalUsd - closeNotional).toFixed(2));
    this.state.cashUsd = Number((this.state.cashUsd + Math.max(0, closeNotional + realizedPnlUsd)).toFixed(2));
    this.state.realizedPnlUsd = Number((this.state.realizedPnlUsd + realizedPnlUsd).toFixed(2));
    this.save();

    return {
      positionId: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      closedRatio: frac,
      exitPrice: exitPx,
      realizedPnlUsd,
      remainingNotionalUsd: pos.notionalUsd,
    };
  }

  closePosition(positionId, closePrice, reason = 'MANUAL') {
    const idx = positionId ? this.state.positions.findIndex((p) => p.id === positionId) : 0;
    if (idx < 0 || idx >= this.state.positions.length) {
      throw new Error('No open paper position found to close');
    }
    const pos = this.state.positions[idx];
    const exitPx = Number(closePrice);
    if (!Number.isFinite(exitPx) || exitPx <= 0) throw new Error('Close price must be positive');

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
      reason,
      closedAt: new Date().toISOString(),
    };
    this.state.closed.unshift(closedRecord);
    this.state.closed = this.state.closed.slice(0, 25);
    this.save();
    return closedRecord;
  }

  addAlert({ symbol, targetPrice, currentPrice, note = '' }) {
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
      note: String(note || '').trim(),
      triggered: false,
      dismissed: false,
      triggeredAt: null,
      createdAt: new Date().toISOString(),
    };
    this.state.alerts.unshift(alert);
    this.state.alerts = this.state.alerts.slice(0, 15);
    this.save();
    return alert;
  }

  dismissAlert(alertId) {
    const al = this.state.alerts.find((a) => a.id === alertId);
    if (al) {
      al.dismissed = true;
      this.save();
    }
  }

  evaluateTriggers(liveMarkets = []) {
    const bySym = new Map(liveMarkets.map((m) => [String(m.symbol).toUpperCase(), m]));
    const events = [];

    // 1. Price alerts
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
        events.push({ kind: 'PRICE_ALERT', alert: { ...al }, markPx: m.markPx });
      }
    }

    // 2. Position SL / TP / +1.5R Break-Even trigger
    for (const pos of [...this.state.positions]) {
      const m = bySym.get(pos.symbol);
      if (!m) continue;
      const px = m.markPx;
      const hitSl = pos.stopLoss && (pos.side === 'LONG' ? px <= pos.stopLoss : px >= pos.stopLoss);
      const hitTp = pos.takeProfit && (pos.side === 'LONG' ? px >= pos.takeProfit : px <= pos.takeProfit);

      if (hitSl) {
        const closed = this.closePosition(pos.id, px, pos.isBreakEven ? 'BREAK_EVEN' : 'STOP_LOSS');
        events.push({ kind: 'STOP_HIT', closed });
        continue;
      }
      if (hitTp) {
        const closed = this.closePosition(pos.id, px, 'TAKE_PROFIT');
        events.push({ kind: 'TP_HIT', closed });
        continue;
      }

      const diff = pos.side === 'LONG' ? px - pos.entryPrice : pos.entryPrice - px;
      const pnl = diff * pos.sizeQty;
      const rMultiple = pos.initialRiskUsd > 0 ? pnl / pos.initialRiskUsd : 0;
      if (rMultiple >= 1.5 && !pos.isBreakEven && !pos.rAlertTriggered) {
        pos.rAlertTriggered = true;
        events.push({
          kind: 'R_TARGET_1_5',
          positionId: pos.id,
          symbol: pos.symbol,
          side: pos.side,
          rMultiple: Number(rMultiple.toFixed(2)),
          markPx: px,
          entryPrice: pos.entryPrice,
        });
      }
    }

    if (events.length > 0) this.save();
    return events;
  }

  snapshot(liveMarkets = []) {
    const bySym = new Map(liveMarkets.map((m) => [String(m.symbol).toUpperCase(), m]));
    let totalMarkValue = 0;

    const positions = this.state.positions.map((pos) => {
      const m = bySym.get(String(pos.symbol).toUpperCase());
      const markPx = m ? m.markPx : pos.entryPrice;
      const diff = pos.side === 'LONG' ? markPx - pos.entryPrice : pos.entryPrice - markPx;
      const unrealizedPnlUsd = Number((diff * pos.sizeQty).toFixed(2));
      const risk = Number(pos.initialRiskUsd || Math.max(1, pos.notionalUsd * 0.015));
      const currentR = Number((unrealizedPnlUsd / risk).toFixed(2));
      const pctPnl = Number(((unrealizedPnlUsd / pos.notionalUsd) * 100).toFixed(2));
      const markValueUsd = Number((pos.notionalUsd + unrealizedPnlUsd).toFixed(2));
      totalMarkValue += markValueUsd;

      return {
        ...pos,
        markPx,
        unrealizedPnlUsd,
        currentR,
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
      activeTriggeredAlerts: this.state.alerts.filter((a) => a.triggered && !a.dismissed).slice(0, 3),
      updatedAt: this.state.updatedAt,
    };
  }
}
