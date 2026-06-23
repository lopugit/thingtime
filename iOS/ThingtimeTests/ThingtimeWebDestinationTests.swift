import XCTest
@testable import Thingtime

final class ThingtimeWebDestinationTests: XCTestCase {
    func testHomeURLLoadsProductionThingtime() {
        XCTAssertEqual(ThingtimeWebDestination.home.absoluteString, "https://thingtime.com")
        XCTAssertEqual(ThingtimeWebDestination.home.scheme, "https")
        XCTAssertEqual(ThingtimeWebDestination.home.host, "thingtime.com")
    }
}
