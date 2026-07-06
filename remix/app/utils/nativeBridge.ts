export type ThingtimeBridgeMessage = {
  type: string;
  payload?: unknown;
  sentAt?: string;
  id?: string;
};

export type ThingtimeNativeBridge = {
  version: string;
  platform: 'ios';
  isNativeWebView: true;
  postMessage: (message: ThingtimeBridgeMessage) => void;
  receiveMessageFromNative?: (message: ThingtimeBridgeMessage) => void;
  onMessage?: (listener: (message: ThingtimeBridgeMessage) => void) => () => void;
  offMessage?: (listener: (message: ThingtimeBridgeMessage) => void) => void;
};

declare global {
  interface Window {
    thingtimeNativeBridge?: ThingtimeNativeBridge;
  }
}

export const nativeBridgeMessageEvent = 'thingtime:native-message';
export const nativeBridgeReadyEvent = 'thingtime:native-bridge-ready';

export function getNativeBridge() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return window.thingtimeNativeBridge;
}

export function isNativeBridgeAvailable() {
  return Boolean(getNativeBridge()?.isNativeWebView);
}

export function postNativeBridgeMessage(message: ThingtimeBridgeMessage) {
  const bridge = getNativeBridge();

  if (!bridge?.isNativeWebView) {
    return false;
  }

  bridge.postMessage({
    ...message,
    sentAt: message.sentAt || new Date().toISOString()
  });

  return true;
}
