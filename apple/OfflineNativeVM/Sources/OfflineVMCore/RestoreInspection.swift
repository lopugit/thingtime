import Foundation
import Darwin

public struct SafePlatformError: Codable, Equatable {
    public let domain: String
    public let code: Int
    public static func chain(_ error: Error) -> [SafePlatformError] {
        let allowed: Set<String> = ["VZErrorDomain", "NSPOSIXErrorDomain", "NSOSStatusErrorDomain", "NSCocoaErrorDomain", "NSMachErrorDomain"]
        var current: NSError? = error as NSError
        var result: [SafePlatformError] = []
        // Only fixed domains and numeric codes; never arbitrary userInfo/descriptions/paths.
        while let value = current, result.count < 4 {
            result.append(SafePlatformError(domain: allowed.contains(value.domain) ? value.domain : "other", code: value.code))
            current = value.userInfo[NSUnderlyingErrorKey] as? NSError
        }
        return result
    }
}
public struct RestoreInspectionReceipt: Codable {
    public let contractVersion: String
    public let operation: String
    public let operatingSystem: String
    public let build: String
    public let supportedHardwareModelFound: Bool
    public let fileBytes: Int64
    public let guestStarted: Bool
    public let artifactsCreated: Bool
    public let installed: Bool
}
public enum RestoreInspection {
    public static func perform(path: URL, backend: FreshPreparationBackend) throws -> RestoreInspectionReceipt {
        guard path.isFileURL, path.path.hasPrefix("/"), path.pathExtension.lowercased() == "ipsw" else { throw VMFailure.arguments }
        var before = stat()
        guard lstat(path.path, &before) == 0, before.st_mode & S_IFMT == S_IFREG,
              before.st_uid == geteuid(), before.st_nlink == 1, before.st_size > 0 else { throw VMFailure.ownership }
        let fd = open(path.path, O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC)
        guard fd >= 0 else { throw VMFailure.path }; defer { close(fd) }
        var initial = stat()
        guard fstat(fd, &initial) == 0, initial.st_mode & S_IFMT == S_IFREG, initial.st_nlink == 1,
              initial.st_uid == geteuid(), initial.st_size > 0, initial.st_dev == before.st_dev, initial.st_ino == before.st_ino else { throw VMFailure.ownership }
        // Public Apple restore media need not be private. Unlike writable task inputs,
        // inspection neither adopts nor modifies this existing file or its parent.
        let metadata = try backend.hardwareModel(restoreImage: path)
        var after = stat(); var named = stat()
        guard fstat(fd, &after) == 0, lstat(path.path, &named) == 0,
              initial.st_dev == after.st_dev, initial.st_ino == after.st_ino,
              named.st_dev == initial.st_dev, named.st_ino == initial.st_ino,
              initial.st_size == after.st_size, after.st_nlink == 1,
              initial.st_mtimespec.tv_sec == after.st_mtimespec.tv_sec,
              initial.st_mtimespec.tv_nsec == after.st_mtimespec.tv_nsec,
              initial.st_ctimespec.tv_sec == after.st_ctimespec.tv_sec,
              initial.st_ctimespec.tv_nsec == after.st_ctimespec.tv_nsec else { throw VMFailure.integrity }
        return RestoreInspectionReceipt(contractVersion: Contract.version, operation: "inspect-restore", operatingSystem: metadata.operatingSystem,
            build: metadata.build, supportedHardwareModelFound: !metadata.hardware.isEmpty, fileBytes: initial.st_size,
            guestStarted: false, artifactsCreated: false, installed: false)
    }
}
