import Foundation

/// Fixed-length binary stdin after bounded JSON metadata. Only the signed bridge
/// exposes this pull source to XPC; no path, URL or credentials are accepted here.
public final class NodeFolderStreamInput: NSObject, ThingtimeNodeByteSource, @unchecked Sendable {
    private let handle: FileHandle
    private let length: Int
    private let lock = NSLock()
    private var offset = 0
    private var failed = false
    public init(handle: FileHandle, length: Int) throws {
        guard length > 0, length <= 32 * 1024 * 1024 else { throw ThingtimeNodeError.invalidRequest("Invalid stream length.") }
        self.handle = handle; self.length = length
    }
    private static func exact(_ handle: FileHandle, _ count: Int) throws -> Data {
        var result = Data()
        while result.count < count {
            guard let part = try handle.read(upToCount: count - result.count), !part.isEmpty else {
                throw ThingtimeNodeError.invalidRequest("Incomplete folder stream.")
            }
            result.append(part)
        }
        return result
    }
    public static func header(_ handle: FileHandle) throws -> Data? {
        guard let first = try handle.read(upToCount: 1), !first.isEmpty else { return nil }
        let prefix = first + (try exact(handle, 3))
        let length = prefix.reduce(0) { ($0 << 8) | Int($1) }
        guard length > 0, length <= 131_072 else { throw ThingtimeNodeError.invalidRequest("Invalid stream header.") }
        return try exact(handle, length)
    }
    public func next(offset expected: Int64, length wanted: Int) throws -> Data {
        lock.lock(); defer { lock.unlock() }
        guard !failed, expected == Int64(offset), wanted > 0, wanted <= 65_536, wanted <= length - offset else {
            failed = true; throw ThingtimeNodeError.invalidRequest("Invalid stream range.")
        }
        do {
            let bytes = try Self.exact(handle, wanted); offset += bytes.count; return bytes
        } catch { failed = true; throw error }
    }
    public func read(_ offset: Int64, length: Int, withReply reply: @escaping (Data) -> Void) {
        reply((try? next(offset: offset, length: length)) ?? Data())
    }
}
