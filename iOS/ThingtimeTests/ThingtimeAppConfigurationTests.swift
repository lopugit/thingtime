import XCTest

final class ThingtimeAppConfigurationTests: XCTestCase {
    func testMediaPickerPrivacyUsageDescriptionsArePresent() {
        let requiredKeys = [
            "NSCameraUsageDescription",
            "NSMicrophoneUsageDescription",
            "NSPhotoLibraryUsageDescription"
        ]

        for key in requiredKeys {
            let value = Bundle.main.object(forInfoDictionaryKey: key) as? String

            XCTAssertFalse(
                value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true,
                "The hosted Thingtime app must provide a non-empty \(key) value."
            )
        }
    }
}
