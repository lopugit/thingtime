import WebKit

enum ThingtimeBridgeScript {
    static let script = WKUserScript(
        source: """
        (() => {
          if (window.thingtimeNativeBridge) {
            return;
          }

          document.documentElement?.classList.add('thingtime-native-webview');
          const markNativeBody = () => {
            document.body?.classList.add('thingtime-native-webview-body');
          };
          if (document.body) {
            markNativeBody();
          } else {
            document.addEventListener('DOMContentLoaded', markNativeBody, { once: true });
          }

          const listeners = new Set();
          const dispatchNativeMessage = (message) => {
            const event = new CustomEvent('thingtime:native-message', { detail: message });
            window.dispatchEvent(event);
            listeners.forEach((listener) => {
              try {
                listener(message);
              } catch (error) {
                console.error('[ThingtimeNativeBridge] listener failed', error);
              }
            });
          };

          window.thingtimeNativeBridge = {
            version: '1.2.0',
            lopuVoiceVersion: '1.1.0',
            widgetVersion: '1.0.0',
            platform: '\(platform)',
            isNativeWebView: true,
            postMessage(message) {
              window.webkit.messageHandlers.thingtimeNative.postMessage(message);
            },
            receiveMessageFromNative(message) {
              dispatchNativeMessage(message);
            },
            onMessage(listener) {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
            offMessage(listener) {
              listeners.delete(listener);
            }
          };

          window.dispatchEvent(new CustomEvent('thingtime:native-bridge-ready', {
            detail: { platform: '\(platform)', version: '1.0.0' }
          }));
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )
    static var platform: String {
#if os(macOS)
        return "macos"
#else
        return "ios"
#endif
    }
}
