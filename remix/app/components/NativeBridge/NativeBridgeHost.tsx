import React from 'react';

import {
  nativeBridgeMessageEvent,
  nativeBridgeReadyEvent,
  postNativeBridgeMessage,
  type ThingtimeBridgeMessage
} from '~/utils/nativeBridge';

export function NativeBridgeHost() {
  React.useEffect(() => {
    const sendReadyMessage = () => {
      postNativeBridgeMessage({
        type: 'web-ready',
        payload: {
          href: window.location.href,
          userAgent: window.navigator.userAgent
        }
      });
    };

    const handleNativeMessage = (event: Event) => {
      const message = (event as CustomEvent<ThingtimeBridgeMessage>).detail;
      window.dispatchEvent(
        new CustomEvent('thingtime:web-received-native-message', {
          detail: message
        })
      );
    };

    window.addEventListener(nativeBridgeReadyEvent, sendReadyMessage);
    window.addEventListener(nativeBridgeMessageEvent, handleNativeMessage);

    if (window.thingtimeNativeBridge?.isNativeWebView) {
      sendReadyMessage();
    }

    return () => {
      window.removeEventListener(nativeBridgeReadyEvent, sendReadyMessage);
      window.removeEventListener(nativeBridgeMessageEvent, handleNativeMessage);
    };
  }, []);

  return null;
}
