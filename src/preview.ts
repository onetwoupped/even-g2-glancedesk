import { drawCandlestickChart } from './candles';
import { G2_HEIGHT, G2_WIDTH, type G2PageSpec } from './layout';

function textBrightness4ToGreen(level: number): string {
  const map = [55, 110, 165, 215, 255];
  const g = map[Math.max(0, Math.min(4, Math.round(level)))];
  return `rgb(${Math.round(g * 0.16)}, ${g}, ${Math.round(g * 0.4)})`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) {
      out.push('');
      continue;
    }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function drawG2Preview(canvas: HTMLCanvasElement, page: G2PageSpec): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  canvas.width = G2_WIDTH;
  canvas.height = G2_HEIGHT;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, G2_WIDTH, G2_HEIGHT);
  ctx.textBaseline = 'top';

  for (const c of page.textObject) {
    ctx.font =
      c.containerName === 'eyebrow' || c.containerName === 'hint'
        ? '13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
        : '16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

    ctx.save();
    ctx.beginPath();
    ctx.rect(c.xPosition, c.yPosition, c.width, c.height);
    ctx.clip();

    ctx.fillStyle = textBrightness4ToGreen(c.textColor);
    const lines = wrapText(ctx, c.content, Math.max(20, c.width));
    let y = c.yPosition;
    const step = c.containerName === 'main' ? 24 : 18;
    for (const ln of lines) {
      if (y > c.yPosition + c.height - 6) break;
      ctx.fillText(ln, c.xPosition, y);
      y += step;
    }
    ctx.restore();
  }

  for (const img of page.imageObject || []) {
    if (img.chart) {
      drawCandlestickChart(ctx, img.xPosition, img.yPosition, img.width, img.height, img.chart, true);
    }
  }
}
