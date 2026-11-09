import Darwin
import Foundation
import XCTest
@testable import Thingtime

final class LiDARUploadMemoryTests: XCTestCase {
    func testFingerprintAndStageKeepMemoryBoundedForLargeArchive() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false)
        defer { try? FileManager.default.removeItem(at: directory) }
        let archive = directory.appendingPathComponent("scan.tar")
        XCTAssertTrue(FileManager.default.createFile(atPath: archive.path, contents: nil))
        let size: Int64 = 192 * 1_048_576
        let writer = try FileHandle(forWritingTo: archive)
        try writer.truncate(atOffset: UInt64(size))
        try writer.close()
        let capture = LiDARCapture(id: UUID(), archiveURL: archive, startedAt: Date(), finishedAt: Date(),
                                   frameCount: 1, byteCount: size, isPartial: true, statusDetail: nil)

        let baseline = try Self.residentBytes()
        let sample = Task.detached {
            var peak = baseline
            while !Task.isCancelled {
                peak = max(peak, try Self.residentBytes())
                try? await Task.sleep(for: .milliseconds(2))
            }
            return peak
        }
        defer { sample.cancel() }

        // The fixture is sparse and tests byte streaming. Seal validation is
        // covered separately by tests that build and corrupt actual TAR files.
        let plan = try await LiDARUploadArchive.inspect(capture, verifySeal: false)
        XCTAssertGreaterThan(plan.fingerprint.partCount, 1)
        let part = try await plan.part(1, capture: capture)
        defer { part.discard() }
        XCTAssertEqual(part.length, plan.fingerprint.partSizeBytes)

        sample.cancel()
        let peak = try await sample.value
        XCTAssertLessThan(peak - baseline, 80 * 1_048_576,
                          "Autoreleased FileHandle chunks accumulated across the archive")
    }

    private static func residentBytes() throws -> UInt64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
        let status = withUnsafeMutablePointer(to: &info) { pointer in
            pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        guard status == KERN_SUCCESS else { throw CocoaError(.fileReadUnknown) }
        return info.resident_size
    }
}
