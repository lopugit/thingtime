import SwiftUI
import WebKit

struct WebView: UIViewRepresentable {
    private static let nativeMessageHandlerName = "thingtimeNative"

    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.websiteDataStore = .default()
        configuration.userContentController.addUserScript(Self.bridgeUserScript)
        configuration.userContentController.add(context.coordinator, name: Self.nativeMessageHandlerName)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        context.coordinator.loadedRootURL = url
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loadedRootURL != url else { return }

        context.coordinator.loadedRootURL = url
        webView.load(URLRequest(url: url))
    }

    static let bridgeUserScript = WKUserScript(
        source: """
        (() => {
          if (window.thingtimeNativeBridge) {
            return;
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
            version: '1.0.0',
            platform: 'ios',
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
            detail: { platform: 'ios', version: '1.0.0' }
          }));
        })();
        """,
        injectionTime: .atDocumentStart,
        forMainFrameOnly: true
    )

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        var loadedRootURL: URL?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            sendToWeb(type: "native-ready", payload: [
                "platform": "ios",
                "version": "1.0.0"
            ])
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == WebView.nativeMessageHandlerName else { return }

            sendToWeb(type: "native-ack", payload: [
                "received": jsonCompatibleValue(message.body)
            ])
        }

        private func sendToWeb(type: String, payload: Any) {
            let envelope: [String: Any] = [
                "type": type,
                "payload": jsonCompatibleValue(payload),
                "sentAt": ISO8601DateFormatter().string(from: Date())
            ]

            guard
                let jsonData = try? JSONSerialization.data(withJSONObject: envelope, options: []),
                let json = String(data: jsonData, encoding: .utf8)
            else {
                return
            }

            webView?.evaluateJavaScript(
                "window.thingtimeNativeBridge?.receiveMessageFromNative(\(json));"
            )
        }

        private func jsonCompatibleValue(_ value: Any) -> Any {
            if JSONSerialization.isValidJSONObject(["value": value]) {
                return value
            }

            return String(describing: value)
        }
    }
}
