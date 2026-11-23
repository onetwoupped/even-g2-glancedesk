import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  validateEvenHubPageContainer,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import type { G2PageSpec } from './layout';
import { renderSparklinePngBytes } from './sparkline';
import type { Gesture } from './state';

export interface GlassesHost {
  mode: 'EVEN_G2_SDK' | 'BROWSER_PREVIEW';
  render(page: G2PageSpec, forceRebuild?: boolean): Promise<void>;
  exitRoot(): Promise<void>;
  startMic(onPcmChunk: (chunk: Uint8Array) => void): Promise<void>;
  stopMic(): Promise<void>;
  onGesture(handler: (g: Gesture) => void): void;
  onMenuSelect(handler: (itemID: number) => void): void;
}

function mapOsEventToGesture(eventType: number | undefined): Gesture | null {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      return 'TAP';
    case OsEventTypeList.DOUBLE_CLICK_EVENT:
      return 'DOUBLE_TAP';
    case OsEventTypeList.SCROLL_TOP_EVENT:
      return 'SWIPE_UP';
    case OsEventTypeList.SCROLL_BOTTOM_EVENT:
      return 'SWIPE_DOWN';
    case OsEventTypeList.LONG_PRESS_EVENT:
      return 'LONG_PRESS_START';
    case OsEventTypeList.LONG_PRESS_RELEASE_EVENT:
      return 'LONG_PRESS_END';
    default:
      return null;
  }
}

export function isEvenWebView(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean((window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview)
  );
}

function buildContextMenu(): MenuContainerProperty {
  return new MenuContainerProperty({
    menuItems: [
      new MenuItemProperty({ itemID: 1, itemName: 'Glance' }),
      new MenuItemProperty({ itemID: 2, itemName: 'Manage Position' }),
      new MenuItemProperty({ itemID: 3, itemName: 'New Setup' }),
      new MenuItemProperty({ itemID: 4, itemName: 'Refresh Live' }),
    ],
  });
}

export async function connectEvenBridge(
  onPreviewPage: (page: G2PageSpec) => void,
  onLog: (msg: string) => void
): Promise<GlassesHost> {
  if (!isEvenWebView()) {
    onLog('Running in Browser 576x288 Preview Mode (use npm run sim for official Even Hub Simulator).');
    let gestureCb: ((g: Gesture) => void) | null = null;
    let menuCb: ((id: number) => void) | null = null;
    return {
      mode: 'BROWSER_PREVIEW',
      async render(page: G2PageSpec) {
        onPreviewPage(page);
      },
      async exitRoot() {
        onLog('QA Check: shutDownPageContainer(1) called on root screen.');
      },
      async startMic(onPcmChunk) {
        onPcmChunk(new Uint8Array(16000));
      },
      async stopMic() {},
      onGesture(handler) {
        gestureCb = handler;
        (window as unknown as { __g2Emit?: (g: Gesture) => void }).__g2Emit = (g) => gestureCb?.(g);
      },
      onMenuSelect(handler) {
        menuCb = handler;
        (window as unknown as { __g2Menu?: (id: number) => void }).__g2Menu = (id) => menuCb?.(id);
      },
    };
  }

  const bridge: EvenAppBridge = await waitForEvenAppBridge();
  onLog('Connected to Even Realities G2 Bridge (@evenrealities/even_hub_sdk@0.0.16)');

  let initialized = false;
  let lastView: string | null = null;
  let lastHasImage = false;
  let lastSparkKey = '';
  let imageSending = false;
  let gestureHandler: ((g: Gesture) => void) | null = null;
  let menuHandler: ((id: number) => void) | null = null;
  let pcmHandler: ((chunk: Uint8Array) => void) | null = null;

  bridge.onEvenHubEvent((event: EvenHubEvent) => {
    if (event.audioEvent?.audioPcm && pcmHandler) {
      pcmHandler(event.audioEvent.audioPcm);
      return;
    }

    const menuEv = (event as unknown as { menuItemClickEvent?: { itemID?: number } }).menuItemClickEvent;
    if (menuEv?.itemID) {
      menuHandler?.(menuEv.itemID);
      return;
    }

    if (event.sysEvent) {
      const sysGesture = mapOsEventToGesture(event.sysEvent.eventType);
      if (sysGesture === 'LONG_PRESS_START' || sysGesture === 'LONG_PRESS_END') {
        gestureHandler?.(sysGesture);
        return;
      }
    }

    if (event.textEvent) {
      const g = mapOsEventToGesture(event.textEvent.eventType);
      if (g) gestureHandler?.(g);
    } else if (event.listEvent) {
      const g = mapOsEventToGesture(event.listEvent.eventType);
      if (g) gestureHandler?.(g);
    }
  });

  function toSdkTextContainers(page: G2PageSpec): TextContainerProperty[] {
    return page.textObject.map(
      (c) =>
        new TextContainerProperty({
          containerID: c.containerID,
          containerName: c.containerName,
          xPosition: c.xPosition,
          yPosition: c.yPosition,
          width: c.width,
          height: c.height,
          borderWidth: c.borderWidth,
          borderColor: c.borderColor,
          borderRadius: c.borderRadius,
          paddingLength: c.paddingLength,
          textColor: c.textColor,
          isEventCapture: c.isEventCapture,
          content: c.content,
        })
    );
  }

  function toSdkImageContainers(page: G2PageSpec): ImageContainerProperty[] | undefined {
    if (!page.imageObject || page.imageObject.length === 0) return undefined;
    return page.imageObject.map(
      (img) =>
        new ImageContainerProperty({
          containerID: img.containerID,
          containerName: img.containerName,
          xPosition: img.xPosition,
          yPosition: img.yPosition,
          width: img.width,
          height: img.height,
        })
    );
  }

  async function pushSparklineImages(page: G2PageSpec, force = false): Promise<void> {
    if (!page.imageObject || page.imageObject.length === 0 || imageSending) return;
    for (const img of page.imageObject) {
      if (!img.sparkline || img.sparkline.closes.length < 2) continue;
      const key = `${img.sparkline.symbol}:${img.sparkline.refLevel ?? ''}:${img.sparkline.closes.slice(-3).join(',')}`;
      if (!force && key === lastSparkKey) continue;
      imageSending = true;
      try {
        const pngBytes = await renderSparklinePngBytes(img.width, img.height, img.sparkline);
        if (pngBytes.length > 0) {
          await bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: img.containerID,
              containerName: img.containerName,
              imageData: pngBytes,
            })
          );
          lastSparkKey = key;
        }
      } finally {
        imageSending = false;
      }
    }
  }

  return {
    mode: 'EVEN_G2_SDK',
    async render(page: G2PageSpec, forceRebuild = false) {
      onPreviewPage(page);
      const hasImage = Boolean(page.imageObject && page.imageObject.length > 0);
      const payloadShape = {
        containerTotalNum: page.containerTotalNum,
        textObject: toSdkTextContainers(page),
        imageObject: toSdkImageContainers(page),
        menuObject: buildContextMenu(),
      };

      const check = validateEvenHubPageContainer(payloadShape);
      if (!check.valid) {
        onLog(`SDK validation blocked page: ${check.message}`);
        return;
      }

      if (!initialized) {
        const res = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(payloadShape));
        initialized = true;
        lastView = page.view;
        lastHasImage = hasImage;
        onLog(`createStartUpPageContainer -> code ${res}`);
        await pushSparklineImages(page, true);
        return;
      }

      if (!forceRebuild && lastView === page.view && lastHasImage === hasImage) {
        for (const c of page.textObject) {
          await bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: c.containerID,
              containerName: c.containerName,
              content: c.content,
              contentOffset: 0,
              contentLength: c.content.length,
              textColor: c.textColor,
            })
          );
        }
        await pushSparklineImages(page, false);
        return;
      }

      await bridge.rebuildPageContainer(new RebuildPageContainer(payloadShape));
      lastView = page.view;
      lastHasImage = hasImage;
      await pushSparklineImages(page, true);
    },
    async exitRoot() {
      await bridge.shutDownPageContainer(1);
    },
    async startMic(onPcmChunk) {
      pcmHandler = onPcmChunk;
      await bridge.audioControl(true, AudioInputSource.Glasses);
    },
    async stopMic() {
      pcmHandler = null;
      await bridge.audioControl(false, AudioInputSource.Glasses);
    },
    onGesture(handler) {
      gestureHandler = handler;
    },
    onMenuSelect(handler) {
      menuHandler = handler;
    },
  };
}
