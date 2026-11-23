export const G2_WIDTH = 576;
export const G2_HEIGHT = 288;
export const MAX_TEXT_CONTAINERS = 8;
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
  textColor: number;
  isEventCapture: 0 | 1;
  content: string;
}

export interface G2PageSpec {
  view: 'FEED' | 'REPLY' | 'ORDER' | 'PORT' | 'VOICE';
  containerTotalNum: number;
  textObject: G2TextContainerSpec[];
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
}): G2PageSpec {
  const page: G2PageSpec = {
    view: params.view,
    containerTotalNum: 3,
    textObject: [
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
        textColor: 15,
        isEventCapture: 0,
        content: truncate(params.header, 72),
      },
      {
        containerID: 2,
        containerName: 'main',
        xPosition: 0,
        yPosition: 46,
        width: G2_WIDTH,
        height: 178,
        borderWidth: 1,
        borderColor: 6,
        borderRadius: 4,
        paddingLength: 10,
        textColor: 15,
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
        borderColor: 8,
        borderRadius: 4,
        paddingLength: 6,
        textColor: 12,
        isEventCapture: 0,
        content: truncate(params.footer, 110),
      },
    ],
  };

  const check = validatePageSpec(page);
  if (!check.ok) {
    throw new Error(`Invalid G2 layout (${params.view}): ${check.errors.join('; ')}`);
  }
  return page;
}

export function validatePageSpec(page: G2PageSpec): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const list = page.textObject || [];
  if (list.length === 0) errors.push('Page must contain at least 1 container');
  if (list.length > MAX_TEXT_CONTAINERS) {
    errors.push(`Too many text containers (${list.length} > ${MAX_TEXT_CONTAINERS})`);
  }
  if (page.containerTotalNum !== list.length) {
    errors.push(`containerTotalNum (${page.containerTotalNum}) !== actual (${list.length})`);
  }

  let captureCount = 0;
  const ids = new Set<number>();
  const names = new Set<string>();

  for (const c of list) {
    if (ids.has(c.containerID)) errors.push(`Duplicate containerID: ${c.containerID}`);
    ids.add(c.containerID);

    if (!c.containerName || c.containerName.length > MAX_CONTAINER_NAME_LEN) {
      errors.push(`Invalid containerName '${c.containerName}' (1..${MAX_CONTAINER_NAME_LEN} chars)`);
    }
    if (names.has(c.containerName)) errors.push(`Duplicate containerName: ${c.containerName}`);
    names.add(c.containerName);

    if (c.xPosition < 0 || c.yPosition < 0 || c.width <= 0 || c.height <= 0) {
      errors.push(`Negative/zero dimensions on ${c.containerName}`);
    }
    if (c.xPosition + c.width > G2_WIDTH) {
      errors.push(`Width overflow on ${c.containerName}: ${c.xPosition + c.width} > ${G2_WIDTH}`);
    }
    if (c.yPosition + c.height > G2_HEIGHT) {
      errors.push(`Height overflow on ${c.containerName}: ${c.yPosition + c.height} > ${G2_HEIGHT}`);
    }
    if (c.borderWidth < 0 || c.borderWidth > 5) {
      errors.push(`borderWidth out of range on ${c.containerName}`);
    }
    if (c.borderColor < 0 || c.borderColor > 15) {
      errors.push(`borderColor out of range on ${c.containerName}`);
    }
    if (c.paddingLength < 0 || c.paddingLength > 32) {
      errors.push(`paddingLength out of range on ${c.containerName}`);
    }
    if (c.content.length > MAX_CREATE_CHARS) {
      errors.push(`Content exceeds ${MAX_CREATE_CHARS} chars on ${c.containerName}`);
    }
    if (c.isEventCapture === 1) captureCount += 1;
  }

  if (captureCount !== 1) {
    errors.push(`Exactly 1 container must set isEventCapture=1 (found ${captureCount})`);
  }

  return { ok: errors.length === 0, errors };
}
