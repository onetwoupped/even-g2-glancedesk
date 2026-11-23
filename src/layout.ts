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

export interface G2SparklineSpec {
  symbol: string;
  interval: string;
  closes: number[];
  change24hPct: number;
  refLevel?: number; // Entry price, alert level, or SL level
  refLabel?: string;
}

export interface G2ImageContainerSpec {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  sparkline?: G2SparklineSpec;
}

export interface G2PageSpec {
  view: 'GLANCE' | 'MANAGE' | 'ENTRY' | 'REPLY' | 'VOICE';
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
 * Borderless AR HUD layout:
 * - Black = 100% transparent glass on Even G2 waveguide optics.
 * - Zero box borders (borderWidth: 0) so the user's real-world vision stays open.
 * - Calm brightness hierarchy: 4 (focus), 2 (secondary), 1 (whisper metadata).
 */
export function buildMinimalHudPage(params: {
  view: G2PageSpec['view'];
  eyebrow: string;
  main: string;
  hint: string;
  sparkline?: G2SparklineSpec | null;
}): G2PageSpec {
  const hasChart = Boolean(params.sparkline && params.sparkline.closes.length >= 2);
  const mainWidth = hasChart ? 348 : 544;

  const textObject: G2TextContainerSpec[] = [
    {
      containerID: 1,
      containerName: 'eyebrow',
      xPosition: 16,
      yPosition: 12,
      width: 544,
      height: 26,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
      textColor: 1,
      isEventCapture: 0,
      content: truncate(params.eyebrow, 64),
    },
    {
      containerID: 2,
      containerName: 'main',
      xPosition: 16,
      yPosition: 48,
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
      yPosition: 254,
      width: 544,
      height: 24,
      borderWidth: 0,
      borderColor: 0,
      borderRadius: 0,
      paddingLength: 0,
      textColor: 1,
      isEventCapture: 0,
      content: truncate(params.hint, 80),
    },
  ];

  const imageObject: G2ImageContainerSpec[] | undefined = hasChart
    ? [
        {
          containerID: 4,
          containerName: 'chart',
          xPosition: 374,
          yPosition: 56,
          width: 186,
          height: 126,
          sparkline: params.sparkline!,
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
