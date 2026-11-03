@testable import AppleFileSync
import Darwin
import XCTest

final class NativeFileDestinationTests: XCTestCase {
    private func fixture() throws -> (URL, Int32) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("rename-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let fd = open(root.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        XCTAssertGreaterThanOrEqual(fd, 0)
        addTeardownBlock { close(fd); try? FileManager.default.removeItem(at: root) }
        return (root, fd)
    }
    func testLegacyKernelRetryRetainsNoFollowAndAtomicExclusionOrSwap() throws {
        for mode in [RENAME_EXCL, RENAME_SWAP] {
            let (root, fd) = try fixture()
            try Data("new".utf8).write(to: root.appendingPathComponent("source"))
            if mode == RENAME_SWAP { try Data("old".utf8).write(to: root.appendingPathComponent("target")) }
            var calls: [UInt32] = []
            try NativeFileDestination.rename(fd, "source", fd, "target", flags: UInt32(mode)) { a, b, c, d, flags in
                calls.append(flags)
                if flags & UInt32(RENAME_RESOLVE_BENEATH) != 0 { errno = EINVAL; return -1 }
                return renameatx_np(a, b, c, d, flags)
            }
            XCTAssertEqual(calls, [UInt32(mode | RENAME_NOFOLLOW_ANY | RENAME_RESOLVE_BENEATH), UInt32(mode | RENAME_NOFOLLOW_ANY)])
            XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("target")), Data("new".utf8))
            if mode == RENAME_SWAP { XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("source")), Data("old".utf8)) }
        }
    }
    func testOtherSyscallFailuresNeverRetry() throws {
        let (_, fd) = try fixture()
        for failure in [EACCES, EEXIST, ELOOP, ENOENT, EXDEV] {
            var calls = 0
            XCTAssertThrowsError(try NativeFileDestination.rename(fd, "source", fd, "target", flags: UInt32(RENAME_EXCL)) { _, _, _, _, _ in
                calls += 1; errno = failure; return -1
            })
            XCTAssertEqual(calls, 1)
        }
    }
    func testInvalidOrUnanchoredPathsNeverReachTheKernel() throws {
        let (_, fd) = try fixture()
        for path in ["/absolute", "../escape", "nested/../escape", "a//b", "a/./b", ""] {
            var calls = 0
            let syscall: (Int32, String, Int32, String, UInt32) -> Int32 = { _, _, _, _, _ in calls += 1; return 0 }
            XCTAssertThrowsError(try NativeFileDestination.rename(fd, path, fd, "target", flags: UInt32(RENAME_EXCL), syscall: syscall))
            XCTAssertThrowsError(try NativeFileDestination.rename(fd, "source", fd, path, flags: UInt32(RENAME_EXCL), syscall: syscall))
            XCTAssertEqual(calls, 0)
        }
        XCTAssertThrowsError(try NativeFileDestination.rename(AT_FDCWD, "source", fd, "target", flags: UInt32(RENAME_EXCL)))
        XCTAssertThrowsError(try NativeFileDestination.rename(fd, "source", fd, "target", flags: 0))
    }
    func testLegacyRetryRefusesSymlinkTraversalAndOccupiedDestination() throws {
        let (root, fd) = try fixture(), (outside, _) = try fixture()
        try Data("source".utf8).write(to: root.appendingPathComponent("source"))
        try Data("outside".utf8).write(to: outside.appendingPathComponent("target"))
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("link"), withDestinationURL: outside)
        let legacy: (Int32, String, Int32, String, UInt32) -> Int32 = { a, b, c, d, flags in
            if flags & UInt32(RENAME_RESOLVE_BENEATH) != 0 { errno = EINVAL; return -1 }
            return renameatx_np(a, b, c, d, flags)
        }
        XCTAssertThrowsError(try NativeFileDestination.rename(fd, "source", fd, "link/target", flags: UInt32(RENAME_EXCL), syscall: legacy))
        XCTAssertEqual(try Data(contentsOf: outside.appendingPathComponent("target")), Data("outside".utf8))
        try Data("existing".utf8).write(to: root.appendingPathComponent("target"))
        XCTAssertThrowsError(try NativeFileDestination.rename(fd, "source", fd, "target", flags: UInt32(RENAME_EXCL), syscall: legacy))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("source")), Data("source".utf8))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("target")), Data("existing".utf8))
    }
    func testMutationBetweenLegacyAttemptAndRetryStillFailsContentVerification() throws {
        let (root, fd) = try fixture()
        let source = root.appendingPathComponent("source")
        try Data("original".utf8).write(to: source)
        let expected = try XCTUnwrap(MobileFolderReader.scan(bookmark: FolderBookmark.create(root)).first)
        try NativeFileDestination.rename(fd, "source", fd, "target", flags: UInt32(RENAME_EXCL)) { a, b, c, d, flags in
            if flags & UInt32(RENAME_RESOLVE_BENEATH) != 0 {
                do { try Data("mutation".utf8).write(to: source) } catch { XCTFail("Could not mutate isolated fixture") }
                errno = EINVAL; return -1
            }
            return renameatx_np(a, b, c, d, flags)
        }
        let target = openat(fd, "target", O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
        XCTAssertGreaterThanOrEqual(target, 0); defer { close(target) }
        XCTAssertThrowsError(try NativeFileDestination.verifyContent(target, source: expected))
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("target")), Data("mutation".utf8))
    }
}
