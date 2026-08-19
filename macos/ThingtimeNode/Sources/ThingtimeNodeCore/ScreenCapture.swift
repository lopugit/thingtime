import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ScreenCaptureKit

public struct ScreenCaptureAuthorization: Equatable, Sendable {
    public let sessionLocked: Bool
    public let explicitlyAuthorized: Bool

    public init(sessionLocked: Bool, explicitlyAuthorized: Bool) {
        self.sessionLocked = sessionLocked
        self.explicitlyAuthorized = explicitlyAuthorized
    }
}

/// Hard limits are intentionally part of the primitive rather than left to a
/// caller or transport. This capture path is for bounded remote viewing, not
/// recording or archival-quality video.
public struct ScreenCaptureLimits: Equatable, Sendable {
    public static let maximumAllowedWidth = 1_920
    public static let maximumAllowedHeight = 1_080
    public static let maximumAllowedFramesPerSecond = 15
    public static let maximumAllowedQueueDepth = 3
    public static let maximumAllowedFrameBytes = 2_000_000

    public let maximumWidth: Int
    public let maximumHeight: Int
    public let framesPerSecond: Int
    public let queueDepth: Int
    public let maximumFrameBytes: Int
    public let jpegQuality: Double

    public init(
        maximumWidth: Int = 1_280,
        maximumHeight: Int = 720,
        framesPerSecond: Int = 10,
        queueDepth: Int = 2,
        maximumFrameBytes: Int = 750_000,
        jpegQuality: Double = 0.65
    ) throws {
        guard (1 ... Self.maximumAllowedWidth).contains(maximumWidth) else {
            throw ScreenCaptureError.invalidConfiguration("maximum width")
        }
        guard (1 ... Self.maximumAllowedHeight).contains(maximumHeight) else {
            throw ScreenCaptureError.invalidConfiguration("maximum height")
        }
        guard (1 ... Self.maximumAllowedFramesPerSecond).contains(framesPerSecond) else {
            throw ScreenCaptureError.invalidConfiguration("frame rate")
        }
        guard (1 ... Self.maximumAllowedQueueDepth).contains(queueDepth) else {
            throw ScreenCaptureError.invalidConfiguration("queue depth")
        }
        guard (1 ... Self.maximumAllowedFrameBytes).contains(maximumFrameBytes) else {
            throw ScreenCaptureError.invalidConfiguration("frame byte limit")
        }
        guard (0.2 ... 0.85).contains(jpegQuality) else {
            throw ScreenCaptureError.invalidConfiguration("JPEG quality")
        }

        self.maximumWidth = maximumWidth
        self.maximumHeight = maximumHeight
        self.framesPerSecond = framesPerSecond
        self.queueDepth = queueDepth
        self.maximumFrameBytes = maximumFrameBytes
        self.jpegQuality = jpegQuality
    }
}

public struct ScreenCaptureDisplay: Equatable, Sendable {
    public let displayID: UInt32
    public let width: Int
    public let height: Int
    public let isMain: Bool

    public init(displayID: UInt32, width: Int, height: Int, isMain: Bool) {
        self.displayID = displayID
        self.width = width
        self.height = height
        self.isMain = isMain
    }
}

public struct ScreenCaptureBackendConfiguration: Equatable, Sendable {
    public let width: Int
    public let height: Int
    public let framesPerSecond: Int
    public let queueDepth: Int

    public init(width: Int, height: Int, framesPerSecond: Int, queueDepth: Int) {
        self.width = width
        self.height = height
        self.framesPerSecond = framesPerSecond
        self.queueDepth = queueDepth
    }
}

public struct ScreenCaptureDescriptor: Equatable, Sendable {
    public let sessionID: String
    public let displayID: UInt32
    public let width: Int
    public let height: Int
    public let framesPerSecond: Int

    public init(sessionID: String, displayID: UInt32, width: Int, height: Int, framesPerSecond: Int) {
        self.sessionID = sessionID
        self.displayID = displayID
        self.width = width
        self.height = height
        self.framesPerSecond = framesPerSecond
    }
}

public struct ScreenCaptureFrame: Codable, Equatable, Sendable {
    public let sessionID: String
    public let sequence: UInt64
    public let capturedAt: Date
    public let displayID: UInt32
    public let width: Int
    public let height: Int
    public let mediaType: String
    public let bytes: Data

    public var byteCount: Int { bytes.count }

    public init(
        sessionID: String,
        sequence: UInt64,
        capturedAt: Date,
        displayID: UInt32,
        width: Int,
        height: Int,
        mediaType: String,
        bytes: Data
    ) {
        self.sessionID = sessionID
        self.sequence = sequence
        self.capturedAt = capturedAt
        self.displayID = displayID
        self.width = width
        self.height = height
        self.mediaType = mediaType
        self.bytes = bytes
    }
}

public enum ScreenCaptureEvent: Equatable, Sendable {
    case frame(ScreenCaptureFrame)
    case stopped(sessionID: String)
    case failed(sessionID: String, error: ScreenCaptureError)
}

public enum ScreenCaptureError: Error, Equatable, LocalizedError, Sendable {
    case invalidSessionID
    case invalidConfiguration(String)
    case sessionLocked
    case explicitAuthorizationRequired
    case permissionNotGranted
    case noDisplaysAvailable
    case displayUnavailable(UInt32)
    case alreadyRunning(String)
    case sessionMismatch
    case malformedFrame
    case frameTooLarge
    case encodingFailed
    case captureInterrupted
    case backendFailure(String)

    public var errorDescription: String? {
        switch self {
        case .invalidSessionID:
            "A bounded screen session identifier is required."
        case let .invalidConfiguration(field):
            "The screen capture \(field) is outside the allowed range."
        case .sessionLocked:
            "Screen viewing is disabled while the user session is locked."
        case .explicitAuthorizationRequired:
            "Screen viewing requires explicit approval."
        case .permissionNotGranted:
            "Screen Recording permission is not granted."
        case .noDisplaysAvailable:
            "No shareable display is available."
        case let .displayUnavailable(displayID):
            "The selected display \(displayID) is no longer available."
        case let .alreadyRunning(sessionID):
            "Screen session \(sessionID) is already running."
        case .sessionMismatch:
            "The screen session identifier does not match the active session."
        case .malformedFrame:
            "The capture backend produced an invalid frame."
        case .frameTooLarge:
            "The encoded frame exceeded the transport limit."
        case .encodingFailed:
            "The screen frame could not be encoded."
        case .captureInterrupted:
            "Screen capture ended unexpectedly."
        case let .backendFailure(operation):
            "The screen capture backend failed during \(operation)."
        }
    }
}

/// Payloads are either the real ScreenCaptureKit pixel buffer or an opaque
/// value supplied by an injected backend. The default JPEG encoder accepts
/// only real pixel buffers; opaque values exist solely to keep the boundary
/// deterministic and testable without synthesising a fake production stream.
public enum ScreenCaptureRawPayload: @unchecked Sendable {
    case pixelBuffer(CVPixelBuffer)
    case opaque(Data)
}

public struct ScreenCaptureRawFrame: @unchecked Sendable {
    public let displayID: UInt32
    public let capturedAt: Date
    public let width: Int
    public let height: Int
    public let payload: ScreenCaptureRawPayload

    public init(
        displayID: UInt32,
        capturedAt: Date,
        width: Int,
        height: Int,
        payload: ScreenCaptureRawPayload
    ) {
        self.displayID = displayID
        self.capturedAt = capturedAt
        self.width = width
        self.height = height
        self.payload = payload
    }
}

public protocol ScreenCaptureBackendSession: Sendable {
    func stop() async throws
}

public protocol ScreenCaptureBackend: Sendable {
    /// Must remain a preflight only. Implementations must never call a TCC
    /// prompting API from this method or from `startCapture`.
    func preflightAuthorized() async -> Bool
    func availableDisplays() async throws -> [ScreenCaptureDisplay]
    func startCapture(
        displayID: UInt32,
        configuration: ScreenCaptureBackendConfiguration,
        onFrame: @escaping @Sendable (ScreenCaptureRawFrame) -> Void,
        onTermination: @escaping @Sendable (ScreenCaptureError) -> Void
    ) async throws -> any ScreenCaptureBackendSession
}

public protocol ScreenCaptureFrameEncoding: Sendable {
    func encode(
        _ frame: ScreenCaptureRawFrame,
        quality: Double,
        maximumBytes: Int
    ) async throws -> Data
}

public actor JPEGScreenCaptureFrameEncoder: ScreenCaptureFrameEncoding {
    private let context = CIContext(options: [.cacheIntermediates: false])

    public init() {}

    public func encode(
        _ frame: ScreenCaptureRawFrame,
        quality: Double,
        maximumBytes: Int
    ) async throws -> Data {
        guard case let .pixelBuffer(pixelBuffer) = frame.payload else {
            throw ScreenCaptureError.encodingFailed
        }

        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = context.createCGImage(image, from: image.extent) else {
            throw ScreenCaptureError.encodingFailed
        }

        // Reduce quality a bounded number of times. If the frame still cannot
        // fit, it is discarded and the capture fails closed rather than
        // emitting an oversized transport payload.
        var candidateQuality = quality
        for _ in 0 ..< 4 {
            let output = CFDataCreateMutable(nil, 0)!
            guard let destination = CGImageDestinationCreateWithData(
                output,
                "public.jpeg" as CFString,
                1,
                nil
            ) else {
                throw ScreenCaptureError.encodingFailed
            }
            CGImageDestinationAddImage(
                destination,
                cgImage,
                [kCGImageDestinationLossyCompressionQuality: candidateQuality] as CFDictionary
            )
            guard CGImageDestinationFinalize(destination) else {
                throw ScreenCaptureError.encodingFailed
            }
            let encoded = output as Data
            if encoded.count <= maximumBytes {
                return encoded
            }
            candidateQuality = max(0.2, candidateQuality - 0.15)
        }
        throw ScreenCaptureError.frameTooLarge
    }
}

public actor ViewOnlyScreenCapture {
    public typealias EventHandler = @Sendable (ScreenCaptureEvent) -> Void

    private struct ActiveCapture {
        let token: UUID
        let descriptor: ScreenCaptureDescriptor
        let backendSession: any ScreenCaptureBackendSession
        let ingress: ScreenCaptureFrameIngress
        let pump: ScreenCaptureFramePump
        let eventHandler: EventHandler
    }

    private struct StartingCapture {
        let token: UUID
        let descriptor: ScreenCaptureDescriptor
        let ingress: ScreenCaptureFrameIngress
        let pump: ScreenCaptureFramePump
        let eventHandler: EventHandler
        var failure: ScreenCaptureError?
    }

    private let backend: any ScreenCaptureBackend
    private let encoder: any ScreenCaptureFrameEncoding
    private var active: ActiveCapture?
    private var starting: StartingCapture?

    public init(
        backend: any ScreenCaptureBackend = ScreenCaptureKitBackend(),
        encoder: any ScreenCaptureFrameEncoding = JPEGScreenCaptureFrameEncoder()
    ) {
        self.backend = backend
        self.encoder = encoder
    }

    @discardableResult
    public func start(
        sessionID: String,
        requestedDisplayID: UInt32? = nil,
        authorization: ScreenCaptureAuthorization,
        limits: ScreenCaptureLimits,
        onEvent: @escaping EventHandler
    ) async throws -> ScreenCaptureDescriptor {
        let trimmedSessionID = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSessionID.isEmpty, trimmedSessionID.utf8.count <= 128 else {
            throw ScreenCaptureError.invalidSessionID
        }

        if let active {
            if active.descriptor.sessionID == trimmedSessionID {
                return active.descriptor
            }
            throw ScreenCaptureError.alreadyRunning(active.descriptor.sessionID)
        }
        if let starting {
            if starting.descriptor.sessionID == trimmedSessionID {
                return starting.descriptor
            }
            throw ScreenCaptureError.alreadyRunning(starting.descriptor.sessionID)
        }
        guard !authorization.sessionLocked else {
            throw ScreenCaptureError.sessionLocked
        }
        guard authorization.explicitlyAuthorized else {
            throw ScreenCaptureError.explicitAuthorizationRequired
        }
        guard await backend.preflightAuthorized() else {
            throw ScreenCaptureError.permissionNotGranted
        }

        let displays: [ScreenCaptureDisplay]
        do {
            displays = try await backend.availableDisplays()
        } catch let error as ScreenCaptureError {
            throw error
        } catch {
            throw ScreenCaptureError.backendFailure("display discovery")
        }
        guard !displays.isEmpty else {
            throw ScreenCaptureError.noDisplaysAvailable
        }

        let selected: ScreenCaptureDisplay
        if let requestedDisplayID {
            guard let requested = displays.first(where: { $0.displayID == requestedDisplayID }) else {
                throw ScreenCaptureError.displayUnavailable(requestedDisplayID)
            }
            selected = requested
        } else {
            selected = displays.sorted {
                if $0.isMain != $1.isMain { return $0.isMain && !$1.isMain }
                return $0.displayID < $1.displayID
            }[0]
        }

        let size = Self.fittedSize(
            sourceWidth: selected.width,
            sourceHeight: selected.height,
            maximumWidth: limits.maximumWidth,
            maximumHeight: limits.maximumHeight
        )
        let configuration = ScreenCaptureBackendConfiguration(
            width: size.width,
            height: size.height,
            framesPerSecond: limits.framesPerSecond,
            queueDepth: limits.queueDepth
        )
        let descriptor = ScreenCaptureDescriptor(
            sessionID: trimmedSessionID,
            displayID: selected.displayID,
            width: size.width,
            height: size.height,
            framesPerSecond: limits.framesPerSecond
        )
        let token = UUID()
        let pump = ScreenCaptureFramePump(
            descriptor: descriptor,
            limits: limits,
            encoder: encoder,
            eventHandler: onEvent,
            failureHandler: { [weak self] error in
                Task { await self?.failCapture(token: token, error: error) }
            }
        )
        let ingress = ScreenCaptureFrameIngress(pump: pump)
        starting = StartingCapture(
            token: token,
            descriptor: descriptor,
            ingress: ingress,
            pump: pump,
            eventHandler: onEvent,
            failure: nil
        )

        let backendSession: any ScreenCaptureBackendSession
        do {
            backendSession = try await backend.startCapture(
                displayID: selected.displayID,
                configuration: configuration,
                onFrame: { frame in
                    ingress.submit(frame)
                },
                onTermination: { [weak self] error in
                    Task { await self?.backendTerminated(token: token, error: error) }
                }
            )
        } catch let error as ScreenCaptureError {
            if starting?.token == token { starting = nil }
            ingress.stop()
            await pump.stop()
            throw error
        } catch {
            if starting?.token == token { starting = nil }
            ingress.stop()
            await pump.stop()
            throw ScreenCaptureError.backendFailure("start")
        }


        if let pending = starting, pending.token == token, let failure = pending.failure {
            starting = nil
            ingress.stop()
            await pump.stop()
            try? await backendSession.stop()
            onEvent(.failed(sessionID: descriptor.sessionID, error: failure))
            throw failure
        }
        guard starting?.token == token else {
            ingress.stop()
            await pump.stop()
            try? await backendSession.stop()
            throw ScreenCaptureError.captureInterrupted
        }
        starting = nil

        active = ActiveCapture(
            token: token,
            descriptor: descriptor,
            backendSession: backendSession,
            ingress: ingress,
            pump: pump,
            eventHandler: onEvent
        )
        return descriptor
    }

    public func stop(sessionID: String) async throws {
        if var pending = starting {
            guard pending.descriptor.sessionID == sessionID else {
                throw ScreenCaptureError.sessionMismatch
            }
            pending.failure = .captureInterrupted
            starting = pending
            pending.ingress.stop()
            await pending.pump.stop()
            return
        }
        guard let current = active else { return }
        guard current.descriptor.sessionID == sessionID else {
            throw ScreenCaptureError.sessionMismatch
        }
        active = nil
        current.ingress.stop()
        await current.pump.stop()
        do {
            try await current.backendSession.stop()
            current.eventHandler(.stopped(sessionID: sessionID))
        } catch {
            let failure = ScreenCaptureError.backendFailure("stop")
            current.eventHandler(.failed(sessionID: sessionID, error: failure))
            throw failure
        }
    }

    public func isRunning(sessionID: String? = nil) -> Bool {
        let descriptor = active?.descriptor ?? starting?.descriptor
        guard let descriptor else { return false }
        return sessionID.map { $0 == descriptor.sessionID } ?? true
    }

    private func failCapture(token: UUID, error: ScreenCaptureError) async {
        if var pending = starting, pending.token == token {
            pending.failure = error
            starting = pending
            pending.ingress.stop()
            await pending.pump.stop()
            return
        }
        guard let current = active, current.token == token else { return }
        active = nil
        current.ingress.stop()
        await current.pump.stop()
        try? await current.backendSession.stop()
        current.eventHandler(.failed(sessionID: current.descriptor.sessionID, error: error))
    }

    private func backendTerminated(token: UUID, error: ScreenCaptureError) async {
        if var pending = starting, pending.token == token {
            pending.failure = error
            starting = pending
            pending.ingress.stop()
            await pending.pump.stop()
            return
        }
        guard let current = active, current.token == token else { return }
        active = nil
        current.ingress.stop()
        await current.pump.stop()
        current.eventHandler(.failed(sessionID: current.descriptor.sessionID, error: error))
    }

    private static func fittedSize(
        sourceWidth: Int,
        sourceHeight: Int,
        maximumWidth: Int,
        maximumHeight: Int
    ) -> (width: Int, height: Int) {
        guard sourceWidth > 0, sourceHeight > 0 else { return (1, 1) }
        let scale = min(
            1,
            Double(maximumWidth) / Double(sourceWidth),
            Double(maximumHeight) / Double(sourceHeight)
        )
        return (
            max(1, Int((Double(sourceWidth) * scale).rounded(.down))),
            max(1, Int((Double(sourceHeight) * scale).rounded(.down)))
        )
    }
}

/// Converts the synchronous ScreenCaptureKit callback into a single async
/// encoder worker. The lock protects only the replaceable newest-frame slot;
/// pixel conversion and callbacks always happen outside it.
private final class ScreenCaptureFrameIngress: @unchecked Sendable {
    private let lock = NSLock()
    private let pump: ScreenCaptureFramePump
    private var newestFrame: ScreenCaptureRawFrame?
    private var workerRunning = false
    private var stopped = false

    init(pump: ScreenCaptureFramePump) {
        self.pump = pump
    }

    func submit(_ frame: ScreenCaptureRawFrame) {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        newestFrame = frame
        let shouldStartWorker = !workerRunning
        workerRunning = true
        lock.unlock()

        if shouldStartWorker {
            Task { await drain() }
        }
    }

    func stop() {
        lock.lock()
        stopped = true
        newestFrame = nil
        lock.unlock()
    }

    private func drain() async {
        while let frame = takeNewestFrame() {
            guard await pump.process(frame) else {
                stop()
                return
            }
        }
    }

    private func takeNewestFrame() -> ScreenCaptureRawFrame? {
        lock.lock()
        defer { lock.unlock() }
        guard !stopped, let frame = newestFrame else {
            workerRunning = false
            return nil
        }
        newestFrame = nil
        return frame
    }
}

private actor ScreenCaptureFramePump {
    private let descriptor: ScreenCaptureDescriptor
    private let limits: ScreenCaptureLimits
    private let encoder: any ScreenCaptureFrameEncoding
    private let eventHandler: ViewOnlyScreenCapture.EventHandler
    private let failureHandler: @Sendable (ScreenCaptureError) -> Void

    private var isStopped = false
    private var sequence: UInt64 = 0

    init(
        descriptor: ScreenCaptureDescriptor,
        limits: ScreenCaptureLimits,
        encoder: any ScreenCaptureFrameEncoding,
        eventHandler: @escaping ViewOnlyScreenCapture.EventHandler,
        failureHandler: @escaping @Sendable (ScreenCaptureError) -> Void
    ) {
        self.descriptor = descriptor
        self.limits = limits
        self.encoder = encoder
        self.eventHandler = eventHandler
        self.failureHandler = failureHandler
    }

    func process(_ frame: ScreenCaptureRawFrame) async -> Bool {
        guard !isStopped else { return false }
        guard frame.displayID == descriptor.displayID,
              frame.width > 0,
              frame.height > 0,
              frame.width <= limits.maximumWidth,
              frame.height <= limits.maximumHeight else {
            fail(.malformedFrame)
            return false
        }

        do {
            let bytes = try await encoder.encode(
                frame,
                quality: limits.jpegQuality,
                maximumBytes: limits.maximumFrameBytes
            )
            guard !isStopped else { return false }
            guard !bytes.isEmpty, bytes.count <= limits.maximumFrameBytes else {
                fail(bytes.isEmpty ? .encodingFailed : .frameTooLarge)
                return false
            }
            sequence &+= 1
            eventHandler(.frame(ScreenCaptureFrame(
                sessionID: descriptor.sessionID,
                sequence: sequence,
                capturedAt: frame.capturedAt,
                displayID: descriptor.displayID,
                width: frame.width,
                height: frame.height,
                mediaType: "image/jpeg",
                bytes: bytes
            )))
            return true
        } catch let error as ScreenCaptureError {
            fail(error)
            return false
        } catch {
            fail(.encodingFailed)
            return false
        }
    }

    func stop() {
        isStopped = true
    }

    private func fail(_ error: ScreenCaptureError) {
        guard !isStopped else { return }
        isStopped = true
        failureHandler(error)
    }
}

public final class ScreenCaptureKitBackend: ScreenCaptureBackend, @unchecked Sendable {
    public init() {}

    public func preflightAuthorized() async -> Bool {
        // This API never prompts. Permission requests must happen only through
        // a separate, explicit user action in signed app UI.
        CGPreflightScreenCaptureAccess()
    }

    public func availableDisplays() async throws -> [ScreenCaptureDisplay] {
        guard CGPreflightScreenCaptureAccess() else {
            throw ScreenCaptureError.permissionNotGranted
        }
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        return content.displays.map { display in
            ScreenCaptureDisplay(
                displayID: display.displayID,
                width: display.width,
                height: display.height,
                isMain: CGDisplayIsMain(display.displayID) != 0
            )
        }
    }

    public func startCapture(
        displayID: UInt32,
        configuration: ScreenCaptureBackendConfiguration,
        onFrame: @escaping @Sendable (ScreenCaptureRawFrame) -> Void,
        onTermination: @escaping @Sendable (ScreenCaptureError) -> Void
    ) async throws -> any ScreenCaptureBackendSession {
        guard CGPreflightScreenCaptureAccess() else {
            throw ScreenCaptureError.permissionNotGranted
        }
        // Re-fetch immediately before creating the filter. If the selected
        // display disappeared after discovery, do not guess another target.
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )
        guard let display = content.displays.first(where: { $0.displayID == displayID }) else {
            throw ScreenCaptureError.displayUnavailable(displayID)
        }

        let streamConfiguration = SCStreamConfiguration()
        streamConfiguration.width = configuration.width
        streamConfiguration.height = configuration.height
        streamConfiguration.minimumFrameInterval = CMTime(
            value: 1,
            timescale: CMTimeScale(configuration.framesPerSecond)
        )
        streamConfiguration.queueDepth = configuration.queueDepth
        streamConfiguration.pixelFormat = kCVPixelFormatType_32BGRA
        streamConfiguration.capturesAudio = false
        streamConfiguration.showsCursor = true

        let output = ScreenCaptureKitOutput(displayID: displayID, onFrame: onFrame)
        let session = ScreenCaptureKitSession(output: output, onTermination: onTermination)
        let stream = SCStream(
            filter: SCContentFilter(display: display, excludingWindows: []),
            configuration: streamConfiguration,
            delegate: session
        )
        session.attach(stream: stream)
        do {
            try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: output.queue)
            try await stream.startCapture()
            return session
        } catch {
            try? await session.stop()
            throw ScreenCaptureError.backendFailure("start")
        }
    }
}

private final class ScreenCaptureKitOutput: NSObject, SCStreamOutput, @unchecked Sendable {
    let queue = DispatchQueue(label: "com.thingtime.desktop.node.screen-frames", qos: .userInitiated)
    private let displayID: UInt32
    private let onFrame: @Sendable (ScreenCaptureRawFrame) -> Void

    init(displayID: UInt32, onFrame: @escaping @Sendable (ScreenCaptureRawFrame) -> Void) {
        self.displayID = displayID
        self.onFrame = onFrame
    }

    func stream(
        _: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of outputType: SCStreamOutputType
    ) {
        guard outputType == .screen,
              CMSampleBufferIsValid(sampleBuffer),
              CMSampleBufferDataIsReady(sampleBuffer),
              let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        onFrame(ScreenCaptureRawFrame(
            displayID: displayID,
            capturedAt: Date(),
            width: CVPixelBufferGetWidth(pixelBuffer),
            height: CVPixelBufferGetHeight(pixelBuffer),
            payload: .pixelBuffer(pixelBuffer)
        ))
    }
}

private final class ScreenCaptureKitSession: NSObject, ScreenCaptureBackendSession, SCStreamDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let output: ScreenCaptureKitOutput
    private let onTermination: @Sendable (ScreenCaptureError) -> Void
    private var stream: SCStream?
    private var stoppingIntentionally = false
    private var terminationDelivered = false

    init(
        output: ScreenCaptureKitOutput,
        onTermination: @escaping @Sendable (ScreenCaptureError) -> Void
    ) {
        self.output = output
        self.onTermination = onTermination
    }

    func attach(stream: SCStream) {
        lock.lock()
        self.stream = stream
        lock.unlock()
    }

    func stop() async throws {
        let stream = beginIntentionalStop()
        try await stream?.stopCapture()
    }

    private func beginIntentionalStop() -> SCStream? {
        lock.lock()
        if stoppingIntentionally {
            lock.unlock()
            return nil
        }
        stoppingIntentionally = true
        let stream = stream
        self.stream = nil
        lock.unlock()
        return stream
    }

    func stream(_: SCStream, didStopWithError _: Error) {
        lock.lock()
        let shouldNotify = !stoppingIntentionally && !terminationDelivered
        terminationDelivered = true
        stream = nil
        lock.unlock()
        if shouldNotify {
            onTermination(.captureInterrupted)
        }
    }
}
