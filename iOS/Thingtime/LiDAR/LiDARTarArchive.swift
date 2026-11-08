import Foundation

/// A seekable POSIX ustar stream. A scan can grow past 4 GiB without staging
/// duplicate copies. Each entry is one frame plane, geometry buffer or record.
final class LiDARTarArchive {
    enum ArchiveError: LocalizedError {
        case invalidEntry
        case missingCaptureHeader
        case noWritableArchive
        case alreadyRecording

        var errorDescription: String? {
            switch self {
            case .invalidEntry: return "A scan data record could not be archived."
            case .missingCaptureHeader: return "The scan ended before its first record was saved."
            case .noWritableArchive: return "The device could not create the local scan."
            case .alreadyRecording: return "This scan is already open."
            }
        }
    }

    struct Entry {
        let path: String
        let size: UInt64
        let dataOffset: UInt64
        let nextOffset: UInt64
    }

    static let blockSize = 512
    private static let zeros = Data(repeating: 0, count: blockSize * 2)
    private let file: FileHandle
    private let timestamp: UInt64
    private(set) var offset: UInt64
    private(set) var committedOffset: UInt64

    init(url: URL, date: Date, offset: UInt64 = 0) throws {
        self.file = try FileHandle(forWritingTo: url)
        self.timestamp = UInt64(max(0, date.timeIntervalSince1970.rounded(.down)))
        self.offset = offset
        self.committedOffset = offset
        if offset > 0 {
            try file.truncate(atOffset: offset)
        }
        try file.seek(toOffset: offset)
    }

    deinit { try? file.close() }

    func entry(_ path: String, data: Data) throws {
        try entry(path, size: data.count) { try self.write(data) }
    }

    /// Writes a borrowed buffer synchronously. The producer keeps it alive
    /// and locked through this call; the archive never retains it.
    func entry(_ path: String, bytes: UnsafeRawPointer, count: Int) throws {
        try entry(path, size: count) {
            if count > 0 {
                try self.write(Data(bytesNoCopy: UnsafeMutableRawPointer(mutating: bytes), count: count, deallocator: .none))
            }
        }
    }

    func commit() { committedOffset = offset }

    func rollback() throws {
        try file.truncate(atOffset: committedOffset)
        try file.seek(toOffset: committedOffset)
        offset = committedOffset
    }

    func synchronize() throws { try file.synchronize() }

    func erase() throws {
        try file.truncate(atOffset: 0)
        try file.synchronize()
    }

    func finish() throws {
        try write(Self.zeros)
        try file.synchronize()
        try file.close()
    }

    private func write(_ data: Data) throws {
        try file.write(contentsOf: data)
        offset += UInt64(data.count)
    }

    private func entry(_ path: String, size: Int, body: () throws -> Void) throws {
        let name = Array(path.utf8)
        guard !name.isEmpty, name.count < 100, name.allSatisfy({ (32...126).contains($0) }),
              size >= 0, UInt64(size) <= 0o77777777777, timestamp <= 0o77777777777 else {
            throw ArchiveError.invalidEntry
        }
        var header = Data(repeating: 0, count: Self.blockSize)
        header.replaceSubrange(0..<name.count, with: name)
        Self.octal(0o600, width: 8, into: &header, at: 100)
        Self.octal(0, width: 8, into: &header, at: 108)
        Self.octal(0, width: 8, into: &header, at: 116)
        Self.octal(UInt64(size), width: 12, into: &header, at: 124)
        Self.octal(timestamp, width: 12, into: &header, at: 136)
        header.replaceSubrange(148..<156, with: repeatElement(UInt8(32), count: 8))
        header[156] = 48 // regular file
        header.replaceSubrange(257..<265, with: [117, 115, 116, 97, 114, 0, 48, 48]) // ustar\0, version 00
        let checksum = header.reduce(0) { $0 + UInt64($1) }
        Self.octal(checksum, width: 7, into: &header, at: 148)
        try write(header)
        try body()
        let padding = (Self.blockSize - size % Self.blockSize) % Self.blockSize
        if padding > 0 { try write(Self.zeros.prefix(padding)) }
    }

    private static func octal(_ value: UInt64, width: Int, into data: inout Data, at start: Int) {
        let digits = Array(String(value, radix: 8).utf8)
        let field = Array(repeating: UInt8(48), count: width - digits.count - 1) + digits + [0]
        data.replaceSubrange(start..<(start + width), with: field)
    }

    /// Recover only complete, checksum-valid headers whose payload and padding
    /// fit the actual file. The caller advances its checkpoint at each commit
    /// marker. Large raw payloads are never read into memory.
    static func nextEntry(in file: FileHandle, offset: UInt64, length: UInt64) throws -> Entry? {
        guard offset <= length, length - offset >= UInt64(blockSize) else { return nil }
        try file.seek(toOffset: offset)
        guard let header = try file.read(upToCount: blockSize), header.count == blockSize,
              header[257..<263].elementsEqual([117, 115, 116, 97, 114, 0]),
              header[156] == 48,
              let storedChecksum = number(header[148..<156]),
              let size = number(header[124..<136]), size <= 0o77777777777 else { return nil }
        let checksum = header.enumerated().reduce(UInt64(0)) {
            $0 + ((148..<156).contains($1.offset) ? 32 : UInt64($1.element))
        }
        guard checksum == storedChecksum else { return nil }
        let path = String(decoding: header[0..<100].prefix { $0 != 0 }, as: UTF8.self)
        let dataOffset = offset + UInt64(blockSize)
        let nextOffset = dataOffset + ((size + UInt64(blockSize - 1)) / UInt64(blockSize)) * UInt64(blockSize)
        guard !path.isEmpty, nextOffset <= length else { return nil }
        return Entry(path: path, size: size, dataOffset: dataOffset, nextOffset: nextOffset)
    }

    static func hasEndMarker(in file: FileHandle, offset: UInt64, length: UInt64) throws -> Bool {
        guard offset <= length, length - offset == UInt64(zeros.count) else { return false }
        try file.seek(toOffset: offset)
        return try file.read(upToCount: zeros.count) == zeros
    }

    private static func number(_ bytes: Data.SubSequence) -> UInt64? {
        UInt64(String(decoding: bytes, as: UTF8.self).trimmingCharacters(in: CharacterSet(charactersIn: " \0")), radix: 8)
    }
}
