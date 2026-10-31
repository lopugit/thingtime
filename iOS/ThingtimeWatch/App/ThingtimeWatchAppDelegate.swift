import UserNotifications
import WatchKit

final class ThingtimeWatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        UNUserNotificationCenter.current().delegate = self
        ThingtimeWatchStore.shared.activate()
        WKApplication.shared().registerForRemoteNotifications()
    }

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        ThingtimeWatchStore.shared.setDeviceToken(deviceToken.map { String(format: "%02x", $0) }.joined())
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        ThingtimeWatchStore.shared.recordRegistrationFailure(error)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        ThingtimeWatchStore.shared.requestRefresh()
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if let id = response.notification.request.content.userInfo["notificationId"] as? String {
            ThingtimeWatchStore.shared.markRead(id: id)
        }
        completionHandler()
    }
}
