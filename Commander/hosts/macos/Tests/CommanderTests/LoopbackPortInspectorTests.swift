import XCTest
@testable import Commander

final class LoopbackPortInspectorTests: XCTestCase {
  func testParsesListenerProcessFromLsofMachineOutput() {
    XCTAssertEqual(
      LoopbackPortInspector.parse("p4242\ncnode\ntIPv4\n"),
      LoopbackPortProcess(pid: 4242, command: "node")
    )
  }

  func testIgnoresIncompleteLsofOutput() {
    XCTAssertNil(LoopbackPortInspector.parse("p4242\ntIPv4\n"))
    XCTAssertNil(LoopbackPortInspector.parse("cnode\ntIPv4\n"))
  }

  func testDoesNotWrapBeyondLastValidPort() {
    XCTAssertNil(LoopbackPortInspector().nextAvailablePort(after: 65_535))
  }
}
