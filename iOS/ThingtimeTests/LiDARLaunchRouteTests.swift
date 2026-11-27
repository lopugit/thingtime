import XCTest
@testable import Thingtime

final class LiDARLaunchRouteTests: XCTestCase {
    private let origin = URL(string: "https://thingtime.com")!

    func testLibraryNavigationUsesSelectedOriginWithoutStartingCapture() {
        XCTAssertEqual(LiDARLaunchRoute.libraryURL(origin: origin)?.absoluteString, "https://thingtime.com/things?lidar=1")
        XCTAssertEqual(LiDARLaunchRoute.libraryURL(origin: URL(string: "https://preview.test:444/old?start=1#old")!)?.absoluteString,
                       "https://preview.test:444/things?lidar=1")
    }

    func testColdHandoffWaitsForSelectedPageAndCannotCrossDestination() {
        XCTAssertFalse(LiDARLaunchRoute.canConsume(pendingOrigin: origin, selectedOrigin: origin, currentURL: origin, isLoading: true))
        XCTAssertFalse(LiDARLaunchRoute.canConsume(pendingOrigin: origin, selectedOrigin: origin, currentURL: nil, isLoading: false))
        let other = URL(string: "https://preview.example")!
        XCTAssertFalse(LiDARLaunchRoute.canConsume(pendingOrigin: origin, selectedOrigin: other, currentURL: other, isLoading: false))
        XCTAssertFalse(LiDARLaunchRoute.canConsume(pendingOrigin: origin, selectedOrigin: origin, currentURL: other, isLoading: false))
        XCTAssertTrue(LiDARLaunchRoute.canConsume(pendingOrigin: origin, selectedOrigin: origin, currentURL: origin.appendingPathComponent("things"), isLoading: false))
    }

    func testSameOriginControlHandoff() {
        for link in ["thingtime://scan/lidar", "thingtime://scan/lidar?origin=https%3A%2F%2Fthingtime.com"] {
            XCTAssertTrue(LiDARLaunchRoute.accepts(URL(string: link)!, selectedOrigin: origin))
        }
    }
    func testNoCrossOriginCredentialsCallbackOrAutomaticCapture() {
        for link in ["https://scan/lidar", "thingtime://scan/other", "thingtime://user@scan/lidar",
                     "thingtime://scan:99/lidar", "thingtime://scan/lidar#start", "thingtime://scan/lidar?start=1",
                     "thingtime://scan/lidar?callback=https://evil.test", "thingtime://scan/lidar?owner=other",
                     "thingtime://scan/lidar?origin=https://evil.test", "thingtime://scan/lidar?origin=http://thingtime.com",
                     "thingtime://scan/lidar?origin=https://thingtime.com:444", "thingtime://scan/lidar?origin=https://thingtime.com/path",
                     "thingtime://scan/lidar?origin=https://thingtime.com&origin=https://thingtime.com"] {
            XCTAssertFalse(LiDARLaunchRoute.accepts(URL(string: link)!, selectedOrigin: origin), link)
        }
    }
}
