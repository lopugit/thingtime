import Foundation
import CoreVideo
import XCTest
@testable import ThingtimeNodeCore

private actor FakeScreenCaptureSession: ScreenCaptureBackendSession {
    private var stopped = false
    private let onStop: @Sendable () async -> Void

    init(onStop: @escaping @Sendable () async -> Void) {
        self.onStop = onStop
    }

    func stop() async throws {
        let shouldStop = !stopped
        stopped = true
        if shouldStop { await onStop() }
    }
}

private struct FakeScreenCaptureBackendSnapshot: Sendable {
    let preflightCount: Int
    let startDisplayIDs: [UInt32]
    let configurations: [ScreenCaptureBackendConfiguration]
    let stopCount: Int
}

private actor FakeScreenCaptureBackend: ScreenCaptureBackend {
    var authorized: Bool
    var displays: [ScreenCaptureDisplay]
    private(set) var preflightCount = 0
    private(set) var startDisplayIDs: [UInt32] = []
    private(set) var configurations: [ScreenCaptureBackendConfiguration] = []
    private(set) var stopCount = 0
    private var onFrame: (@Sendable (ScreenCaptureRawFrame) -> Void)?
    private var onTermination: (@Sendable (ScreenCaptureError) -> Void)?

    init(authorized: Bool = true, displays: [ScreenCaptureDisplay]) {
        self.authorized = authorized
        self.displays = displays
    }

    func preflightAuthorized() async -> Bool {
        preflightCount += 1
        return authorized
    }

    func availableDisplays() async throws -> [ScreenCaptureDisplay] { displays }

    func startCapture(
        displayID: UInt32,
        configuration: ScreenCaptureBackendConfiguration,
        onFrame: @escaping @Sendable (ScreenCaptureRawFrame) -> Void,
        onTermination: @escaping @Sendable (ScreenCaptureError) -> Void
    ) async throws -> any ScreenCaptureBackendSession {
        startDisplayIDs.append(displayID)
        configurations.append(configuration)
        self.onFrame = onFrame
        self.onTermination = onTermination
        return FakeScreenCaptureSession { [weak self] in
            await self?.recordStop()
        }
    }

    func emit(_ frame: ScreenCaptureRawFrame) {
        onFrame?(frame)
    }

    func terminate(_ error: ScreenCaptureError) {
        onTermination?(error)
    }

    func snapshot() -> FakeScreenCaptureBackendSnapshot {
        FakeScreenCaptureBackendSnapshot(
            preflightCount: preflightCount,
            startDisplayIDs: startDisplayIDs,
            configurations: configurations,
            stopCount: stopCount
        )
    }

    private func recordStop() {
        stopCount += 1
    }
}

private actor PassthroughScreenCaptureEncoder: ScreenCaptureFrameEncoding {
    func encode(
        _ frame: ScreenCaptureRawFrame,
        quality _: Double,
        maximumBytes _: Int
    ) async throws -> Data {
        guard case let .opaque(data) = frame.payload else {
            throw ScreenCaptureError.encodingFailed
        }
        return data
    }
}

private actor GatedScreenCaptureEncoder: ScreenCaptureFrameEncoding {
    private var firstStarted = false
    private var firstGate: CheckedContinuation<Void, Never>?
    private var startWaiters: [CheckedContinuation<Void, Never>] = []

    func encode(
        _ frame: ScreenCaptureRawFrame,
        quality _: Double,
        maximumBytes _: Int
    ) async throws -> Data {
        guard case let .opaque(data) = frame.payload else {
            throw ScreenCaptureError.encodingFailed
        }
        if !firstStarted {
            firstStarted = true
            let waiters = startWaiters
            startWaiters.removeAll()
            waiters.forEach { $0.resume() }
            await withCheckedContinuation { continuation in
                firstGate = continuation
            }
        }
        return data
    }

    func waitForFirstStart() async {
        if firstStarted { return }
        await withCheckedContinuation { continuation in
            startWaiters.append(continuation)
        }
    }

    func releaseFirst() {
        firstGate?.resume()
        firstGate = nil
    }
}

private final class ScreenCaptureEventRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [ScreenCaptureEvent] = []
    private var waiters: [(Int, CheckedContinuation<Void, Never>)] = []

    func record(_ event: ScreenCaptureEvent) {
        lock.lock()
        events.append(event)
        let ready = waiters.filter { events.count >= $0.0 }
        waiters.removeAll { events.count >= $0.0 }
        lock.unlock()
        ready.forEach { $0.1.resume() }
    }

    func waitForEventCount(_ count: Int) async {
        await withCheckedContinuation { continuation in
            lock.lock()
            let isReady = events.count >= count
            if !isReady {
                waiters.append((count, continuation))
            }
            lock.unlock()
            if isReady {
                continuation.resume()
            }
        }
    }

    func snapshot() -> [ScreenCaptureEvent] {
        lock.lock()
        defer { lock.unlock() }
        return events
    }
}

final class ScreenCaptureTests: XCTestCase {
    private let unlockedApproved = ScreenCaptureAuthorization(
        sessionLocked: false,
        explicitlyAuthorized: true
    )

    func testAuthorizationAndPermissionGatesNeverStartBackend() async throws {
        let backend = FakeScreenCaptureBackend(displays: [display(1, main: true)])
        let capture = ViewOnlyScreenCapture(backend: backend, encoder: PassthroughScreenCaptureEncoder())
        let limits = try ScreenCaptureLimits()

        await assertError(.explicitAuthorizationRequired) {
            _ = try await capture.start(
                sessionID: "session",
                authorization: ScreenCaptureAuthorization(sessionLocked: false, explicitlyAuthorized: false),
                limits: limits,
                onEvent: { _ in }
            )
        }
        await assertError(.sessionLocked) {
            _ = try await capture.start(
                sessionID: "session",
                authorization: ScreenCaptureAuthorization(sessionLocked: true, explicitlyAuthorized: true),
                limits: limits,
                onEvent: { _ in }
            )
        }
        var backendSnapshot = await backend.snapshot()
        XCTAssertEqual(backendSnapshot.preflightCount, 0)
        XCTAssertTrue(backendSnapshot.startDisplayIDs.isEmpty)

        await backend.setAuthorized(false)
        await assertError(.permissionNotGranted) {
            _ = try await capture.start(
                sessionID: "session",
                authorization: unlockedApproved,
                limits: limits,
                onEvent: { _ in }
            )
        }
        backendSnapshot = await backend.snapshot()
        XCTAssertEqual(backendSnapshot.preflightCount, 1)
        XCTAssertTrue(backendSnapshot.startDisplayIDs.isEmpty)
    }

    func testLimitsRejectEveryValueAboveTheHardCeiling() throws {
        XCTAssertThrowsError(try ScreenCaptureLimits(maximumWidth: 1_921))
        XCTAssertThrowsError(try ScreenCaptureLimits(maximumHeight: 1_081))
        XCTAssertThrowsError(try ScreenCaptureLimits(framesPerSecond: 16))
        XCTAssertThrowsError(try ScreenCaptureLimits(queueDepth: 4))
        XCTAssertThrowsError(try ScreenCaptureLimits(maximumFrameBytes: 2_000_001))
        XCTAssertThrowsError(try ScreenCaptureLimits(jpegQuality: 0.86))
    }

    func testDefaultEncoderProducesBoundedJPEGBytes() async throws {
        var pixelBuffer: CVPixelBuffer?
        let attributes: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true
        ]
        XCTAssertEqual(
            CVPixelBufferCreate(
                kCFAllocatorDefault,
                64,
                64,
                kCVPixelFormatType_32BGRA,
                attributes as CFDictionary,
                &pixelBuffer
            ),
            kCVReturnSuccess
        )
        let buffer = try XCTUnwrap(pixelBuffer)
        let encoder = JPEGScreenCaptureFrameEncoder()
        let encoded = try await encoder.encode(
            ScreenCaptureRawFrame(
                displayID: 1,
                capturedAt: Date(timeIntervalSince1970: 1),
                width: 64,
                height: 64,
                payload: .pixelBuffer(buffer)
            ),
            quality: 0.65,
            maximumBytes: 100_000
        )

        XCTAssertLessThanOrEqual(encoded.count, 100_000)
        XCTAssertEqual(Array(encoded.prefix(2)), [0xFF, 0xD8])
        XCTAssertEqual(Array(encoded.suffix(2)), [0xFF, 0xD9])
    }

    func testDeterministicDisplaySelectionAndBoundedSizing() async throws {
        let backend = FakeScreenCaptureBackend(displays: [
            display(2, width: 1_920, height: 1_080),
            display(9, width: 2_560, height: 1_440, main: true),
            display(1, width: 1_024, height: 768)
        ])
        let capture = ViewOnlyScreenCapture(backend: backend, encoder: PassthroughScreenCaptureEncoder())
        let descriptor = try await capture.start(
            sessionID: "main-display",
            authorization: unlockedApproved,
            limits: try ScreenCaptureLimits(maximumWidth: 1_280, maximumHeight: 720),
            onEvent: { _ in }
        )

        XCTAssertEqual(descriptor.displayID, 9)
        XCTAssertEqual(descriptor.width, 1_280)
        XCTAssertEqual(descriptor.height, 720)
        let backendSnapshot = await backend.snapshot()
        XCTAssertEqual(backendSnapshot.startDisplayIDs, [9])
        XCTAssertEqual(backendSnapshot.configurations.first?.queueDepth, 2)
        try await capture.stop(sessionID: descriptor.sessionID)
    }

    func testMissingRequestedDisplayFailsClosed() async throws {
        let backend = FakeScreenCaptureBackend(displays: [display(1, main: true)])
        let capture = ViewOnlyScreenCapture(backend: backend, encoder: PassthroughScreenCaptureEncoder())
        await assertError(.displayUnavailable(88)) {
            _ = try await capture.start(
                sessionID: "missing-display",
                requestedDisplayID: 88,
                authorization: unlockedApproved,
                limits: try ScreenCaptureLimits(),
                onEvent: { _ in }
            )
        }
        let backendSnapshot = await backend.snapshot()
        XCTAssertTrue(backendSnapshot.startDisplayIDs.isEmpty)
    }

    func testNewestFrameBackpressureDropsSupersededPendingFrame() async throws {
        let backend = FakeScreenCaptureBackend(displays: [display(7, main: true)])
        let encoder = GatedScreenCaptureEncoder()
        let recorder = ScreenCaptureEventRecorder()
        let capture = ViewOnlyScreenCapture(backend: backend, encoder: encoder)
        _ = try await capture.start(
            sessionID: "backpressure",
            authorization: unlockedApproved,
            limits: try ScreenCaptureLimits(),
            onEvent: { event in recorder.record(event) }
        )

        await backend.emit(frame(1, displayID: 7))
        await encoder.waitForFirstStart()
        await backend.emit(frame(2, displayID: 7))
        await backend.emit(frame(3, displayID: 7))
        await encoder.releaseFirst()
        await recorder.waitForEventCount(2)

        let events = recorder.snapshot()
        let frames = events.compactMap { event -> ScreenCaptureFrame? in
            guard case let .frame(frame) = event else { return nil }
            return frame
        }
        XCTAssertEqual(frames.map(\.sequence), [1, 2])
        XCTAssertEqual(frames.map(\.bytes), [Data([1]), Data([3])])
        XCTAssertEqual(frames.map(\.byteCount), [1, 1])
        try await capture.stop(sessionID: "backpressure")
    }

    func testStartStopAreIdempotentForSameSession() async throws {
        let backend = FakeScreenCaptureBackend(displays: [display(1, main: true)])
        let recorder = ScreenCaptureEventRecorder()
        let capture = ViewOnlyScreenCapture(backend: backend, encoder: PassthroughScreenCaptureEncoder())
        let limits = try ScreenCaptureLimits()
        let first = try await capture.start(
            sessionID: "stable-session",
            authorization: unlockedApproved,
            limits: limits,
            onEvent: { event in recorder.record(event) }
        )
        let second = try await capture.start(
            sessionID: "stable-session",
            authorization: unlockedApproved,
            limits: limits,
            onEvent: { _ in XCTFail("An idempotent start must keep the original handler") }
        )
        XCTAssertEqual(first, second)
        var backendSnapshot = await backend.snapshot()
        XCTAssertEqual(backendSnapshot.startDisplayIDs.count, 1)

        await assertError(.alreadyRunning("stable-session")) {
            _ = try await capture.start(
                sessionID: "other-session",
                authorization: unlockedApproved,
                limits: limits,
                onEvent: { _ in }
            )
        }

        try await capture.stop(sessionID: "stable-session")
        try await capture.stop(sessionID: "stable-session")
        await recorder.waitForEventCount(1)
        backendSnapshot = await backend.snapshot()
        let events = recorder.snapshot()
        XCTAssertEqual(backendSnapshot.stopCount, 1)
        XCTAssertEqual(events, [.stopped(sessionID: "stable-session")])
    }

    func testOversizedEncodingAndBackendTerminationFailClosed() async throws {
        let backend = FakeScreenCaptureBackend(displays: [display(1, main: true)])
        let recorder = ScreenCaptureEventRecorder()
        let capture = ViewOnlyScreenCapture(backend: backend, encoder: PassthroughScreenCaptureEncoder())
        _ = try await capture.start(
            sessionID: "bounded",
            authorization: unlockedApproved,
            limits: try ScreenCaptureLimits(maximumFrameBytes: 1),
            onEvent: { event in recorder.record(event) }
        )
        await backend.emit(ScreenCaptureRawFrame(
            displayID: 1,
            capturedAt: Date(timeIntervalSince1970: 42),
            width: 100,
            height: 100,
            payload: .opaque(Data([1, 2]))
        ))
        await recorder.waitForEventCount(1)
        let oversizedEvents = recorder.snapshot()
        let runningAfterOversizedFrame = await capture.isRunning()
        var backendSnapshot = await backend.snapshot()
        XCTAssertEqual(oversizedEvents, [.failed(sessionID: "bounded", error: .frameTooLarge)])
        XCTAssertFalse(runningAfterOversizedFrame)
        XCTAssertEqual(backendSnapshot.stopCount, 1)

        let terminationRecorder = ScreenCaptureEventRecorder()
        _ = try await capture.start(
            sessionID: "display-disappears",
            authorization: unlockedApproved,
            limits: try ScreenCaptureLimits(),
            onEvent: { event in terminationRecorder.record(event) }
        )
        await backend.terminate(.displayUnavailable(1))
        await terminationRecorder.waitForEventCount(1)
        await backend.emit(frame(9, displayID: 1))
        await Task.yield()
        let terminationEvents = terminationRecorder.snapshot()
        let runningAfterTermination = await capture.isRunning()
        backendSnapshot = await backend.snapshot()
        XCTAssertEqual(
            terminationEvents,
            [.failed(sessionID: "display-disappears", error: .displayUnavailable(1))]
        )
        XCTAssertFalse(runningAfterTermination)
        XCTAssertEqual(backendSnapshot.stopCount, 1)
    }

    private func display(
        _ id: UInt32,
        width: Int = 1_280,
        height: Int = 720,
        main: Bool = false
    ) -> ScreenCaptureDisplay {
        ScreenCaptureDisplay(displayID: id, width: width, height: height, isMain: main)
    }

    private func frame(_ byte: UInt8, displayID: UInt32) -> ScreenCaptureRawFrame {
        ScreenCaptureRawFrame(
            displayID: displayID,
            capturedAt: Date(timeIntervalSince1970: TimeInterval(byte)),
            width: 100,
            height: 100,
            payload: .opaque(Data([byte]))
        )
    }

    private func assertError(
        _ expected: ScreenCaptureError,
        operation: () async throws -> Void
    ) async {
        do {
            try await operation()
            XCTFail("Expected \(expected)")
        } catch {
            XCTAssertEqual(error as? ScreenCaptureError, expected)
        }
    }
}

private extension FakeScreenCaptureBackend {
    func setAuthorized(_ value: Bool) {
        authorized = value
    }
}
