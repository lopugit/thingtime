import AppleFileSync
import Foundation
import XCTest
@testable import Thingtime

final class FileReplicaAdmissionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000_000)
    private let offline = URLError(.notConnectedToInternet)

    private func scope(owner: String = "account", origin: String = "https://thingtime.example",
                       device: String = "phone", thing: String = "file") throws -> ManagedFileReplica.Scope {
        try .init(owner: FileSyncOwnerScope(ownerId: owner, url: XCTUnwrap(URL(string: origin))),
                  dataPlane: "home", deviceId: device, thingId: thing)
    }

    private func fixture(_ id: String, revision: String = "head") throws -> NativeCloudFile {
        try JSONDecoder().decode(NativeCloudFile.self, from: JSONSerialization.data(withJSONObject: [
            "id": id, "revision": revision, "name": "scan.tar", "trashed": false,
            "content": [
                "attachmentId": "attachment", "version": String(repeating: "a", count: 64), "size": 0,
                "fingerprint": ["algorithm": "sha256-parts-v1", "partSizeBytes": 8 * 1024 * 1024, "partCount": 0,
                                "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]
            ]
        ]))
    }

    private func directory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: false)
        addTeardownBlock { try FileManager.default.removeItem(at: url) }
        return url.appendingPathComponent("proofs", isDirectory: true)
    }

    func testOnlyExactPriorAdmissionSurvivesRestartOffline() throws {
        let root = try directory(), target = try scope()
        let cookie = FileReplicaCookieBinding(header: "tt_auth=fixture-cookie", expiresAt: now.addingTimeInterval(86_400))
        let file = try fixture(target.thingId)
        let store = FileReplicaAdmissionStore(directory: root)
        XCTAssertThrowsError(try store.recoverOffline(target, cookie: cookie, expectedRevision: "head", after: offline, now: now))
        try store.save(target, file: file, cookie: cookie, now: now)

        let restarted = FileReplicaAdmissionStore(directory: root)
        XCTAssertEqual(try restarted.recoverOffline(target, cookie: cookie, expectedRevision: "head",
            after: offline, now: now.addingTimeInterval(21_600)).file, file)
        for changed in try [scope(owner: "other"), scope(origin: "https://other.example"),
                            scope(device: "tablet"), scope(thing: "other")] {
            XCTAssertThrowsError(try restarted.recoverOffline(changed, cookie: cookie, expectedRevision: "head", after: offline, now: now))
        }
        let replacement = FileReplicaCookieBinding(header: "tt_auth=changed-cookie", expiresAt: cookie.expiresAt)
        XCTAssertThrowsError(try restarted.recoverOffline(target, cookie: replacement, expectedRevision: "head", after: offline, now: now))
        XCTAssertThrowsError(try restarted.recoverOffline(target, cookie: cookie, expectedRevision: "old", after: offline, now: now))
        XCTAssertThrowsError(try restarted.recoverOffline(target, cookie: cookie, expectedRevision: "head", after: URLError(.timedOut), now: now))

        let recorded = try XCTUnwrap(FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey]))
            .compactMap { $0 as? URL }.filter { try $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true }
        XCTAssertEqual(recorded.count, 1)
        let bytes = try Data(contentsOf: XCTUnwrap(recorded.first))
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("fixture-cookie"))
        try Data("damaged metadata".utf8).write(to: XCTUnwrap(recorded.first))
        XCTAssertThrowsError(try restarted.recoverOffline(target, cookie: cookie, expectedRevision: "head", after: offline, now: now))
    }

    func testCookieAndTokenExpiryBothNarrowAdmission() throws {
        let root = try directory(), target = try scope()
        let tokenExpiry = now.addingTimeInterval(3600)
        let claims = Data("{\"exp\":\(tokenExpiry.timeIntervalSince1970)}".utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let header = "tt_auth=header.\(claims).signature"
        let later = FileReplicaCookieBinding(header: header, expiresAt: now.addingTimeInterval(7200))
        let earlier = FileReplicaCookieBinding(header: header, expiresAt: now.addingTimeInterval(1800))
        XCTAssertEqual(later.expiresAt, tokenExpiry)
        let store = FileReplicaAdmissionStore(directory: root)
        try store.save(target, file: fixture(target.thingId), cookie: later, now: now)
        XCTAssertThrowsError(try store.recoverOffline(target, cookie: later, expectedRevision: nil, after: offline, now: tokenExpiry))
        XCTAssertThrowsError(try store.recoverOffline(target, cookie: earlier, expectedRevision: nil, after: offline,
                                                        now: now.addingTimeInterval(2000)))
    }

    func testRefusalAndSessionRevocationPersistAcrossRestart() throws {
        let root = try directory()
        let store = FileReplicaAdmissionStore(directory: root)
        let cookie = FileReplicaCookieBinding(header: "tt_auth=fixture-cookie", expiresAt: nil)
        let nextSession = FileReplicaCookieBinding(header: "tt_auth=next-session", expiresAt: nil)
        let first = try scope(), second = try scope(thing: "second")
        try store.revoke(first, cookie: cookie)
        try store.remove(first, cookie: cookie)
        try store.save(first, file: fixture(first.thingId), cookie: cookie, now: now)
        try store.save(second, file: fixture(second.thingId), cookie: cookie, now: now)
        try store.save(second, file: fixture(second.thingId), cookie: nextSession, now: now)
        try store.remove(first, cookie: cookie)
        let restarted = FileReplicaAdmissionStore(directory: root)
        XCTAssertThrowsError(try restarted.recoverOffline(first, cookie: cookie, expectedRevision: nil, after: offline, now: now))
        XCTAssertNoThrow(try restarted.recoverOffline(second, cookie: cookie, expectedRevision: nil, after: offline, now: now))
        try restarted.revoke(first, cookie: cookie)

        let afterRevocation = FileReplicaAdmissionStore(directory: root)
        XCTAssertThrowsError(try afterRevocation.recoverOffline(second, cookie: cookie, expectedRevision: nil, after: offline, now: now))
        XCTAssertNoThrow(try afterRevocation.recoverOffline(second, cookie: nextSession, expectedRevision: nil, after: offline, now: now))
    }
}
