import CryptoKit
import Foundation
import XCTest
@testable import ThingtimeNodeCore

final class RemoteFilesystemTests: XCTestCase {
    private var root: URL!
    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("thingtime-files-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: root) }
    private func run(_ input: [String: JSONValue]) throws -> [String: JSONValue] {
        let result = try RemoteFilesystem(root: root).execute(input)
        return try XCTUnwrap(result.objectValue?["filesystem"]?.objectValue)
    }
    private func file(_ name: String) throws -> [String: JSONValue] {
        let result = try run(["op": .string("list"), "path": .string("")])
        guard case let .array(entries)? = result["entries"], let e = entries.first(where: { $0.objectValue?["name"] == .string(name) })?.objectValue else { throw ThingtimeNodeError.invalidRequest("missing fixture") }
        return e
    }
    func testListingReadVersionFenceAndSymlinkRefusal() throws {
        try Data("hello".utf8).write(to: root.appendingPathComponent("hello.txt"))
        let entry = try file("hello.txt")
        let request: [String: JSONValue] = ["op": .string("read"), "path": .string("hello.txt"), "version": entry["version"]!, "offset": .number(0)]
        XCTAssertEqual(try run(request)["data"], .string(Data("hello".utf8).base64EncodedString()))
        try Data("changed".utf8).write(to: root.appendingPathComponent("hello.txt"))
        XCTAssertThrowsError(try run(request))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: root.deletingLastPathComponent())
        XCTAssertThrowsError(try run(["op": .string("list"), "path": .string("escape")]))
        for path in ["../escape", "/etc", "a/../b", "a//b"] { XCTAssertThrowsError(try RemoteFilesystem.components(path)) }
    }
    func testChunkRetryCommitAndNoOverwrite() throws {
        let bytes = Data(repeating: 42, count: 70_000)
        let hash = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        let id = UUID().uuidString
        func chunk(_ offset: Int, _ data: Data) -> [String: JSONValue] {
            ["op": .string("write"), "path": .string("copy.bin"), "transferId": .string(id), "offset": .number(Double(offset)), "total": .number(Double(bytes.count)), "sha256": .string(hash), "data": .string(data.base64EncodedString())]
        }
        let first = chunk(0, bytes.prefix(65_536))
        XCTAssertEqual(try run(first)["complete"], .bool(false))
        XCTAssertEqual(try run(first)["offset"], .number(65_536))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("copy.bin").path))
        XCTAssertEqual(try run(chunk(65_536, bytes.dropFirst(65_536)))["complete"], .bool(true))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("copy.bin")), bytes)
        _ = try run(first)
        XCTAssertThrowsError(try run(chunk(65_536, bytes.dropFirst(65_536))))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("copy.bin")), bytes)
    }
    func testCopyMoveAndRecoverableTrash() throws {
        try Data("fixture".utf8).write(to: root.appendingPathComponent("source.txt"))
        let source = try file("source.txt")
        _ = try run(["op": .string("copy"), "path": .string("source.txt"), "destination": .string("copy.txt"), "version": source["version"]!])
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent("source.txt").path))
        let copy = try file("copy.txt")
        XCTAssertThrowsError(try run(["op": .string("move"), "path": .string("copy.txt"), "destination": .string("source.txt"), "version": copy["version"]!]))
        let trashed = try run(["op": .string("trash"), "path": .string("copy.txt"), "version": copy["version"]!])
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("copy.txt").path))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent(try XCTUnwrap(trashed["path"]?.stringValue))), Data("fixture".utf8))
    }
    func testFailedFolderCopyLeavesNoPartialDestination() throws {
        let folder = root.appendingPathComponent("source")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try Data("first".utf8).write(to: folder.appendingPathComponent("a.txt"))
        try FileManager.default.createSymbolicLink(at: folder.appendingPathComponent("z-link"), withDestinationURL: root.deletingLastPathComponent())
        let source = try file("source")
        XCTAssertThrowsError(try run(["op": .string("copy"), "path": .string("source"), "destination": .string("copy"), "version": source["version"]!]))
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent("copy").path))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), ["source"])
    }
    func testInterruptedUploadsExpireWithoutRemovingOtherFiles() throws {
        let old = ".thingtime-upload-" + UUID().uuidString + "-" + String(repeating: "a", count: 64)
        let fresh = ".thingtime-upload-" + UUID().uuidString + "-" + String(repeating: "b", count: 64)
        for name in [old, fresh, ".thingtime-upload-personal"] { try Data([1]).write(to: root.appendingPathComponent(name)) }
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -90_000)], ofItemAtPath: root.appendingPathComponent(old).path)
        _ = try run(["op": .string("list"), "path": .string("")])
        XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(old).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(fresh).path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(".thingtime-upload-personal").path))
    }
    func testFilesystemActionsRespectLockAndRemoteApproval() {
        let action = SafeActionRequest(kind: .filesystem, parameters: ["op": .string("list"), "path": .string("")])
        guard case .deny = SafeActionPolicy().evaluate(action: action, context: .init(origin: .remoteAccount, sessionLocked: true, userApproved: true)) else { return XCTFail("Locked read must fail") }
        guard case .requireApproval = SafeActionPolicy().evaluate(action: action, context: .init(origin: .remoteAccount, sessionLocked: false, userApproved: false)) else { return XCTFail("Private reads need approval") }
    }
}
