#if DEBUG && BACKGROUND_PHOTO_DAEMON_FIXTURE
import AppleFileSync
import CryptoKit
import SwiftUI
import UIKit

/// Copied into an isolated application's entry point by the daemon fixture.
/// Ordinary app and test targets do not enable this compilation condition.
@main
struct BackgroundPhotoDaemonFixtureApp: App {
    @UIApplicationDelegateAdaptor(BackgroundPhotoDaemonFixtureDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Text("Background photo transport fixture")
                .padding()
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await BackgroundPhotoDaemonFixture.shared.recover() } }
                }
        }
    }
}

@MainActor
private final class BackgroundPhotoDaemonFixtureDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil {
            Task { await BackgroundPhotoDaemonFixture.shared.start() }
        }
        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        Task { await BackgroundPhotoDaemonFixture.shared.recover() }
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard BackgroundPhotoDaemonFixture.shared.handleEvents(identifier, completion: completionHandler) else {
            completionHandler()
            return
        }
    }
}

@MainActor
private final class BackgroundPhotoDaemonFixture {
    static let shared = BackgroundPhotoDaemonFixture()
    private struct Configuration: Codable { let origin: URL; let runId: String }
    private struct Manifest: Codable {
        let record: NativeDeferredUploadRecord
        let checksum: String
        let originalHash: String
        let length: Int64
    }
    private let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private var manager: NativeBackgroundPhotoUpload?
    private var configuration: Configuration?
    private var manifest: Manifest?
    private var detached = false
    private var recovering = false

    func start() async {
        do {
            let configuration = try JSONDecoder().decode(Configuration.self,
                from: Data(contentsOf: directory.appendingPathComponent("fixture.json")))
            guard configuration.origin.absoluteString == "http://127.0.0.1:19759",
                  UUID(uuidString: configuration.runId) != nil else { throw URLError(.badURL) }
            self.configuration = configuration
            let file = directory.appendingPathComponent("original.bin")
            let stored = directory.appendingPathComponent("manifest.json")
            let manifest: Manifest
            if FileManager.default.fileExists(atPath: stored.path) {
                manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: stored))
            } else {
                let block = Data((0..<256).map { UInt8($0) })
                var bytes = Data()
                bytes.reserveCapacity(8 * 1024 * 1024)
                for _ in 0..<32_768 { bytes.append(block) }
                try bytes.write(to: file, options: .atomic)
                let digest = Data(SHA256.hash(data: bytes))
                let scope = try FileSyncOwnerScope(ownerId: "daemon-fixture-owner", url: configuration.origin)
                let root = "11111111-1111-4111-8111-111111111111"
                let authorization = try JSONDecoder().decode(NativeUploadAuthorization.self, from: JSONSerialization.data(withJSONObject: [
                    "id": "daemon-fixture-connection", "updatedAt": "2026-11-11T00:00:00Z",
                    "configuration": ["configurationVersion": 4, "name": "Isolated daemon fixture",
                        "deviceId": "daemon-fixture-device", "localRootId": root, "remoteFolderId": "daemon-fixture-cloud",
                        "sourceKind": "photos", "mode": "backup", "paused": false, "propagateDeletes": false,
                        "network": "any", "chargingOnly": false, "excludedPaths": [String](),
                        "photoAutomation": ["notificationIntervalMs": 1_800_000, "uploadBytesPerSecond": 8_388_608]],
                    "scope": ["ownerId": scope.ownerId, "origin": configuration.origin.absoluteString,
                        "dataPlane": "home", "rootId": "daemon-fixture-connection", "deviceId": "daemon-fixture-device"]
                ]))
                let fingerprint = MobileFolderReader.Fingerprint(partSizeBytes: 8 * 1024 * 1024, partCount: 1,
                    sha256: SHA256.hash(data: digest).map { String(format: "%02x", $0) }.joined())
                let source = MobileFolderReader.Entry(path: String(repeating: "a", count: 64) + "-0-original.bin",
                    id: "original", version: configuration.runId, kind: "file", size: Int64(bytes.count),
                    sha256: nil, fingerprint: fingerprint)
                let request = NativeUploadFileRequest(source: source, uploadId: "daemon-fixture-upload",
                    requestId: configuration.runId, authorization: authorization)
                let record = NativeDeferredUploadRecord(scope: scope, request: request,
                    grantRevision: String(repeating: "a", count: 64), admissionId: "daemon-fixture-admission",
                    expiresAt: Date(timeIntervalSinceNow: 600))
                try record.validate()
                manifest = .init(record: record, checksum: digest.base64EncodedString(),
                    originalHash: digest.map { String(format: "%02x", $0) }.joined(), length: Int64(bytes.count))
                try JSONEncoder().encode(manifest).write(to: stored, options: .atomic)
            }
            self.manifest = manifest
            var failedTerminalWrite = false
            let failureMarker = directory.appendingPathComponent("terminal-write-failed")
            let manager = NativeBackgroundPhotoUpload(directory: directory,
                sessionPrefix: (Bundle.main.bundleIdentifier ?? "fixture") + "." + configuration.runId,
                liveRecord: { $0.matches(manifest.record) && $0.expiresAt > Date() }, beforeWrite: { data in
                    let row = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    if !failedTerminalWrite, row?["succeeded"] as? Bool == true {
                        failedTerminalWrite = true
                        try Data("one terminal write refused".utf8).write(to: failureMarker, options: .atomic)
                        throw CocoaError(.fileWriteUnknown)
                    }
                })
            self.manager = manager
            let ticket = try await manager.prepare(record: manifest.record, part: 1, checksum: manifest.checksum,
                length: manifest.length, file: file, transport: .init(expiry: manifest.record.expiresAt))
            let request = uploadRequest(configuration, manifest)
            let waiter = Task { try await manager.send(ticket, request: request, rate: 8_388_608) }
            try await Task.sleep(for: .seconds(2))
            waiter.cancel()
            do {
                _ = try await waiter.value
                throw URLError(.cannotParseResponse)
            } catch is CancellationError {
                detached = true
                try status("detached")
            }
        } catch { report(error) }
    }

    func recover() async {
        guard detached, !recovering, let manager, let configuration, let manifest else { return }
        recovering = true
        defer { recovering = false }
        do {
            let ticket = try await manager.prepare(record: manifest.record, part: 1, checksum: manifest.checksum,
                length: manifest.length, file: directory.appendingPathComponent("original.bin"),
                transport: .init(expiry: manifest.record.expiresAt))
            let result = try await manager.send(ticket, request: uploadRequest(configuration, manifest), rate: 8_388_608)
            let (data, response) = try await URLSession.shared.data(from: configuration.origin.appendingPathComponent("receipt"))
            let receipt = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  receipt?["sha256"] as? String == manifest.originalHash,
                  receipt?["bytes"] as? Int64 == manifest.length,
                  receipt?["requests"] as? Int == 1, result.sent == manifest.length else {
                throw URLError(.cannotParseResponse)
            }
            guard FileManager.default.fileExists(atPath: directory.appendingPathComponent("terminal-write-failed").path) else {
                throw URLError(.cannotParseResponse)
            }
            try manager.markAccounted(ticket)
            try status("verified")
            detached = false
        } catch { report(error) }
    }

    func handleEvents(_ identifier: String, completion: @escaping () -> Void) -> Bool {
        manager?.handleEvents(identifier: identifier, completion: completion) ?? false
    }

    private func uploadRequest(_ configuration: Configuration, _ manifest: Manifest) -> URLRequest {
        var request = URLRequest(url: configuration.origin.appendingPathComponent("part").appendingPathComponent(configuration.runId))
        request.httpMethod = "PUT"
        request.setValue(String(manifest.length), forHTTPHeaderField: "Content-Length")
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(manifest.checksum, forHTTPHeaderField: "x-amz-checksum-sha256")
        return request
    }

    private func status(_ stage: String) throws {
        try JSONSerialization.data(withJSONObject: ["stage": stage, "at": Date().timeIntervalSince1970,
            "bytes": manifest?.length ?? 0, "sha256": manifest?.originalHash ?? ""])
            .write(to: directory.appendingPathComponent("status.json"), options: .atomic)
    }

    private func report(_ error: Error) {
        let failure = error as NSError
        try? JSONSerialization.data(withJSONObject: ["stage": "failed", "domain": failure.domain, "code": failure.code])
            .write(to: directory.appendingPathComponent("status.json"), options: .atomic)
    }
}
#endif
