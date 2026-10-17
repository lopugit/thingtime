import Foundation
import CryptoKit
import XCTest
@testable import ThingtimeNodeCore

/// Exercise the actual NSXPC protocol/interface (including nested sink and ack)
/// without touching the installed signed Mach service or its credentials.
final class FolderStreamXPCTests: XCTestCase {
    private final class Sink: NSObject, ThingtimeNodeByteSink {
        let lock = NSLock()
        var bytes = Data()
        var calls = 0
        var accept = true
        func receive(_ data: Data, withReply reply: @escaping (Bool) -> Void) {
            lock.lock(); defer { lock.unlock() }
            calls += 1
            if accept { bytes.append(data) }
            reply(accept)
        }
    }
    private final class Service: NSObject, ThingtimeNodeXPCProtocol, NSXPCListenerDelegate {
        func request(_ data: Data, withReply reply: @escaping (Data) -> Void) { reply(data) }
        func stream(_ data: Data, sink: ThingtimeNodeByteSink, withReply reply: @escaping (Data) -> Void) {
            DispatchQueue.global().async {
                for _ in 0..<129 {
                    let ack = DispatchSemaphore(value: 0)
                    let result = Ack()
                    sink.receive(Data(repeating: 31, count: 65_536)) { result.accepted = $0; ack.signal() }
                    guard ack.wait(timeout: .now() + 5) == .success, result.accepted else { reply(Data("refused".utf8)); return }
                }
                reply(Data("complete".utf8))
            }
        }
        func stage(_ data: Data, source: ThingtimeNodeByteSource, withReply reply: @escaping (Data) -> Void) {
            DispatchQueue.global().async {
                var hash = SHA256()
                for i in 0..<33 {
                    let ack = DispatchSemaphore(value: 0), result = Bytes()
                    let length = i == 32 ? 17 : 65_536
                    source.read(Int64(i * 65_536), length: length) { result.data = $0; ack.signal() }
                    guard ack.wait(timeout: .now() + 5) == .success, result.data.count == length else { reply(Data()); return }
                    hash.update(data: result.data)
                }
                reply(Data(hash.finalize()))
            }
        }
        func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
            connection.exportedInterface = ThingtimeNodeXPC.interface()
            connection.exportedObject = self
            connection.resume(); return true
        }
    }
    private final class Bytes: @unchecked Sendable { var data = Data() }
    private final class Ack: @unchecked Sendable { var accepted = false }
    func testBoundedFramesAndAcknowledgementsCrossRealXPC() async throws {
        let service = Service(), listener = NSXPCListener.anonymous()
        listener.delegate = service; listener.resume(); defer { listener.invalidate() }
        let connection = NSXPCConnection(listenerEndpoint: listener.endpoint)
        connection.remoteObjectInterface = ThingtimeNodeXPC.interface(); connection.resume(); defer { connection.invalidate() }
        let proxy = try XCTUnwrap(connection.remoteObjectProxy as? ThingtimeNodeXPCProtocol)
        let sink = Sink()
        let result: Data = await withCheckedContinuation { reply in proxy.stream(Data("read".utf8), sink: sink) { reply.resume(returning: $0) } }
        XCTAssertEqual(result, Data("complete".utf8))
        XCTAssertEqual(sink.bytes, Data(repeating: 31, count: 129 * 65_536)); XCTAssertEqual(sink.calls, 129)
        sink.accept = false
        let refused: Data = await withCheckedContinuation { reply in proxy.stream(Data("read".utf8), sink: sink) { reply.resume(returning: $0) } }
        XCTAssertEqual(refused, Data("refused".utf8)); XCTAssertEqual(sink.calls, 130)
    }
    func testStagingPullFramesCrossRealXPCWithSequentialOffsets() async throws {
        let data = Data(repeating: 67, count: 2 * 1024 * 1024 + 17)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try data.write(to: url); defer { try? FileManager.default.removeItem(at: url) }
        let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
        let source = try NodeFolderStreamInput(handle: file, length: data.count)
        let service = Service(), listener = NSXPCListener.anonymous()
        listener.delegate = service; listener.resume(); defer { listener.invalidate() }
        let connection = NSXPCConnection(listenerEndpoint: listener.endpoint)
        connection.remoteObjectInterface = ThingtimeNodeXPC.interface(); connection.resume(); defer { connection.invalidate() }
        let proxy = try XCTUnwrap(connection.remoteObjectProxy as? ThingtimeNodeXPCProtocol)
        let result: Data = await withCheckedContinuation { reply in proxy.stage(Data(), source: source) { reply.resume(returning: $0) } }
        XCTAssertEqual(result, Data(SHA256.hash(data: data)))
        let refused: Data = await withCheckedContinuation { reply in source.read(0, length: 1) { reply.resume(returning: $0) } }
        XCTAssertTrue(refused.isEmpty)
    }
    func testStreamInputRejectsOversizeHeadersOutOfOrderReadsAndTruncation() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: url) }
        for bytes in [Data([0, 0]), Data([0, 2, 0, 1]), Data([0, 0, 0, 3, 1])] {
            try bytes.write(to: url)
            let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
            XCTAssertThrowsError(try NodeFolderStreamInput.header(file))
        }
        try Data([0, 0, 0, 3, 1, 2, 3, 7, 8]).write(to: url)
        let file = try FileHandle(forReadingFrom: url); defer { try? file.close() }
        XCTAssertEqual(try NodeFolderStreamInput.header(file), Data([1, 2, 3]))
        let source = try NodeFolderStreamInput(handle: file, length: 3)
        XCTAssertEqual(try source.next(offset: 0, length: 2), Data([7, 8]))
        XCTAssertThrowsError(try source.next(offset: 2, length: 1))
        XCTAssertThrowsError(try source.next(offset: 0, length: 1))
        XCTAssertThrowsError(try NodeFolderStreamInput(handle: file, length: 32 * 1024 * 1024 + 1))
    }

}
