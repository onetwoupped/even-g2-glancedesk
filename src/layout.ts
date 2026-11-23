import type { CandleBar } from './api';

export const G2_WIDTH = 576;
export const G2_HEIGHT = 288;
export const MAX_TEXT_CONTAINERS = 8;
export const MAX_IMAGE_CONTAINERS = 4;
export const MAX_IMAGE_W = 288;
export const MAX_IMAGE_H = 144;
export const MAX_CONTAINER_NAME_LEN = 16;
export const MAX_CREATE_CHARS = 1000;

export interface G2TextContainerSpec {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  borderWidth: number;
  borderColor: number;
  borderRadius: number;
  paddingLength: number;
  textColor: number; // 0..4 hardware brightness
  isEventCapture: 0 | 1;
  content: string;
}

export interface G2ChartLevel {
  price: number;
  label: string;
  emphasized?: boolean;
}

export interface G2CandleChartSpec {
  symbol: string;
  interval: string;
  bars: CandleBar[];
  levels?: G2ChartLevel[];
}

export interface G2ImageContainerSpec {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  chart?: G2CandleChartSpec;
}

export interface G2PageSpec {
  view: 'GLANCE' | 'MANAGE' | 'TICKET_SL' | 'TICKET_TP' | 'TICKET_RISK' | 'TICKET_CONFIRM' | 'REPLY';
  containerTotalNum: number;
  textObject: G2TextContainerSpec[];
  imageObject?: G2ImageContainerSpec[];
}

export function truncate(text: string, maxLen: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

/**
 * Calibrated against real Even Hub G2 Simulator LVGL metrics:
 * - eyebrow & hint use height=34 so single-line LVGL text NEVER triggers right-edge scrollbar ticks.
 * - borderWidth=0 keeps ~75% of the lens pure black (= 100% transparent glass).
 * - chart container is 220x142 (inside 288x144 hardware limit), crisp 20-bar OHLC candlesticks.
 */
export function buildMinimalHudPage(params: {
  view: G2PageSpec['view'];
  eyebrow: string;
  main: string;
  hint: string;
  chart?: G2CandleChartSpec | null;
}): G2PageSpec {
  const hasChart = Boolean(params.chart && params.chart.bars.length >= 2);
  const mainWidth = hasChart ? 318 : 544;

  const textObject: G2TextContainerSpec[] = [
    {
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
      content: truncate(params.eyebrow, 46),
    },
    {
      containerID: 2,
      containerName: 'main',
      xPosition: 16,
      yPosition: 46,
      width: mainWidth,
      height: 196,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
      textColor: 4,
      isEventCapture: 1,
      content: String(params.main || '').slice(0, MAX_CREATE_CHARS),
    },
    {
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
      content: truncate(params.hint, 48),
    },
  ];

  const imageObject: G2ImageContainerSpec[] | undefined = hasChart
    ? [
        {
          containerID: 4,
          containerName: 'chart',
          xPosition: 344,
          yPosition: 52,
          width: 220,
          height: 142,
          chart: params.chart!,
        },
      ]
    : undefined;

  const page: G2PageSpec = {
    view: params.view,
    containerTotalNum: textObject.length + (imageObject?.length || 0),
    textObject,
    imageObject,
  };

  const check = validatePageSpec(page);
  if (!check.ok) {
    throw new Error(`Invalid G2 HUD layout (${params.view}): ${check.errors.join('; ')}`);
  }
  return page;
}

export function validatePageSpec(page: G2PageSpec): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const texts = page.textObject || [];
  const images = page.imageObject || [];
  if (texts.length === 0) errors.push('Page must contain at least 1 text container');
  if (texts.length > MAX_TEXT_CONTAINERS) errors.push(`Too many text containers (${texts.length})`);
  if (images.length > MAX_IMAGE_CONTAINERS) errors.push(`Too many image containers (${images.length})`);
  if (page.containerTotalNum !== texts.length + images.length) errors.push('containerTotalNum mismatch');

  let captureCount = 0;
  const ids = new Set<number>();
  const names = new Set<string>();

  for (const c of texts) {
    if (ids.has(c.containerID)) errors.push(`Duplicate containerID: ${c.containerID}`);
    ids.add(c.containerID);
    if (!c.containerName || c.containerName.length > MAX_CONTAINER_NAME_LEN) {
      errors.push(`Invalid containerName '${c.containerName}'`);
    }
    if (names.has(c.containerName)) errors.push(`Duplicate containerName: ${c.containerName}`);
    names.add(c.containerName);
    if (c.xPosition < 0 || c.yPosition < 0 || c.width <= 0 || c.height <= 0) errors.push('Invalid dimensions');
    if (c.xPosition + c.width > G2_WIDTH || c.yPosition + c.height > G2_HEIGHT) errors.push('Canvas overflow');
    if (c.borderWidth < 0 || c.borderWidth > 5) errors.push('borderWidth range error');
    if (c.borderColor < 0 || c.borderColor > 15) errors.push('borderColor range error');
    if (c.textColor < 0 || c.textColor > 4) errors.push('textColor must be 0..4');
    if (c.paddingLength < 0 || c.paddingLength > 32) errors.push('paddingLength error');
    if (c.content.length > MAX_CREATE_CHARS) errors.push('Content exceeds limit');
    if (c.isEventCapture === 1) captureCount += 1;
  }

  for (const img of images) {
    if (ids.has(img.containerID)) errors.push(`Duplicate containerID: ${img.containerID}`);
    ids.add(img.containerID);
    if (!img.containerName || img.containerName.length > MAX_CONTAINER_NAME_LEN) errors.push('Invalid image name');
    if (names.has(img.containerName)) errors.push(`Duplicate containerName: ${img.containerName}`);
    names.add(img.containerName);
    if (img.width > MAX_IMAGE_W || img.height > MAX_IMAGE_H) errors.push('Image exceeds 288x144');
    if (img.xPosition + img.width > G2_WIDTH || img.yPosition + img.height > G2_HEIGHT) errors.push('Image overflow');
  }

  if (captureCount !== 1) errors.push(`Exactly 1 container must set isEventCapture=1 (found ${captureCount})`);
  return { ok: errors.length === 0, errors };
}
