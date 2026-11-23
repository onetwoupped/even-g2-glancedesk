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
  borderColor: number; // 0..15 greyscale
  borderRadius: number;
  paddingLength: number;
  textColor: number; // Official SDK 0.0.14+ range: 0..4 brightness
  isEventCapture: 0 | 1;
  content: string;
}

export interface G2ImageContainerSpec {
  containerID: number;
  containerName: string;
  xPosition: number;
  yPosition: number;
  width: number;
  height: number;
  sparkline?: {
    symbol: string;
    closes: number[];
    change24hPct: number;
  };
}

export interface G2PageSpec {
  view: 'FEED' | 'REPLY' | 'ORDER' | 'PORT' | 'VOICE';
  containerTotalNum: number;
  textObject: G2TextContainerSpec[];
  imageObject?: G2ImageContainerSpec[];
}

export function truncate(text: string, maxLen: number): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

export function buildThreeZonePage(params: {
  view: G2PageSpec['view'];
  header: string;
  body: string;
  footer: string;
  sparkline?: { symbol: string; closes: number[]; change24hPct: number } | null;
}): G2PageSpec {
  const hasChart = Boolean(params.sparkline && params.sparkline.closes.length >= 2);
  const mainWidth = hasChart ? 372 : G2_WIDTH;

  const textObject: G2TextContainerSpec[] = [
    {
      containerID: 1,
      containerName: 'hdr',
      xPosition: 0,
      yPosition: 0,
      width: G2_WIDTH,
      height: 40,
      borderWidth: 1,
      borderColor: 10,
      borderRadius: 4,
      paddingLength: 6,
      textColor: 4,
      isEventCapture: 0,
      content: truncate(params.header, 68),
    },
    {
      containerID: 2,
      containerName: 'main',
      xPosition: 0,
      yPosition: 46,
      width: mainWidth,
      height: 178,
      borderWidth: 1,
      borderColor: 6,
      borderRadius: 4,
      paddingLength: 10,
      textColor: 4,
      isEventCapture: 1,
      content: String(params.body || '').slice(0, MAX_CREATE_CHARS),
    },
    {
      containerID: 3,
      containerName: 'act',
      xPosition: 0,
      yPosition: 230,
      width: G2_WIDTH,
      height: 58,
      borderWidth: 1,
      borderColor: 6,
      borderRadius: 4,
      paddingLength: 6,
      textColor: 2,
      isEventCapture: 0,
      content: truncate(params.footer, 100),
    },
  ];

  const imageObject: G2ImageContainerSpec[] | undefined = hasChart
    ? [
        {
          containerID: 4,
          containerName: 'chart',
          xPosition: 380,
          yPosition: 64,
          width: 192,
          height: 140,
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
    throw new Error(`Invalid G2 layout (${params.view}): ${check.errors.join('; ')}`);
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
  if (page.containerTotalNum !== texts.length + images.length) {
    errors.push(`containerTotalNum mismatch`);
  }

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

    if (c.xPosition < 0 || c.yPosition < 0 || c.width <= 0 || c.height <= 0) {
      errors.push(`Invalid dimensions on ${c.containerName}`);
    }
    if (c.xPosition + c.width > G2_WIDTH || c.yPosition + c.height > G2_HEIGHT) {
      errors.push(`Overflow on ${c.containerName}`);
    }
    if (c.borderWidth < 0 || c.borderWidth > 5) errors.push(`borderWidth range error on ${c.containerName}`);
    if (c.borderColor < 0 || c.borderColor > 15) errors.push(`borderColor range error on ${c.containerName}`);
    if (c.textColor < 0 || c.textColor > 4) errors.push(`textColor must be 0..4 on ${c.containerName}`);
    if (c.paddingLength < 0 || c.paddingLength > 32) errors.push(`paddingLength error on ${c.containerName}`);
    if (c.content.length > MAX_CREATE_CHARS) errors.push(`Content > ${MAX_CREATE_CHARS} on ${c.containerName}`);
    if (c.isEventCapture === 1) captureCount += 1;
  }

  for (const img of images) {
    if (ids.has(img.containerID)) errors.push(`Duplicate containerID: ${img.containerID}`);
    ids.add(img.containerID);
    if (!img.containerName || img.containerName.length > MAX_CONTAINER_NAME_LEN) {
      errors.push(`Invalid image containerName '${img.containerName}'`);
    }
    if (names.has(img.containerName)) errors.push(`Duplicate containerName: ${img.containerName}`);
    names.add(img.containerName);
    if (img.width > MAX_IMAGE_W || img.height > MAX_IMAGE_H) {
      errors.push(`Image container exceeds 288x144 hardware cap on ${img.containerName}`);
    }
    if (img.xPosition + img.width > G2_WIDTH || img.yPosition + img.height > G2_HEIGHT) {
      errors.push(`Image overflow on ${img.containerName}`);
    }
  }

  if (captureCount !== 1) errors.push(`Exactly 1 container must set isEventCapture=1 (found ${captureCount})`);
  return { ok: errors.length === 0, errors };
}
