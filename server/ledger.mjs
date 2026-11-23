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
      defaultRiskUsd: 100, // 1R dollar risk budget (user sets any exact $ via /risk or companion)
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
          defaultRiskUsd: Number(raw.defaultRiskUsd ?? 100),
          positions: raw.positions,
          closed: Array.isArray(raw.closed) ? raw.closed : [],
          alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
          updatedAt: raw.updatedAt || new Date().toISOString(),
        };
      }
    } catch {
      // Keep clean defaults
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
      defaultRiskUsd: 100,
      positions: [],
      closed: [],
      alerts: [],
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this.snapshot([]);
  }

  setRiskBudget(riskUsd) {
    const r = Number(riskUsd);
    if (!Number.isFinite(r) || r < 1 || r > 50000) {
      throw new Error('1R risk must be between $1 and $50,000');
    }
    this.state.defaultRiskUsd = Number(r.toFixed(2));
    this.save();
    return { defaultRiskUsd: this.state.defaultRiskUsd };
  }

  /**
   * True Risk-Based Position Sizing (1R Sizing):
   * User picks exact $ risk (e.g. $100, $242, $850), exact SL, and exact TP.
   * Position size automatically solves:
   *   sizeQty = riskUsd / |entry - stopLoss|
   *   notionalUsd = sizeQty * entry
   *   plannedProfitUsd = |takeProfit - entry| * sizeQty
   * Hitting SL loses EXACTLY riskUsd.
   */
  placePaperOrder({ marketId, symbol, side, riskUsd, price, stopLoss, takeProfit }) {
    const cleanSide = String(side || '').toUpperCase();
    if (cleanSide !== 'LONG' && cleanSide !== 'SHORT') {
      throw new Error('Side must be LONG or SHORT');
    }
    const entry = Number(price);
    if (!Number.isFinite(entry) || entry <= 0) throw new Error('Mark price must be positive');

    const risk = Number(riskUsd ?? this.state.defaultRiskUsd);
    if (!Number.isFinite(risk) || risk < 1 || risk > 50000) {
      throw new Error('Risk amount must be between $1 and $50,000');
    }

    const slPx = Number(stopLoss);
    const tpPx = Number(takeProfit);
    if (!Number.isFinite(slPx) || slPx <= 0) throw new Error('Valid Stop Loss price required');
    if (!Number.isFinite(tpPx) || tpPx <= 0) throw new Error('Valid Take Profit price required');

    if (cleanSide === 'LONG' && (slPx >= entry || tpPx <= entry)) {
      throw new Error('For LONG: Stop Loss must be below entry and Take Profit above entry');
    }
    if (cleanSide === 'SHORT' && (slPx <= entry || tpPx >= entry)) {
      throw new Error('For SHORT: Stop Loss must be above entry and Take Profit below entry');
    }

    const slDist = Math.abs(entry - slPx);
    const tpDist = Math.abs(tpPx - entry);
    const sizeQty = Number((risk / slDist).toFixed(6));
    const notionalUsd = Number((sizeQty * entry).toFixed(2));
    // Simulated isolated margin reserved (up to 50x Hyperliquid perp leverage, at least riskUsd)
    const marginUsd = Number(Math.max(risk, notionalUsd / 50).toFixed(2));
    if (marginUsd > this.state.cashUsd) {
      throw new Error(`Insufficient paper balance ($${this.state.cashUsd.toFixed(0)} available, need $${marginUsd.toFixed(0)} margin)`);
    }

    const plannedProfitUsd = Number((tpDist * sizeQty).toFixed(2));
    const plannedRR = Number((tpDist / slDist).toFixed(2));

    const order = {
      id: `hlp_${crypto.randomBytes(4).toString('hex')}`,
      marketId: String(marketId || `${symbol}-PERP`),
      symbol: String(symbol || marketId).replace(/-PERP$/i, '').toUpperCase(),
      side: cleanSide,
      riskUsd: Number(risk.toFixed(2)),
      marginUsd,
      notionalUsd,
      entryPrice: entry,
      stopLoss: Number(slPx.toFixed(6)),
      takeProfit: Number(tpPx.toFixed(6)),
      initialRiskUsd: Number(risk.toFixed(2)),
      plannedProfitUsd,
      plannedRR,
      isBreakEven: false,
      rAlertTriggered: false,
      sizeQty,
      createdAt: new Date().toISOString(),
    };

    this.state.cashUsd = Number((this.state.cashUsd - order.marginUsd).toFixed(2));
    this.state.positions.unshift(order);
    this.save();
    return order;
  }

  moveStopToBreakEven(positionId) {
    const idx = positionId ? this.state.positions.findIndex((p) => p.id === positionId) : 0;
    if (idx < 0 || idx >= this.state.positions.length) throw new Error('No open position found');
    const pos = this.state.positions[idx];
    pos.stopLoss = pos.entryPrice;
    pos.isBreakEven = true;
    this.save();
    return { ...pos };
  }

  takePartialProfit(positionId, ratio = 0.5, markPrice) {
    const idx = positionId ? this.state.positions.findIndex((p) => p.id === positionId) : 0;
    if (idx < 0 || idx >= this.state.positions.length) throw new Error('No open position found');
    const pos = this.state.positions[idx];
    const exitPx = Number(markPrice);
    if (!Number.isFinite(exitPx) || exitPx <= 0) throw new Error('Invalid mark price');

    const frac = Math.max(0.1, Math.min(0.9, Number(ratio)));
    const closeQty = Number((pos.sizeQty * frac).toFixed(6));
    const closeMargin = Number(((pos.marginUsd ?? pos.notionalUsd) * frac).toFixed(2));
    const closeNotional = Number((pos.notionalUsd * frac).toFixed(2));
    const diff = pos.side === 'LONG' ? exitPx - pos.entryPrice : pos.entryPrice - exitPx;
    const realizedPnlUsd = Number((diff * closeQty).toFixed(2));

    pos.sizeQty = Number((pos.sizeQty - closeQty).toFixed(6));
    pos.marginUsd = Number(((pos.marginUsd ?? pos.notionalUsd) - closeMargin).toFixed(2));
    pos.notionalUsd = Number((pos.notionalUsd - closeNotional).toFixed(2));
    this.state.cashUsd = Number((this.state.cashUsd + Math.max(0, closeMargin + realizedPnlUsd)).toFixed(2));
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
    if (idx < 0 || idx >= this.state.positions.length) throw new Error('No open paper position found to close');
    const pos = this.state.positions[idx];
    const exitPx = Number(closePrice);
    if (!Number.isFinite(exitPx) || exitPx <= 0) throw new Error('Close price must be positive');

    const diff = pos.side === 'LONG' ? exitPx - pos.entryPrice : pos.entryPrice - exitPx;
    const realizedPnlUsd = Number((diff * pos.sizeQty).toFixed(2));
    const marginBack = pos.marginUsd ?? pos.notionalUsd;
    const returnedCash = Math.max(0, Number((marginBack + realizedPnlUsd).toFixed(2)));

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
    if (!sym || !Number.isFinite(target) || target <= 0) throw new Error('Invalid alert parameters');
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
    let totalMarginEquity = 0;

    const positions = this.state.positions.map((pos) => {
      const m = bySym.get(String(pos.symbol).toUpperCase());
      const markPx = m ? m.markPx : pos.entryPrice;
      const diff = pos.side === 'LONG' ? markPx - pos.entryPrice : pos.entryPrice - markPx;
      const unrealizedPnlUsd = Number((diff * pos.sizeQty).toFixed(2));
      const margin = pos.marginUsd ?? pos.notionalUsd;
      const risk = Number(pos.initialRiskUsd || pos.riskUsd || 100);
      const currentR = Number((unrealizedPnlUsd / risk).toFixed(2));
      const markValueUsd = Number((margin + unrealizedPnlUsd).toFixed(2));
      totalMarginEquity += markValueUsd;

      return {
        ...pos,
        riskUsd: risk,
        marginUsd: margin,
        markPx,
        unrealizedPnlUsd,
        currentR,
        markValueUsd,
      };
    });

    const equityUsd = Number((this.state.cashUsd + totalMarginEquity).toFixed(2));
    const totalPnlUsd = Number((equityUsd - this.state.startingBalanceUsd).toFixed(2));

    return {
      mode: 'PAPER_ONLY',
      cashUsd: this.state.cashUsd,
      equityUsd,
      realizedPnlUsd: this.state.realizedPnlUsd,
      totalPnlUsd,
      defaultRiskUsd: this.state.defaultRiskUsd,
      openCount: positions.length,
      positions,
      alerts: this.state.alerts.filter((a) => !a.triggered),
      activeTriggeredAlerts: this.state.alerts.filter((a) => a.triggered && !a.dismissed).slice(0, 3),
      updatedAt: this.state.updatedAt,
    };
  }
}
