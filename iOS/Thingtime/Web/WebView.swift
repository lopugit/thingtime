import SwiftUI
import UIKit
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

        let webView = ThingtimeWKWebView(frame: .zero, configuration: configuration)
        context.coordinator.webView = webView
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = true
        webView.backgroundColor = .white
        webView.scrollView.backgroundColor = .white
        if #available(iOS 15.0, *) {
            webView.underPageBackgroundColor = .white
        }
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.applyThingtimeScrollInsets(forceSafeAreaUpdate: true)
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
            (webView as? ThingtimeWKWebView)?.applyThingtimeScrollInsets(forceSafeAreaUpdate: true)

            ThingtimeNativeNotifications.shared.attach(webView: webView)

            sendToWeb(type: "native-ready", payload: [
                "platform": "ios",
                "version": "1.1.0",
                "watchNotifications": true
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

private final class ThingtimeWKWebView: WKWebView {
    private var lastAppliedSafeAreaInsets: UIEdgeInsets?

    override func layoutSubviews() {
        super.layoutSubviews()
        applyThingtimeScrollInsets()
    }

    override func safeAreaInsetsDidChange() {
        super.safeAreaInsetsDidChange()
        applyThingtimeScrollInsets()
    }

    func applyThingtimeScrollInsets(forceSafeAreaUpdate: Bool = false) {
        let currentSafeAreaInsets = resolvedSafeAreaInsets()

        var contentInset = scrollView.contentInset
        contentInset.top = 0
        contentInset.left = 0
        contentInset.right = 0
        contentInset.bottom = 0
        scrollView.contentInset = contentInset

        var indicatorInsets = scrollView.verticalScrollIndicatorInsets
        indicatorInsets.top = currentSafeAreaInsets.top
        indicatorInsets.bottom = currentSafeAreaInsets.bottom
        scrollView.verticalScrollIndicatorInsets = indicatorInsets

        applyNativeSafeAreaVariables(currentSafeAreaInsets, force: forceSafeAreaUpdate)
    }

    private func resolvedSafeAreaInsets() -> UIEdgeInsets {
        var insets = safeAreaInsets

        guard let window else {
            return insets
        }

        let windowInsets = window.safeAreaInsets
        let frameInWindow = convert(bounds, to: window)
        let bottomUnsafeStart = window.bounds.height - windowInsets.bottom
        let rightUnsafeStart = window.bounds.width - windowInsets.right

        insets.top = max(insets.top, windowInsets.top - frameInWindow.minY, 0)
        insets.right = max(insets.right, frameInWindow.maxX - rightUnsafeStart, 0)
        insets.bottom = max(insets.bottom, frameInWindow.maxY - bottomUnsafeStart, 0)
        insets.left = max(insets.left, windowInsets.left - frameInWindow.minX, 0)

        if insets.top < 1, frameInWindow.minY < 1, let statusBarHeight = window.windowScene?.statusBarManager?.statusBarFrame.height {
            insets.top = max(insets.top, statusBarHeight)
        }

        return insets
    }

    private func applyNativeSafeAreaVariables(_ insets: UIEdgeInsets, force: Bool) {
        if !force, let lastAppliedSafeAreaInsets, lastAppliedSafeAreaInsets.isApproximatelyEqual(to: insets) {
            return
        }

        lastAppliedSafeAreaInsets = insets

        let script = """
        (() => {
          const root = document.documentElement;
          if (!root) return;
          const values = {
            top: '\(Self.cssPixels(insets.top))',
            right: '\(Self.cssPixels(insets.right))',
            bottom: '\(Self.cssPixels(insets.bottom))',
            left: '\(Self.cssPixels(insets.left))'
          };
          root.style.setProperty('--thingtime-native-safe-area-top', values.top);
          root.style.setProperty('--thingtime-native-safe-area-right', values.right);
          root.style.setProperty('--thingtime-native-safe-area-bottom', values.bottom);
          root.style.setProperty('--thingtime-native-safe-area-left', values.left);
          root.style.setProperty('--thingtime-safe-area-top', values.top);
          root.style.setProperty('--thingtime-safe-area-right', values.right);
          root.style.setProperty('--thingtime-safe-area-bottom', values.bottom);
          root.style.setProperty('--thingtime-safe-area-left', values.left);
        })();
        """

        evaluateJavaScript(script, completionHandler: nil)
    }

    private static func cssPixels(_ value: CGFloat) -> String {
        "\(Int(ceil(value)))px"
    }
}

private extension UIEdgeInsets {
    func isApproximatelyEqual(to other: UIEdgeInsets) -> Bool {
        abs(top - other.top) < 0.5
            && abs(right - other.right) < 0.5
            && abs(bottom - other.bottom) < 0.5
            && abs(left - other.left) < 0.5
    }
}
