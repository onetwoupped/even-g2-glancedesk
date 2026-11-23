import type { G2CandleChartSpec } from './layout';

/**
 * Monochrome OHLC Candlestick renderer for Even G2 4-bit waveguide optics.
 * - Bullish candle (close >= open): hollow bright outline + high/low wick.
 * - Bearish candle (close < open): solid filled mid-bright body + high/low wick.
 * - Live moving horizontal SL / TP / Entry / Alert lines drawn directly across the wicks.
 */
export function drawCandlestickChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  spec: G2CandleChartSpec,
  monochromeGreen = true
): void {
  const fgBright = monochromeGreen ? '#45ff98' : '#ffffff';
  const fgBear = monochromeGreen ? '#25a85e' : '#a8a8a8';
  const fgSoft = monochromeGreen ? '#1b7a44' : '#707070';

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, width, height);

  const bars = (spec.bars || []).slice(-18);
  if (bars.length < 2) {
    ctx.restore();
    return;
  }

  const levels = (spec.levels || []).filter((lv) => Number.isFinite(lv.price) && lv.price > 0);
  const allHighs = [...bars.map((b) => b.h), ...levels.map((lv) => lv.price)];
  const allLows = [...bars.map((b) => b.l), ...levels.map((lv) => lv.price)];
  const rawMax = Math.max(...allHighs);
  const rawMin = Math.min(...allLows);
  const padVal = (rawMax - rawMin || rawMax * 0.01) * 0.08;
  const max = rawMax + padVal;
  const min = rawMin - padVal;
  const span = max - min || 1;

  const padL = 4;
  const padR = 34; // Clean right margin for SL / TP tags so labels NEVER collide with candles
  const padT = 18;
  const padB = 16;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const toY = (v: number) => Math.round(y + padT + (1 - (v - min) / span) * plotH);

  // Quiet top title
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = fgSoft;
  ctx.fillText(`${spec.symbol} · ${spec.interval}`, x + padL, y + 2);

  // Draw OHLC candlesticks
  const slotW = plotW / bars.length;
  const bodyW = Math.max(4, Math.min(7, Math.floor(slotW - 3)));

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const cx = Math.round(x + padL + i * slotW + slotW / 2);
    const yHigh = toY(b.h);
    const yLow = toY(b.l);
    const yOpen = toY(b.o);
    const yClose = toY(b.c);
    const top = Math.min(yOpen, yClose);
    const bot = Math.max(yOpen, yClose);
    const bodyH = Math.max(2, bot - top);
    const bullish = b.c >= b.o;

    // Wick
    ctx.strokeStyle = bullish ? fgBright : fgBear;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, yHigh);
    ctx.lineTo(cx + 0.5, yLow);
    ctx.stroke();

    // Body
    const bx = Math.round(cx - bodyW / 2);
    if (bullish) {
      // Hollow bright green candle (classic monochrome bullish)
      ctx.fillStyle = '#000000';
      ctx.fillRect(bx, top, bodyW, bodyH);
      ctx.strokeStyle = fgBright;
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, top + 0.5, bodyW - 1, Math.max(1, bodyH - 1));
    } else {
      // Solid filled candle (classic monochrome bearish)
      ctx.fillStyle = fgBear;
      ctx.fillRect(bx, top, bodyW, bodyH);
    }
  }

  // Draw horizontal SL / TP / Entry / Alert lines + right-margin tags
  for (const lv of levels) {
    const ly = toY(lv.price);
    ctx.save();
    ctx.strokeStyle = lv.emphasized ? fgBright : fgSoft;
    ctx.lineWidth = lv.emphasized ? 1.5 : 1;
    ctx.setLineDash(lv.emphasized ? [5, 3] : [2, 4]);
    ctx.beginPath();
    ctx.moveTo(x + padL, ly + 0.5);
    ctx.lineTo(x + padL + plotW, ly + 0.5);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = lv.emphasized ? fgBright : fgSoft;
    ctx.fillText(lv.label, x + padL + plotW + 3, Math.max(y + 14, Math.min(y + height - 24, ly - 5)));
  }

  // Minimal low — high range
  const fmt = (v: number) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
  ctx.fillStyle = fgSoft;
  ctx.fillText(`${fmt(rawMin)} — ${fmt(rawMax)}`, x + padL, y + height - 12);
  ctx.restore();
}

export async function renderCandlestickPngBytes(
  width: number,
  height: number,
  spec: G2CandleChartSpec
): Promise<Uint8Array> {
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const ctx = off.getContext('2d');
  if (!ctx) return new Uint8Array();
  drawCandlestickChart(ctx, 0, 0, width, height, spec, false);
  const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}
