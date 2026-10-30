import Foundation

enum WidgetActionInbox {
    static func enqueue(_ action: WidgetAction) {
        WidgetStore.defaults?.set(["action": action.rawValue, "date": Date().timeIntervalSince1970], forKey: "widget.pendingAction")
    }
    static func take() -> URL? {
        guard let pending = WidgetStore.defaults?.dictionary(forKey: "widget.pendingAction") else { return nil }
        WidgetStore.defaults?.removeObject(forKey: "widget.pendingAction")
        guard let date = pending["date"] as? Double, abs(Date().timeIntervalSince1970 - date) < 60,
              let value = pending["action"] as? String, let action = WidgetAction(rawValue: value) else { return nil }
        return action.url
    }
}
