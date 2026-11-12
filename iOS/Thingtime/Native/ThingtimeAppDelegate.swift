import UIKit
import UserNotifications

final class ThingtimeAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        NativeBackgroundPhotoUpload.shared.activate()
        NativeUploadBackgroundCoordinator.shared.activate()
        NativeDeferredUpload.shared.activate(foreground: application.applicationState != .background)
        MobileDeviceBackgroundPresence.shared.activate()
        MobileDeviceLocation.shared.activate(foreground: application.applicationState != .background)
        // Foreground launch must reauthorize current web identity/preferences.
        // A system background-only relaunch retains the verified saved binding.
        if application.applicationState != .background { MobileDeviceBackgroundPresence.shared.stop() }
        UNUserNotificationCenter.current().delegate = self
        ThingtimeNativeNotifications.shared.activate()
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        if !NativeBackgroundPhotoUpload.shared.handleEvents(identifier: identifier, completion: completionHandler) { completionHandler() }
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Clear before active WebKit callbacks can authorize a new binding.
        MobileDeviceBackgroundPresence.shared.stop()
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        ThingtimeNativeNotifications.shared.setPhoneDeviceToken(deviceToken.hexString)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        ThingtimeNativeNotifications.shared.recordRegistrationFailure(error)
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        ThingtimeNativeNotifications.shared.receivedRemoteNotification(userInfo)
        completionHandler(.newData)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        ThingtimeNativeNotifications.shared.receivedRemoteNotification(notification.request.content.userInfo)
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        ThingtimeNativeNotifications.shared.openRemoteNotification(response.notification.request.content.userInfo)
        completionHandler()
    }
}

private extension Data {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}
