import AppleFileSync
import Foundation

enum MacUploadBatchOperation {
    typealias Callback = @Sendable (JSONValue, TimeInterval) async throws -> JSONValue
    struct Outcome: Sendable { let ordinal: Int; let result: JSONValue; let uploadId: String?; let payload: JSONValue? }
    static let failureCodes: Set<String> = ["conflict", "temporarily-unavailable", "authority-changed", "invalid-member", "source-changed", "cancelled", "deadline"]
    private static func validVersion(_ value: String) -> Bool { value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) } }
    static func failure(_ ordinal: Int, _ code: String) -> JSONValue {
        .object(["ordinal": .number(Double(ordinal)), "status": .string("failed"), "statusCode": .number(code == "source-changed" ? 409 : 503),
                 "code": .string(code), "retryable": .bool(["temporarily-unavailable", "deadline"].contains(code))])
    }
    private static func read(_ bookmark: Data, _ member: MacUploadBatchDescriptor.Member, _ sha: String? = nil) async throws -> MobileFolderBulkReader.Payload {
        let resources = MacSyncResources.current
        let task = Task.detached {
            try resources?.source.checkpoint()
            let value: MobileFolderBulkReader.Payload
            if let resources { value = try SyncResourceCpuContext.$current.withValue(resources.source) { try resources.source.measure { try MobileFolderBulkReader.read(bookmark: bookmark, expected: member.source, sha256: sha) } } }
            else { value = try MobileFolderBulkReader.read(bookmark: bookmark, expected: member.source, sha256: sha) }
            try resources?.source.checkpoint(); return value
        }
        return try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { task.cancel() })
    }

    static func run(_ batch: MacUploadBatchDescriptor, started: TimeInterval, bookmark: Data,
                    check: @escaping @Sendable () async throws -> Void, callback: @escaping Callback) async throws -> JSONValue {
        let governedPayload = batch.resourceLimits?.uploadBytesPerSecond != nil || batch.resourceLimits?.cpuPercent != nil
        func remaining() throws -> TimeInterval {
            try Task.checkCancellation()
            let left = governedPayload ? TimeInterval.infinity : 180 - (ProcessInfo.processInfo.systemUptime - started)
            guard left > 0 else { throw CancellationError() }; return left
        }
        func call(_ value: JSONValue, seconds: TimeInterval) async throws -> JSONValue {
            try await check()
            let reply: JSONValue
            if seconds == .infinity {
                let payload = Task { try await callback(value, remaining()) }
                // A long paced body retains the same short local grant/device/
                // source-policy checks. Only this payload task can be cancelled.
                let authority = Task {
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(1)); try await check() }
                        catch { payload.cancel(); return }
                    }
                }
                defer { authority.cancel() }
                reply = try await withTaskCancellationHandler(operation: { try await payload.value }, onCancel: { payload.cancel() })
            } else { reply = try await callback(value, min(seconds, remaining())) }
            try await check(); _ = try remaining(); return reply
        }
        var digests: [Int: String] = [:], results: [Int: JSONValue] = [:]
        // Receipt-only lookup precedes ALL source IO. An accepted original
        // operation remains recoverable after its local source changed/deleted.
        let lookup = try await call(.object(["kind": .string("prepare-ready"), "checksums": .array([])]), seconds: 60)
        let lookupRows = try BatchJSON.array(BatchJSON.required(BatchJSON.object(lookup, keys: ["results"]), "results"))
        guard lookupRows.count == batch.members.count else { throw MobileFolderStore.Failure.invalid }
        var required: [MacUploadBatchDescriptor.Member] = []
        for (index, value) in lookupRows.enumerated() {
            let row = try BatchJSON.object(value, keys: ["ordinal", "status", "content", "statusCode", "code", "retryable"])
            guard row["ordinal"] == .number(Double(index)) else { throw MobileFolderStore.Failure.invalid }
            switch try BatchJSON.string(row, "status") {
            case "confirmed": results[index] = .object(["ordinal": .number(Double(index)), "status": .string("confirmed")])
            case "verified": results[index] = value
            case "source-required": required.append(batch.members[index])
            case "failed":
                let code = try BatchJSON.string(row, "code")
                guard failureCodes.contains(code), code != "authority-changed" else { throw MobileFolderStore.Failure.changed }
                results[index] = value
            default: throw MobileFolderStore.Failure.invalid
            }
        }
        for member in required {
            try await check(); _ = try remaining()
            do { digests[member.ordinal] = try await read(bookmark, member).sha256 }
            catch is CancellationError { throw CancellationError() }
            catch { results[member.ordinal] = failure(member.ordinal, "source-changed") }
        }
        let checksums = digests.keys.sorted().map { JSONValue.object(["ordinal": .number(Double($0)), "sha256": .string(digests[$0]!)]) }
        let prepared = required.isEmpty ? lookup : try await call(.object(["kind": .string("prepare-ready"), "checksums": .array(checksums)]), seconds: 60)
        let preparedRows = try BatchJSON.array(BatchJSON.required(BatchJSON.object(prepared, keys: ["results"]), "results"))
        guard preparedRows.count == batch.members.count else { throw MobileFolderStore.Failure.invalid }
        var uploads: [Int: String] = [:]
        for (index, value) in preparedRows.enumerated() {
            let row = try BatchJSON.object(value, keys: ["ordinal", "status", "uploadId", "content", "statusCode", "code", "retryable"])
            guard row["ordinal"] == .number(Double(index)) else { throw MobileFolderStore.Failure.invalid }
            switch try BatchJSON.string(row, "status") {
            case "confirmed": results[index] = .object(["ordinal": .number(Double(index)), "status": .string("confirmed")])
            case "verified": results[index] = value
            case "source-required":
                guard digests[index] == nil else { throw MobileFolderStore.Failure.invalid }
                results[index] = failure(index, "source-changed")
            case "prepared":
                guard digests[index] != nil else { throw MobileFolderStore.Failure.invalid }
                uploads[index] = try BatchJSON.string(row, "uploadId"); results[index] = nil
            case "failed":
                let code = try BatchJSON.string(row, "code")
                guard failureCodes.contains(code), code != "authority-changed" else { throw MobileFolderStore.Failure.changed }
                results[index] = value
            default: throw MobileFolderStore.Failure.invalid
            }
        }
        let selected = batch.members.filter { uploads[$0.ordinal] != nil }
        let expectedDigests = digests, uploadIDs = uploads
        var payloads: [Int: JSONValue] = [:], verifyUploads: [Int: String] = [:]
        try await withThrowingTaskGroup(of: Outcome.self) { group in
            var next = 0
            func add(_ member: MacUploadBatchDescriptor.Member) {
                group.addTask {
                    try await check(); _ = try remaining()
                    guard governedPayload || ProcessInfo.processInfo.systemUptime - started < 30 else {
                        return Outcome(ordinal: member.ordinal, result: failure(member.ordinal, "deadline"), uploadId: nil, payload: nil)
                    }
                    let ordinal = member.ordinal, sha = expectedDigests[ordinal]!
                    let bytes: Data
                    do { bytes = try await read(bookmark, member, sha).bytes }
                    catch is CancellationError { throw CancellationError() }
                    catch { return Outcome(ordinal: ordinal, result: failure(ordinal, "source-changed"), uploadId: nil, payload: nil) }
                    for offset in stride(from: 0, to: bytes.count, by: 65_536) {
                        let end = min(offset + 65_536, bytes.count)
                        let ack = try await call(.object(["kind": .string("chunk"), "ordinal": .number(Double(ordinal)),
                            "offset": .number(Double(offset)), "data": .string(bytes.subdata(in: offset..<end).base64EncodedString())]), seconds: 5)
                        guard ack == .object(["accepted": .bool(true)]) else { throw MobileFolderStore.Failure.invalid }
                    }
                    try await check()
                    guard governedPayload || ProcessInfo.processInfo.systemUptime - started < 30 else {
                        return Outcome(ordinal: ordinal, result: failure(ordinal, "deadline"), uploadId: nil, payload: nil)
                    }
                    // Reopen and strongly verify AFTER emitting bytes, immediately
                    // before allowing the host to dispatch this exact PUT.
                    do { _ = try await read(bookmark, member, sha) }
                    catch is CancellationError { throw CancellationError() }
                    catch { return Outcome(ordinal: ordinal, result: failure(ordinal, "source-changed"), uploadId: nil, payload: nil) }
                    try await check()
                    guard governedPayload || ProcessInfo.processInfo.systemUptime - started < 30 else {
                        return Outcome(ordinal: ordinal, result: failure(ordinal, "deadline"), uploadId: nil, payload: nil)
                    }
                    let ack = try BatchJSON.object(await call(.object(["kind": .string("put-ready"), "ordinal": .number(Double(ordinal)), "sha256": .string(sha)]), seconds: governedPayload ? .infinity : 60), keys: ["status", "code", "payloadBytes"])
                    let status = try BatchJSON.string(ack, "status")
                    guard ["accepted", "unknown", "failed"].contains(status) else { throw MobileFolderStore.Failure.invalid }
                    if status == "failed" {
                        let code = try BatchJSON.string(ack, "code")
                        guard failureCodes.contains(code), code != "authority-changed" else { throw MobileFolderStore.Failure.changed }
                        return Outcome(ordinal: ordinal, result: failure(ordinal, code), uploadId: nil, payload: nil)
                    }
                    guard status != "accepted" || ack["payloadBytes"] == .number(Double(member.source.size)) else { throw MobileFolderStore.Failure.invalid }
                    let payload = JSONValue.object(["ordinal": .number(Double(ordinal)), "bytes": status == "accepted" ? .number(Double(member.source.size)) : .null])
                    do { _ = try await read(bookmark, member, sha) }
                    catch is CancellationError { throw CancellationError() }
                    catch { return Outcome(ordinal: ordinal, result: failure(ordinal, "source-changed"), uploadId: uploadIDs[ordinal], payload: payload) }
                    return Outcome(ordinal: ordinal, result: .null, uploadId: uploadIDs[ordinal], payload: payload)
                }
            }
            while next < min(batch.resourceLimits?.transferConcurrency ?? 16, 16, selected.count) { add(selected[next]); next += 1 }
            for try await outcome in group {
                results[outcome.ordinal] = outcome.result
                if let id = outcome.uploadId { verifyUploads[outcome.ordinal] = id }
                if let payload = outcome.payload { payloads[outcome.ordinal] = payload }
                if next < selected.count { add(selected[next]); next += 1 }
            }
        }
        if !verifyUploads.isEmpty {
            let values = verifyUploads.keys.sorted().map { JSONValue.object(["ordinal": .number(Double($0)), "uploadId": .string(verifyUploads[$0]!)]) }
            let verified = try await call(.object(["kind": .string("verify-ready"), "uploads": .array(values)]), seconds: 60)
            let rows = try BatchJSON.array(BatchJSON.required(BatchJSON.object(verified, keys: ["results"]), "results"))
            guard rows.count == verifyUploads.count else { throw MobileFolderStore.Failure.invalid }
            for (value, ordinal) in zip(rows, verifyUploads.keys.sorted()) {
                let row = try BatchJSON.object(value, keys: ["ordinal", "status", "content", "statusCode", "code", "retryable"])
                guard row["ordinal"] == .number(Double(ordinal)) else { throw MobileFolderStore.Failure.invalid }
                if row["status"] == .string("failed") {
                    let code = try BatchJSON.string(row, "code")
                    guard failureCodes.contains(code), code != "authority-changed" else { throw MobileFolderStore.Failure.changed }
                    if results[ordinal] == .null { results[ordinal] = value }; continue
                }
                guard row["status"] == .string("verified") else { throw MobileFolderStore.Failure.invalid }
                let content = try BatchJSON.object(BatchJSON.required(row, "content"), keys: ["ordinal", "uploadId", "version", "size", "fingerprint"])
                let member = batch.members[ordinal]
                guard content["ordinal"] == .number(Double(ordinal)), content["uploadId"] == .string(verifyUploads[ordinal]!),
                      content["size"] == .number(Double(member.source.size)), validVersion(try BatchJSON.string(content, "version")),
                      try JSONDecoder().decode(MobileFolderReader.Fingerprint.self, from: JSONEncoder().encode(BatchJSON.required(content, "fingerprint"))) == member.source.fingerprint else { throw MobileFolderStore.Failure.changed }
                if results[ordinal] == .null { results[ordinal] = value }
            }
        }
        // ALL final source reads happen after the last stored lookup callback,
        // including ready attachments recovered during receipt-only prepare.
        for member in batch.members {
            guard case .object(let result)? = results[member.ordinal], result["status"] == .string("verified") else { continue }
            let content = try BatchJSON.object(BatchJSON.required(result, "content"), keys: ["ordinal", "uploadId", "version", "size", "fingerprint"])
            guard content["ordinal"] == .number(Double(member.ordinal)), content["size"] == .number(Double(member.source.size)),
                  !(try BatchJSON.string(content, "uploadId")).isEmpty, validVersion(try BatchJSON.string(content, "version")),
                  try JSONDecoder().decode(MobileFolderReader.Fingerprint.self, from: JSONEncoder().encode(BatchJSON.required(content, "fingerprint"))) == member.source.fingerprint else { throw MobileFolderStore.Failure.changed }
            try await check()
            do { _ = try await read(bookmark, member, expectedDigests[member.ordinal]) }
            catch is CancellationError { throw CancellationError() }
            catch { results[member.ordinal] = failure(member.ordinal, "source-changed") }
        }
        try await check(); _ = try remaining()
        return .object(["ok": .bool(true), "version": .number(1), "batchId": .string(batch.batchId), "digest": .string(batch.digest),
                        "results": .array(batch.members.map { results[$0.ordinal] ?? failure($0.ordinal, "temporarily-unavailable") }),
                        "payloads": .array(batch.members.map { payloads[$0.ordinal] ?? .object(["ordinal": .number(Double($0.ordinal)), "bytes": .number(0)]) })])
    }
}
