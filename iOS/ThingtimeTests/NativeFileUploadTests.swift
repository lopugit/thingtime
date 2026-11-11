import XCTest
import AppleFileSync
import Network
@testable import Thingtime

private final class UploadProtocol: URLProtocol, @unchecked Sendable {
    static let lock = NSLock()
    private static var respond: ((URLRequest, UploadProtocol) -> Void)?
    static func set(_ value: @escaping (URLRequest, UploadProtocol) -> Void) { lock.lock(); respond = value; lock.unlock() }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.lock.lock(); let handler = Self.respond; Self.lock.unlock(); handler?(request, self) }
    override func stopLoading() {}
    func response(status: Int, bytes: Int = 0, finish: Bool = true) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: [:])!, cacheStoragePolicy: .notAllowed)
        if bytes > 0 { client?.urlProtocol(self, didLoad: Data(repeating: 0, count: bytes)) }
        if finish { client?.urlProtocolDidFinishLoading(self) }
    }
}

private final class LoopbackUpload: @unchecked Sendable {
    let listener: NWListener
    private let queue = DispatchQueue(label: "thingtime.test.paced-upload")
    let body: Data
    var received: ((Data) -> Void)?
    init(body: Data) throws {
        self.body = body
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        listener = try NWListener(using: params)
    }
    func start(_ ready: @escaping () -> Void) {
        listener.stateUpdateHandler = { if case .ready = $0 { ready() } }
        listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            connection.start(queue: self.queue); self.read(connection, received: Data())
        }
        listener.start(queue: queue)
    }
    private func read(_ connection: NWConnection, received soFar: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, error in
            guard let self else { connection.cancel(); return }
            let joined = soFar + (data ?? Data())
            if let marker = joined.range(of: Data("\r\n\r\n".utf8)), joined.count - marker.upperBound >= self.body.count {
                self.received?(joined[marker.upperBound...]); self.received = nil
                connection.send(content: Data("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8),
                                completion: .contentProcessed { _ in connection.cancel() })
            } else if error == nil, !done, joined.count <= self.body.count + 8192 { self.read(connection, received: joined) }
            else { connection.cancel() }
        }
    }
}
@MainActor
final class NativeFileUploadTests: XCTestCase {
    func testStreamedUploadPacesActualLoopbackPayload() async throws {
        let bytes = Data((0..<(64 * 1024)).map { UInt8(truncatingIfNeeded: $0) })
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try bytes.write(to: file); defer { try? FileManager.default.removeItem(at: file) }
        let server = try LoopbackUpload(body: bytes), ready = expectation(description: "loopback ready")
        let received = expectation(description: "exact uploaded bytes")
        server.received = { XCTAssertEqual($0, bytes); received.fulfill() }
        server.start { ready.fulfill() }; defer { server.listener.cancel() }
        await fulfillment(of: [ready], timeout: 5)
        let port = try XCTUnwrap(server.listener.port)
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port.rawValue)/part")!, timeoutInterval: 8)
        request.httpMethod = "PUT"; request.setValue(String(bytes.count), forHTTPHeaderField: "Content-Length")
        let clock = ContinuousClock(), start = clock.now, sender = NativeFileUpload()
        try await sender.send(request, file: file, rate: 32 * 1024, length: Int64(bytes.count))
        await fulfillment(of: [received], timeout: 2)
        XCTAssertGreaterThanOrEqual(clock.now - start, .seconds(2), "The server must receive real bytes at the selected sustained pace")
        XCTAssertEqual(sender.measurement().sent, Int64(bytes.count))
    }

    private func fixture() throws -> (URLRequest, URL, URLSessionConfiguration) {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try Data([1,2,3,4]).write(to: file)
        var request = URLRequest(url: URL(string: "https://signed-upload.test/part")!)
        request.httpMethod = "PUT"; request.httpShouldHandleCookies = false
        request.setValue("4", forHTTPHeaderField: "Content-Length")
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [UploadProtocol.self]
        return (request, file, configuration)
    }
    func testFileUploadAcceptsOnlySuccessfulBoundedResponsesWithoutAmbientCredentials() async throws {
        let (request,file,configuration) = try fixture(); defer { try? FileManager.default.removeItem(at: file) }
        UploadProtocol.set { req, protocolInstance in
            XCTAssertEqual(req.httpMethod,"PUT"); XCTAssertNil(req.value(forHTTPHeaderField:"Cookie"))
            XCTAssertNil(req.value(forHTTPHeaderField:"Authorization")); XCTAssertNil(req.value(forHTTPHeaderField:"Origin"))
            protocolInstance.response(status:200,bytes:4)
        }
        try await NativeFileUpload().send(request,file:file,configuration:configuration)
        for (status,size) in [(302,0),(403,0),(200,65_537)] {
            UploadProtocol.set { _, p in p.response(status:status,bytes:size) }
            do { try await NativeFileUpload().send(request,file:file,configuration:configuration); XCTFail("Accepted rejected response") } catch {}
        }
    }
    func testCancellationBeforeAndDuringUploadStopsTheTask() async throws {
        let (request,file,configuration) = try fixture(); defer { try? FileManager.default.removeItem(at: file) }
        let cancelled = NativeFileUpload(); cancelled.cancel()
        UploadProtocol.set { _,_ in XCTFail("Cancelled request started") }
        do { try await cancelled.send(request,file:file,configuration:configuration); XCTFail() } catch is CancellationError {}
        let started = expectation(description:"Upload started")
        UploadProtocol.set { _,p in p.response(status:200,finish:false); started.fulfill() }
        let sender = NativeFileUpload(), work = Task { try await sender.send(request,file:file,configuration:configuration) }
        await fulfillment(of:[started],timeout:5); work.cancel()
        do { try await work.value; XCTFail("Cancelled upload succeeded") } catch {}
    }
    func testSignedDestinationRejectsCredentialsRedirectInputsAndExtraHeaders() throws {
        let origin = URL(string: "https://native-sync.test")!, checksum = Data(repeating: 1, count: 32).base64EncodedString()
        let part: [String: Any] = ["partNumber": 1, "url": "https://storage.test/part", "headers": ["x-amz-checksum-sha256": checksum]]
        func request(_ part: [String: Any]) throws -> URLRequest {
            try NativeFileSession.signedUploadRequest(["ok": true, "parts": [part]], origin: origin, checksum: checksum, length: 4, partNumber: 1)
        }
        let valid = try request(part)
        XCTAssertFalse(valid.httpShouldHandleCookies); XCTAssertNil(valid.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(valid.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(valid.value(forHTTPHeaderField: "Origin"))
        for url in ["http://storage.test/part", "https://user:pass@storage.test/part", "https://storage.test/part#fragment", "file:///tmp/part"] {
            var changed = part; changed["url"] = url; XCTAssertThrowsError(try request(changed))
        }
        for headers in [["x-amz-checksum-sha256": "wrong"], ["x-amz-checksum-sha256": checksum, "Authorization": "forbidden"]] {
            var changed = part; changed["headers"] = headers; XCTAssertThrowsError(try request(changed))
        }
        var changed = part; changed["partNumber"] = 2; XCTAssertThrowsError(try request(changed))
    }
    func testNativeUploadRequestRejectsNoncanonicalRangesAndChangedReservations() throws {
        let fingerprint = MobileFolderReader.Fingerprint(partSizeBytes:8 * 1024 * 1024,partCount:1,sha256:String(repeating:"a",count:64))
        let source = MobileFolderReader.Entry(path:"file.bin",id:"file",version:"v1",kind:"file",size:4,sha256:nil,fingerprint:fingerprint)
        let valid = NativeUploadPartRequest(source:source,uploadId:"upload",requestId:"operation",partNumber:1,offset:0,length:4)
        try valid.validate()
        XCTAssertFalse(try valid.verifyPlan(["ok":true,"upload":["id":"upload","partSizeBytes":8 * 1024 * 1024,"partCount":1,"state":"uploading"]]))
        XCTAssertThrowsError(try valid.verifyPlan(["ok":true,"upload":["id":"other","partSizeBytes":8 * 1024 * 1024,"partCount":1]]))
        XCTAssertThrowsError(try NativeUploadPartRequest(source:source,uploadId:"upload",requestId:"../operation",partNumber:1,offset:0,length:4).validate())
        XCTAssertThrowsError(try NativeUploadPartRequest(source:source,uploadId:"upload",requestId:"operation",partNumber:1,offset:1,length:3).validate())
        XCTAssertThrowsError(try NativeUploadPartRequest(source:source,uploadId:"upload",requestId:"operation",partNumber:2,offset:0,length:4).validate())
    }
}
