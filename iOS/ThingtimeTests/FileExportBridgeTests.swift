import XCTest
import WebKit
@testable import Thingtime

@MainActor
final class FileExportBridgeTests: XCTestCase {
    func testOnlyExactAuthenticationCookieIsPinned() throws {
        func cookie(_ name: String, _ value: String) -> HTTPCookie {
            HTTPCookie(properties: [.name: name, .value: value, .domain: "localhost", .path: "/"])!
        }
        let auth = cookie("tt_auth", "disposable.test.credential")
        XCTAssertEqual(try NativeFileSession.authenticationCookie([cookie("theme", "dark"), auth]), "tt_auth=disposable.test.credential")
        XCTAssertEqual(try NativeFileSession.authenticationCookie([auth, cookie("theme", "light")]), "tt_auth=disposable.test.credential")
        XCTAssertThrowsError(try NativeFileSession.authenticationCookie([]))
        XCTAssertThrowsError(try NativeFileSession.authenticationCookie([auth, auth]))
        XCTAssertThrowsError(try NativeFileSession.authenticationCookie([cookie("tt_auth", "")] ))
        XCTAssertThrowsError(try NativeFileSession.authenticationCookie([cookie("tt_auth", "value;other=credential")] ))
    }
    func testExportFeatureIsExplicitAndMainFrameOnly() {
        XCTAssertEqual(FileExportBridge.version, "1.0.0")
        XCTAssertTrue(FileExportBridge.script.isForMainFrameOnly)
        XCTAssertTrue(FileExportBridge.script.source.contains("fileExportVersion"))
    }
}
