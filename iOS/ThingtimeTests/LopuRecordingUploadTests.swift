import AVFoundation
import CryptoKit
import XCTest
@testable import Thingtime

@MainActor
final class LopuRecordingUploadTests: XCTestCase {
    private let context = LopuRecordingUploads.Context(ownerId: "owner-a", origin: URL(string: "https://thingtime.com")!)

    private func audio() throws -> (URL, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("Lopu-test.caf")
        let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1)!
        var file: AVAudioFile? = try AVAudioFile(forWriting: url, settings: format.settings)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16000)!
        buffer.frameLength = 16000
        for i in 0..<16000 { buffer.floatChannelData![0][i] = Float(sin(Double(i) * 0.2) * 0.1) }
        try file!.write(from: buffer)
        file = nil
        return (directory, url)
    }

    private func response(_ request: URLRequest, _ body: [String: Any], status: Int = 200) throws -> (Data, HTTPURLResponse) {
        (try JSONSerialization.data(withJSONObject: body), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    private var manifest: [String: Any] {
        ["schemaVersion": 1, "origin": context.origin.absoluteString, "features": [
            "api.things": ["version": "1.7.0"], "api.auth-me": ["version": "1.0.0"], "api.attachment-uploads": ["version": "1.2.0"],
            "api.attachment-upload-parts": ["version": "1.1.0"], "api.attachment-upload-complete": ["version": "1.2.0"]]]
    }

    func testM4AExportPreservesPlayableCapturedAudio() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        let result = try await LopuRecordingUploads.exportAudio(source)
        XCTAssertEqual(result.pathExtension, "m4a")
        let file = try AVAudioFile(forReading: result)
        XCTAssertGreaterThan(file.length, 0)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
        let data = try Data(contentsOf: result)
        let replay = try await LopuRecordingUploads.exportAudio(source)
        XCTAssertEqual(replay, result)
        XCTAssertEqual(try Data(contentsOf: result), data, "Retries must reuse byte-identical export metadata")
    }

    func testCompletionRetrySurvivesRelaunchWithoutSendingAudioAgain() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        var starts = 0, puts = 0, completions = 0
        let transport: LopuRecordingUploads.Transport = { request in
            let path = request.url!.path
            if request.httpMethod == "PUT" {
                puts += 1
                XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-amz-checksum-sha256"), Data(SHA256.hash(data: request.httpBody!)).base64EncodedString())
                return try self.response(request, [:])
            }
            switch path {
            case LopuVoiceContract.manifestPath: return try self.response(request, self.manifest)
            case "/api/v1/auth/me": return try self.response(request, ["user": ["id": "owner-a"]])
            case "/api/v1/attachments/uploads":
                starts += 1
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                XCTAssertEqual(body["purpose"] as? String, "recording")
                XCTAssertEqual(body["contentType"] as? String, "audio/mp4")
                return try self.response(request, ["ok": true, "upload": ["id": "att_test", "partSizeBytes": 8388608, "partCount": 1]])
            case "/api/v1/attachments/uploads/parts":
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                let part = (body["parts"] as! [[String: Any]])[0]
                return try self.response(request, ["ok": true, "parts": [["partNumber": 1, "url": "https://bucket.s3.amazonaws.com/object", "headers": ["x-amz-checksum-sha256": part["checksumSha256"]!]]]])
            case "/api/v1/attachments/uploads/complete":
                completions += 1
                if completions == 1 { throw URLError(.networkConnectionLost) }
                return try self.response(request, ["ok": true, "attachment": ["id": "att_test"]])
            default: XCTFail("Unexpected endpoint \(path)"); throw LopuRecordingUploads.UploadError.failed
            }
        }
        let uploader = LopuRecordingUploads(directory: directory, transport: transport)
        try uploader.enqueue(source: source, context: context)
        var entry = try XCTUnwrap(uploader.pending().first)
        do { _ = try await uploader.upload(&entry, cookie: "captured-test-cookie"); XCTFail("Expected interrupted completion") } catch {}
        let restarted = LopuRecordingUploads(directory: directory, transport: transport)
        var recovered = try XCTUnwrap(restarted.pending().first)
        XCTAssertTrue(recovered.partsSent)
        let receipt = try await restarted.upload(&recovered, cookie: "fresh-test-cookie")
        XCTAssertEqual(receipt, "att_test")
        XCTAssertEqual(starts, 1); XCTAssertEqual(puts, 1); XCTAssertEqual(completions, 2)
        let stored = try Data(contentsOf: directory.appendingPathComponent(".uploads/\(entry.id).json"))
        XCTAssertFalse(String(decoding: stored, as: UTF8.self).contains("cookie"))
    }

    func testDifferentAccountCannotReserveOrUploadAnEarlierRecording() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        var writes = 0
        let uploader = LopuRecordingUploads(directory: directory) { request in
            if request.httpMethod == "POST" || request.httpMethod == "PUT" { writes += 1 }
            return try self.response(request, request.url!.path == LopuVoiceContract.manifestPath ? self.manifest : ["user": ["id": "owner-b"]])
        }
        try uploader.enqueue(source: source, context: context)
        var entry = try XCTUnwrap(uploader.pending().first)
        do { _ = try await uploader.upload(&entry, cookie: "other-account"); XCTFail("Must reject owner mismatch") }
        catch LopuRecordingUploads.UploadError.wrongAccount {}
        XCTAssertEqual(writes, 0)
        XCTAssertEqual(uploader.pending().count, 1)
    }

    func testOldServerContractCannotReceiveRecording() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        var paths: [String] = []
        let uploader = LopuRecordingUploads(directory: directory) { request in
            paths.append(request.url!.path)
            var manifest = self.manifest
            manifest["features"] = ["api.auth-me": ["version": "1.0.0"], "api.attachment-uploads": ["version": "1.1.0"]]
            return try self.response(request, manifest)
        }
        try uploader.enqueue(source: source, context: context)
        var entry = try XCTUnwrap(uploader.pending().first)
        do { _ = try await uploader.upload(&entry, cookie: "session"); XCTFail("Must negotiate durable recording support") }
        catch LopuRecordingUploads.UploadError.incompatible {}
        XCTAssertEqual(paths, [LopuVoiceContract.manifestPath])
    }
    func testPresignedURLCannotSendAudioToAnUnrelatedHost() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        var puts = 0
        let uploader = LopuRecordingUploads(directory: directory) { request in
            if request.httpMethod == "PUT" { puts += 1 }
            switch request.url!.path {
            case LopuVoiceContract.manifestPath: return try self.response(request, self.manifest)
            case "/api/v1/auth/me": return try self.response(request, ["user": ["id": "owner-a"]])
            case "/api/v1/attachments/uploads":
                return try self.response(request, ["upload": ["id": "att_test", "partSizeBytes": 8388608, "partCount": 1]])
            case "/api/v1/attachments/uploads/parts":
                let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
                let part = (body["parts"] as! [[String: Any]])[0]
                return try self.response(request, ["parts": [["partNumber": 1, "url": "https://amazonaws.com.attacker.invalid/object", "headers": ["x-amz-checksum-sha256": part["checksumSha256"]!]]]])
            default: XCTFail("Unexpected request"); throw LopuRecordingUploads.UploadError.failed
            }
        }
        try uploader.enqueue(source: source, context: context)
        var entry = try XCTUnwrap(uploader.pending().first)
        do { _ = try await uploader.upload(&entry, cookie: "session"); XCTFail("Must reject unrelated host") }
        catch LopuRecordingUploads.UploadError.unsafeUpload {}
        XCTAssertEqual(puts, 0)
        XCTAssertEqual(uploader.pending().count, 1)
    }

    func testLegacyImportClaimsOnceAndKeepsOriginalAccount() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport: LopuRecordingUploads.Transport = { request in
            switch request.url!.path {
            case LopuVoiceContract.manifestPath: return try self.response(request, self.manifest)
            case "/api/v1/auth/me": return try self.response(request, ["user": ["id": "owner-a"]])
            case "/api/v1/things": return try self.response(request, ["things": [], "nextCursor": NSNull()])
            default: XCTFail("Import inventory must only read"); throw LopuRecordingUploads.UploadError.failed
            }
        }
        let uploader = LopuRecordingUploads(directory: directory, transport: transport)
        try await uploader.importLegacy(context: context, cookie: "session")
        let first = try XCTUnwrap(uploader.pending().first)
        XCTAssertEqual(first.sourceName, source.lastPathComponent)
        let restarted = LopuRecordingUploads(directory: directory, transport: transport)
        try await restarted.importLegacy(context: .init(ownerId: "owner-b", origin: context.origin), cookie: "other")
        XCTAssertEqual(restarted.inventory().count, 1)
        XCTAssertEqual(restarted.pending().first?.id, first.id)
        XCTAssertEqual(restarted.pending().first?.context.ownerId, "owner-a")
    }

    func testLegacyImportReconcilesBuild29AcrossPagesAndRetainsReceipt() async throws {
        let (directory, source) = try audio()
        defer { try? FileManager.default.removeItem(at: directory) }
        let encoded = try await LopuRecordingUploads.exportAudio(source)
        let size = try encoded.resourceValues(forKeys: [.fileSizeKey]).fileSize!
        var pages = 0
        let transport: LopuRecordingUploads.Transport = { request in
            switch request.url!.path {
            case LopuVoiceContract.manifestPath: return try self.response(request, self.manifest)
            case "/api/v1/auth/me": return try self.response(request, ["user": ["id": "owner-a"]])
            case "/api/v1/things":
                pages += 1
                if pages == 1 { return try self.response(request, ["things": [], "nextCursor": "next"]) }
                XCTAssertTrue(request.url!.query!.contains("cursor=next"))
                return try self.response(request, ["things": [["id": "existing", "crystal": ["name": encoded.lastPathComponent, "size": size]]], "nextCursor": NSNull()])
            default: XCTFail("Must reuse ready Things"); throw LopuRecordingUploads.UploadError.failed
            }
        }
        let uploader = LopuRecordingUploads(directory: directory, transport: transport)
        try await uploader.importLegacy(context: context, cookie: "session")
        XCTAssertTrue(uploader.pending().isEmpty)
        XCTAssertEqual(uploader.inventory().first?.completedAttachmentId, "existing")
        let restarted = LopuRecordingUploads(directory: directory, transport: transport)
        try await restarted.importLegacy(context: context, cookie: "session")
        XCTAssertEqual(pages, 2)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }

    func testLegacyImportExcludesNewActiveFilesAndRetainsFilesAfterFailure() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var requests = 0
        let uploader = LopuRecordingUploads(directory: directory) { _ in requests += 1; throw URLError(.notConnectedToInternet) }
        let file = directory.appendingPathComponent("Lopu-active.caf")
        try Data([1, 2, 3]).write(to: file)
        try await uploader.importLegacy(context: context, cookie: "session")
        XCTAssertEqual(requests, 0)
        let restarted = LopuRecordingUploads(directory: directory) { _ in throw URLError(.notConnectedToInternet) }
        do { try await restarted.importLegacy(context: context, cookie: "session"); XCTFail("Expected offline") } catch {}
        XCTAssertTrue(restarted.inventory().isEmpty)
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    }

    func testNativePushNegotiatesOwnerGuardAndRejectsIncompatibleOrigins() {
        var manifest: [String: Any] = ["schemaVersion": 1, "origin": context.origin.absoluteString,
            "features": ["api.auth-me": ["version": "1.0.0"], "api.notifications-devices": ["version": "1.2.0"]]]
        XCTAssertTrue(ThingtimeNativeNotifications.supportsPushManifest(manifest, origin: context.origin))
        for version in ["1.1.9", "2.0.0", "1.2.0-preview", ""] {
            manifest["features"] = ["api.auth-me": ["version": "1.0.0"], "api.notifications-devices": ["version": version]]
            XCTAssertFalse(ThingtimeNativeNotifications.supportsPushManifest(manifest, origin: context.origin))
        }
        manifest["features"] = ["api.auth-me": ["version": "1.0.1"], "api.notifications-devices": ["version": "1.3.0"]]
        XCTAssertTrue(ThingtimeNativeNotifications.supportsPushManifest(manifest, origin: context.origin))
        XCTAssertFalse(ThingtimeNativeNotifications.supportsPushManifest(manifest, origin: URL(string: "https://other.test")!))
    }

}
