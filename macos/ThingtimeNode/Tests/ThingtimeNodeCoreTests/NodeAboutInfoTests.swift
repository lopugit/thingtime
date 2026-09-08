import XCTest
@testable import ThingtimeNodeCore

final class NodeAboutInfoTests: XCTestCase {
    func testInstalledMetadataIsWhitelistedAndIdentifiesDesktopOwnership() {
        let info = ThingtimeNodeAboutInfo(bundleInfo: [
            "CFBundleShortVersionString": "0.2.0", "CFBundleVersion": "12",
            "CFBundleIdentifier": "com.thingtime.desktop.node",
            "ThingtimeNodeSourceCommit": "abc123",
            "ThingtimeNodeElectronManaged": true,
            "PrivateToken": "must-not-appear"
        ])
        XCTAssertEqual(info.version, "0.2.0")
        XCTAssertEqual(info.build, "12")
        XCTAssertTrue(info.details.contains("Managed by Thingtime Desktop"))
        XCTAssertTrue(info.details.contains("abc123"))
        XCTAssertFalse(info.details.contains("must-not-appear"))
    }

    func testMissingMetadataDoesNotInventVersionOrOwnership() {
        let info = ThingtimeNodeAboutInfo(bundleInfo: [:])
        XCTAssertEqual(info.version, "Unknown")
        XCTAssertEqual(info.build, "Unknown")
        XCTAssertTrue(info.details.contains("Standalone Thingtime Node"))
    }
}
