import {
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
import { renderCandlestickPngBytes } from './candles';
import type { G2PageSpec } from './layout';
import type { Gesture } from './state';

export interface GlassesHost {
  mode: 'EVEN_G2_SDK' | 'BROWSER_PREVIEW';
  render(page: G2PageSpec, forceRebuild?: boolean): Promise<void>;
  exitRoot(): Promise<void>;
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
      new MenuItemProperty({ itemID: 2, itemName: 'New Trade (SL/TP)' }),
      new MenuItemProperty({ itemID: 3, itemName: 'Manage Position' }),
      new MenuItemProperty({ itemID: 4, itemName: 'Toggle 0.5/1/2R' }),
    ],
  });
}

export async function connectEvenBridge(
  onPreviewPage: (page: G2PageSpec) => void,
  onLog: (msg: string) => void
): Promise<GlassesHost> {
  if (!isEvenWebView()) {
    onLog('Browser 576x288 Preview Mode (use npm run sim for official Even Hub Simulator).');
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
  let lastChartKey = '';
  let imageSending = false;
  let pendingPage: G2PageSpec | null = null;
  let gestureHandler: ((g: Gesture) => void) | null = null;
  let menuHandler: ((id: number) => void) | null = null;

  bridge.onEvenHubEvent((event: EvenHubEvent) => {
    const menuEv = (event as unknown as { menuItemClickEvent?: { itemID?: number } }).menuItemClickEvent;
    if (menuEv?.itemID) {
      menuHandler?.(menuEv.itemID);
      return;
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

  async function pushCandlestickImages(page: G2PageSpec, force = false): Promise<void> {
    if (!page.imageObject || page.imageObject.length === 0) return;
    if (imageSending) {
      // Coalesce rapid SL/TP swipes so latest line position always lands cleanly
      pendingPage = page;
      return;
    }
    for (const img of page.imageObject) {
      if (!img.chart || img.chart.bars.length < 2) continue;
      const lvlKey = (img.chart.levels || []).map((l) => `${l.label}:${l.price.toFixed(4)}:${l.emphasized ? 1 : 0}`).join('|');
      const key = `${img.chart.symbol}:${img.chart.bars.slice(-1)[0].c}:${lvlKey}`;
      if (!force && key === lastChartKey) continue;
      imageSending = true;
      try {
        const pngBytes = await renderCandlestickPngBytes(img.width, img.height, img.chart);
        if (pngBytes.length > 0) {
          await bridge.updateImageRawData(
            new ImageRawDataUpdate({
              containerID: img.containerID,
              containerName: img.containerName,
              imageData: pngBytes,
            })
          );
          lastChartKey = key;
        }
      } finally {
        imageSending = false;
      }
    }
    if (pendingPage) {
      const next = pendingPage;
      pendingPage = null;
      await pushCandlestickImages(next, false);
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
        await pushCandlestickImages(page, true);
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
        await pushCandlestickImages(page, false);
        return;
      }

      await bridge.rebuildPageContainer(new RebuildPageContainer(payloadShape));
      lastView = page.view;
      lastHasImage = hasImage;
      await pushCandlestickImages(page, true);
    },
    async exitRoot() {
      await bridge.shutDownPageContainer(1);
    },
    onGesture(handler) {
      gestureHandler = handler;
    },
    onMenuSelect(handler) {
      menuHandler = handler;
    },
  };
}
