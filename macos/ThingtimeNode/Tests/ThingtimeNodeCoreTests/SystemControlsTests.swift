import CoreFoundation
import XCTest
@testable import ThingtimeNodeCore

final class SystemControlsTests: XCTestCase {
    func testPrinterStringNormalizesSDKOwnershipVariants() {
        let value = "Office printer" as CFString

        XCTAssertEqual(SystemPrinters.printerString("Office printer"), "Office printer")
        XCTAssertEqual(SystemPrinters.printerString(value), "Office printer")
        XCTAssertEqual(
            SystemPrinters.printerString(Unmanaged.passUnretained(value)),
            "Office printer"
        )
    }
}
