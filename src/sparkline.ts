import type { G2SparklineSpec } from './layout';

/**
 * Borderless floating AR structure curve for Even G2 waveguide glass.
 * Black pixels remain 100% transparent on real glasses; no noisy box borders.
 */
export function drawSparklineOnCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  spec: G2SparklineSpec,
  monochromeGreen = true
): void {
  const fgBright = monochromeGreen ? '#42ff96' : '#ffffff';
  const fgSoft = monochromeGreen ? '#1e8a4c' : '#888888';
  const fgRef = monochromeGreen ? '#29b866' : '#aaaaaa';

  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, width, height);

  if (!spec.closes || spec.closes.length < 2) {
    ctx.restore();
    return;
  }

  const allVals = spec.refLevel ? [...spec.closes, spec.refLevel] : spec.closes;
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const span = max - min || 1;

  const padL = 4;
  const padR = 8;
  const padT = 18;
  const padB = 18;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const toY = (v: number) => y + padT + (1 - (v - min) / span) * plotH;

  // Quiet top timeframe caption (no border box)
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  ctx.fillStyle = fgSoft;
  ctx.fillText(`${spec.symbol} · ${spec.interval}`, x + padL, y + 2);

  // Horizontal dotted reference level (entry, alert, or stop)
  if (spec.refLevel && Number.isFinite(spec.refLevel)) {
    const ry = toY(spec.refLevel);
    ctx.strokeStyle = fgRef;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x + padL, ry);
    ctx.lineTo(x + padL + plotW, ry);
    ctx.stroke();
    ctx.setLineDash([]);
    if (spec.refLabel) {
      ctx.fillStyle = fgSoft;
      const lblW = ctx.measureText(spec.refLabel).width;
      const lblY = ry < y + padT + plotH / 2 ? ry + 4 : Math.max(y + 16, ry - 13);
      ctx.fillText(spec.refLabel, x + padL + plotW - lblW, lblY);
    }
  }

  // Clean 2px floating price structure curve (no heavy background fill)
  const pts = spec.closes.map((val, i) => ({
    px: x + padL + (i / (spec.closes.length - 1)) * plotW,
    py: toY(val),
  }));

  ctx.beginPath();
  ctx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
  ctx.strokeStyle = fgBright;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Live price dot
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last.px, last.py, 3.2, 0, Math.PI * 2);
  ctx.fillStyle = fgBright;
  ctx.fill();

  // Minimal low / high range at bottom
  const fmt = (v: number) => (v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
  ctx.fillStyle = fgSoft;
  ctx.fillText(`${fmt(min)} — ${fmt(max)}`, x + padL, y + height - 13);
  ctx.restore();
}

export async function renderSparklinePngBytes(
  width: number,
  height: number,
  spec: G2SparklineSpec
): Promise<Uint8Array> {
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const ctx = off.getContext('2d');
  if (!ctx) return new Uint8Array();
  drawSparklineOnCanvas(ctx, 0, 0, width, height, spec, false);
  const blob = await new Promise<Blob | null>((resolve) => off.toBlob(resolve, 'image/png'));
  if (!blob) return new Uint8Array();
  return new Uint8Array(await blob.arrayBuffer());
}
