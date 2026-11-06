import Foundation
import Darwin

/// An additional persisted fence for reconnect recovery, never an OS grant or
/// a replacement for descriptor-relative access. Unknown filesystems fail closed.
enum NativeFilesystemContinuity {
    static func identity(_ fd: Int32) throws -> String? {
        let before = try MobileFolderReader.info(fd)
        var filesystem = statfs()
        guard fstatfs(fd, &filesystem) == 0 else { return nil }
        let path = withUnsafePointer(to: &filesystem.f_mntonname) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) { String(cString: $0) }
        }
        var volume = stat()
        guard stat(path, &volume) == 0, volume.st_dev == before.st_dev else { return nil }
        let values = try? URL(fileURLWithPath: path, isDirectory: true).resourceValues(forKeys: [.volumeUUIDStringKey])
        guard let uuid = values?.volumeUUIDString else { return nil }
        let after = try MobileFolderReader.info(fd)
        guard before.st_dev == after.st_dev, before.st_ino == after.st_ino,
              before.st_birthtimespec.tv_sec == after.st_birthtimespec.tv_sec,
              before.st_birthtimespec.tv_nsec == after.st_birthtimespec.tv_nsec else { throw MobileFolderStore.Failure.changed }
        return "\(uuid.lowercased()):\(before.st_ino):\(before.st_birthtimespec.tv_sec):\(before.st_birthtimespec.tv_nsec)"
    }
}
