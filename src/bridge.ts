import {
  AudioInputSource,
  CreateStartUpPageContainer,
  OsEventTypeList,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';
import type { G2PageSpec } from './layout';
import type { Gesture } from './state';

export interface GlassesHost {
  mode: 'EVEN_G2_SDK' | 'BROWSER_PREVIEW';
  render(page: G2PageSpec, forceRebuild?: boolean): Promise<void>;
  exitRoot(): Promise<void>;
  startMic(onPcmChunk: (chunk: Uint8Array) => void): Promise<void>;
  stopMic(): Promise<void>;
  onGesture(handler: (g: Gesture) => void): void;
}

function mapOsEventToGesture(eventType: number | undefined): Gesture | null {
  switch (eventType) {
    case OsEventTypeList.CLICK_EVENT:
    case undefined:
      // Official SDK quirk: protobuf enum 0 (CLICK_EVENT) can normalize to undefined
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
  return typeof window !== 'undefined' && Boolean((window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview);
}

export async function connectEvenBridge(
  onPreviewPage: (page: G2PageSpec) => void,
  onLog: (msg: string) => void
): Promise<GlassesHost> {
  if (!isEvenWebView()) {
    onLog('Running in Browser 576x288 Preview Mode (open in @evenrealities/evenhub-simulator for live SDK bridge).');
    let gestureCb: ((g: Gesture) => void) | null = null;
    return {
      mode: 'BROWSER_PREVIEW',
      async render(page: G2PageSpec) {
        onPreviewPage(page);
      },
      async exitRoot() {
        onLog('QA Check: shutDownPageContainer(1) invoked on root page (native exit dialog).');
      },
      async startMic(onPcmChunk) {
        // Emit 0.5s of clean synthetic silence PCM in browser preview
        onPcmChunk(new Uint8Array(16000));
      },
      async stopMic() {},
      onGesture(handler) {
        gestureCb = handler;
        (window as unknown as { __g2Emit?: (g: Gesture) => void }).__g2Emit = (g) => gestureCb?.(g);
      },
    };
  }

  const bridge: EvenAppBridge = await waitForEvenAppBridge();
  onLog('Connected to Even Realities G2 Bridge via @evenrealities/even_hub_sdk@0.0.16');

  let initialized = false;
  let lastView: string | null = null;
  let gestureHandler: ((g: Gesture) => void) | null = null;
  let pcmHandler: ((chunk: Uint8Array) => void) | null = null;

  bridge.onEvenHubEvent((event: EvenHubEvent) => {
    if (event.audioEvent?.audioPcm && pcmHandler) {
      pcmHandler(event.audioEvent.audioPcm);
      return;
    }

    // Long-press events always arrive on sysEvent
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
          isEventCapture: c.isEventCapture,
          content: c.content,
        })
    );
  }

  return {
    mode: 'EVEN_G2_SDK',
    async render(page: G2PageSpec, forceRebuild = false) {
      onPreviewPage(page);
      if (!initialized) {
        const res = await bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer({
            containerTotalNum: page.containerTotalNum,
            textObject: toSdkTextContainers(page),
          })
        );
        initialized = true;
        lastView = page.view;
        onLog(`createStartUpPageContainer -> code ${res}`);
        return;
      }

      if (!forceRebuild && lastView === page.view) {
        // Flicker-free in-place text update on hardware
        for (const c of page.textObject) {
          await bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID: c.containerID,
              containerName: c.containerName,
              content: c.content,
              contentOffset: 0,
              contentLength: c.content.length,
            })
          );
        }
        return;
      }

      await bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: page.containerTotalNum,
          textObject: toSdkTextContainers(page),
        })
      );
      lastView = page.view;
    },
    async exitRoot() {
      // Mandatory Even Hub QA rule: mode 1 shows system exit confirmation dialog on root page
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
  };
}
