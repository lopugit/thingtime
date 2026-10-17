import Foundation
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
        func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
            connection.exportedInterface = ThingtimeNodeXPC.interface()
            connection.exportedObject = self
            connection.resume(); return true
        }
    }
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
}
