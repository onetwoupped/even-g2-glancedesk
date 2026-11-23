/**
 * Renders a crisp 192x140 monochrome green 24h Hyperliquid price sparkline
 * both onto a browser <canvas> and as PNG bytes for Even G2 updateImageRawData.
 */
export function drawSparklineOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  symbol: string,
  closes: number[],
  change24hPct: number,
  monochromeGreen = true
): void {
  const fgHigh = monochromeGreen ? '#3dff8f' : '#ffffff';
  const fgMid = monochromeGreen ? '#1f9954' : '#999999';
  const fgLow = monochromeGreen ? '#104a29' : '#444444';

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, width, height);

  // Outer subtle border
  ctx.strokeStyle = fgMid;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  // Top label inside chart
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = fgHigh;
  const sign = change24hPct >= 0 ? '+' : '';
  ctx.fillText(`${symbol} 24H  ${sign}${change24hPct.toFixed(1)}%`, x + 8, y + 6);

  if (!closes || closes.length < 2) {
    ctx.fillStyle = fgMid;
    ctx.fillText('Loading candles...', x + 8, y + height / 2);
    ctx.restore();
    return;
  }

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;

  const padL = 8;
  const padR = 10;
  const padT = 26;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // Mid dashed reference line
  ctx.strokeStyle = fgLow;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x + padL, y + padT + plotH / 2);
  ctx.lineTo(x + padL + plotW, y + padT + plotH / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const pts = closes.map((val, i) => {
    const px = x + padL + (i / (closes.length - 1)) * plotW;
    const norm = (val - min) / span;
    const py = y + padT + (1 - norm) * plotH;
    return { px, py };
  });

  // Subtle shaded fill under sparkline
  ctx.beginPath();
  ctx.moveTo(pts[0].px, y + padT + plotH);
  for (const pt of pts) ctx.lineTo(pt.px, pt.py);
  ctx.lineTo(pts[pts.length - 1].px, y + padT + plotH);
  ctx.closePath();
  ctx.fillStyle = monochromeGreen ? 'rgba(61, 255, 143, 0.14)' : 'rgba(255, 255, 255, 0.16)';
  ctx.fill();

  // Crisp 2px price curve
  ctx.beginPath();
  ctx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
  ctx.strokeStyle = fgHigh;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Endpoint dot
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.px, last.py, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = fgHigh;
  ctx.fill();

  // Footer min/max labels
  const fmt = (v: number) => (v >= 1000 ? `${v.toFixed(0)}` : v >= 1 ? `${v.toFixed(2)}` : `${v.toFixed(4)}`);
  ctx.fillStyle = fgMid;
  ctx.fillText(`L:${fmt(min)}  H:${fmt(max)}`, x + 8, y + height - 17);
  ctx.restore();
}

export async function renderSparklinePngBytes(
  width: number,
  height: number,
  symbol: string,
  closes: number[],
  change24hPct: number
): Promise<Uint8Array> {
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const ctx = off.getContext('2d');
  if (!ctx) return new Uint8Array();
  // Pure greyscale for Even G2 4-bit hardware converter
  drawSparklineOnCanvas(ctx, 0, 0, width, height, symbol, closes, change24hPct, false);
  const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}
