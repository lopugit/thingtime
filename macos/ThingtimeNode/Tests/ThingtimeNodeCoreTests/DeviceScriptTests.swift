import XCTest
@testable import ThingtimeNodeCore

final class DeviceScriptTests: XCTestCase {
    private func run(_ script: String, seconds: Double = 2) throws -> [String: JSONValue] {
        try XCTUnwrap(DeviceScript.execute(["script": .string(script), "timeoutSeconds": .number(seconds)]).objectValue?["script"]?.objectValue)
    }
    func testCapturesOutputExitAndMinimalEnvironment() throws {
        let result = try run("printf 'hello'; printf 'error' >&2; test -z \"$BASH_ENV\"; exit 7")
        XCTAssertEqual(result["stdout"], .string("hello"))
        XCTAssertEqual(result["stderr"], .string("error"))
        XCTAssertEqual(result["exitCode"], .number(7))
        XCTAssertEqual(result["timedOut"], .bool(false))
    }
    func testTimeoutAndOutputOverflow() throws {
        XCTAssertEqual(try run("sleep 20", seconds: 1)["timedOut"], .bool(true))
        let result = try run("while :; do printf '1234567890'; done")
        XCTAssertEqual(result["truncated"], .bool(true))
        XCTAssertLessThanOrEqual(result["stdout"]!.stringValue!.utf8.count, DeviceScript.maximumOutputBytes)
    }
    func testApprovalAndLockAreIndependent() {
        let action = SafeActionRequest(kind: .runScript, parameters: ["script": .string("printf ok"), "timeoutSeconds": .number(2)])
        let policy = SafeActionPolicy()
        if case .requireApproval = policy.evaluate(action: action, context: .init(origin: .remoteAccount, sessionLocked: false, userApproved: false)) {} else { XCTFail("Script needs approval") }
        if case .deny = policy.evaluate(action: action, context: .init(origin: .remoteAccount, sessionLocked: true, userApproved: true)) {} else { XCTFail("Locked sessions cannot run scripts") }
        XCTAssertEqual(policy.evaluate(action: action, context: .init(origin: .remoteAccount, sessionLocked: false, userApproved: true)), .allow)
        XCTAssertNotNil(DeviceScript.validate(["script": .string("printf ok"), "timeoutSeconds": .number(31)]))
    }
}
