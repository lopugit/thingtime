import ARKit
import Foundation

final class LiDARRecorder: NSObject, ARSessionDelegate, @unchecked Sendable {
    enum Update: Sendable {
        case recording(frameCount: Int, bytes: Int64, elapsed: TimeInterval, tracking: String, hasDepth: Bool)
        case finalizing
        case saved(LiDARCapture)
        case failed(message: String, canRecover: Bool)
        case discardFailed(uploadDisabled: Bool)
        case discarded
    }

    static var isSupported: Bool {
        ARWorldTrackingConfiguration.isSupported && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }

    private final class DeliveryGate: @unchecked Sendable {
        private let lock = NSLock()
        private var discarded = false

        func discard() {
            lock.lock()
            defer { lock.unlock() }
            discarded = true
        }

        var allowsSave: Bool {
            lock.lock()
            defer { lock.unlock() }
            return !discarded
        }
    }

    let session = ARSession()
    private let deliveryGate = DeliveryGate()
    private let queue = DispatchQueue(label: "com.thingtime.lidar.capture", qos: .userInitiated, autoreleaseFrequency: .workItem)
    private var store: LiDARCaptureStore?
    private var captureID: UUID?
    private var update: (@MainActor (Update) -> Void)?
    private var recording = false
    private var finalizationID: UUID?
    private var lastFrameTimestamp: TimeInterval?
    private var startedUptime: TimeInterval = 0
    private var lastProgressUptime: TimeInterval = 0
    private var lastSyncUptime: TimeInterval = 0
    private var slowFrames = 0
    private var eventIndex = 0

    override init() {
        super.init()
        session.delegateQueue = queue
        session.delegate = self
    }

    /// The caller must first obtain foreground camera authorization and
    /// durably reserve this ID for the original destination and account.
    func start(id: UUID, update: @escaping @MainActor (Update) -> Void) {
        queue.async {
            guard self.store == nil, self.captureID == nil else { return }
            self.update = update
            guard Self.isSupported else {
                self.emit(.failed(message: "This device does not support ARKit scene depth.", canRecover: false))
                return
            }
            let config = ARWorldTrackingConfiguration()
            config.worldAlignment = .gravity
            config.isLightEstimationEnabled = true
            config.frameSemantics.insert(.sceneDepth)
            if ARWorldTrackingConfiguration.supportsFrameSemantics([.sceneDepth, .smoothedSceneDepth]) {
                config.frameSemantics.insert(.smoothedSceneDepth)
            }
            let mesh: String
            if ARWorldTrackingConfiguration.supportsSceneReconstruction(.meshWithClassification) {
                config.sceneReconstruction = .meshWithClassification
                mesh = "meshWithClassification"
            } else if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
                config.sceneReconstruction = .mesh
                mesh = "mesh"
            } else {
                mesh = "unavailable"
            }
            let format = config.videoFormat
            let header = LiDARCaptureStore.Header(
                captureID: id, startedAt: Date(), nominalFramesPerSecond: format.framesPerSecond,
                videoWidth: Int(format.imageResolution.width), videoHeight: Int(format.imageResolution.height),
                sceneDepthEnabled: true, smoothedSceneDepthEnabled: config.frameSemantics.contains(.smoothedSceneDepth),
                meshReconstruction: mesh, systemVersion: ProcessInfo.processInfo.operatingSystemVersionString)
            do {
                self.store = try LiDARCaptureStore(header: header)
                self.captureID = id
                self.startedUptime = ProcessInfo.processInfo.systemUptime
                self.lastSyncUptime = self.startedUptime
                self.recording = true
                self.session.run(config, options: [.resetTracking, .removeExistingAnchors])
                self.emit(.recording(frameCount: 0, bytes: 0, elapsed: 0, tracking: "limited.initializing", hasDepth: false))
            } catch {
                self.emit(.failed(message: Self.failure(error, defaultMessage: "The scan could not start saving on this device."),
                                  canRecover: false))
            }
        }
    }

    func finish() {
        queue.async { self.beginFinalization(detail: nil, worldMap: true) }
    }

    func interrupt() {
        queue.async {
            if let id = self.finalizationID {
                self.seal(id: id, detail: nil, worldMapStatus: "interrupted while retrieving world map")
            } else {
                self.beginFinalization(detail: "The scanner closed before recording finished.", worldMap: false)
            }
        }
    }

    func discard(uploadDisabled: Bool) {
        // Block an already-enqueued save notification before processing
        // the discard on the capture queue.
        deliveryGate.discard()
        queue.async {
            guard let id = self.captureID else { return }
            self.finalizationID = nil
            self.recording = false
            self.session.pause()
            do {
                if let store = self.store {
                    try store.discard(uploadDisabled: uploadDisabled)
                    self.store = nil
                } else {
                    // An ARKit or I/O failure can have sealed a partial scan
                    // while the discard confirmation was onscreen.
                    try LiDARCaptureStore.discardClosed(id: id, uploadDisabled: uploadDisabled)
                }
                self.emit(.discarded)
            } catch let failure as LiDARCaptureStore.DiscardFailure {
                self.emit(.discardFailed(uploadDisabled: failure.uploadDisabled))
            } catch {
                self.emit(.discardFailed(uploadDisabled: uploadDisabled))
            }
        }
    }

    func retryLocalSave() {
        queue.async {
            guard let id = self.captureID, self.store == nil, !self.recording, self.finalizationID == nil else { return }
            self.emit(.finalizing)
            do {
                guard let capture = try LiDARCapture.recover(id: id) else {
                    self.emit(.failed(message: "The local scan could not be reopened.", canRecover: true))
                    return
                }
                self.emit(.saved(capture))
            } catch {
                self.emit(.failed(message: Self.failure(error, defaultMessage: "The scan is still on this device, but could not be finalized."),
                                  canRecover: true))
            }
        }
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard recording, let store else { return }
        let uptime = ProcessInfo.processInfo.systemUptime
        let nominalInterval = 1 / Double(max(1, store.header.nominalFramesPerSecond))
        let gap = lastFrameTimestamp.flatMap { last -> LiDARFrameWriter.TimestampGap? in
            let delta = frame.timestamp - last
            guard delta > nominalInterval * 1.75 || delta <= 0 else { return nil }
            return .init(previousTimestamp: last, timestamp: frame.timestamp,
                         observedInterval: delta, nominalInterval: nominalInterval)
        }
        do {
            try LiDARFrameWriter.write(frame: frame, to: store, index: store.counts.frames,
                                       callbackUptime: uptime, gap: gap)
            lastFrameTimestamp = frame.timestamp
            if uptime - lastSyncUptime >= 2 {
                try store.synchronize()
                lastSyncUptime = uptime
            }
            if uptime - lastProgressUptime >= 0.4 {
                emit(.recording(frameCount: store.counts.frames, bytes: store.byteCount, elapsed: uptime - startedUptime,
                                tracking: LiDARFrameWriter.tracking(frame.camera.trackingState),
                                hasDepth: store.counts.sceneDepth > 0))
                lastProgressUptime = uptime
            }
            // Do not build an unbounded queue of retained ARFrames. If
            // synchronous capture is persistently slower than the producer,
            // stop rather than silently switching to a sampled stream.
            let elapsed = ProcessInfo.processInfo.systemUptime - uptime
            slowFrames = elapsed > nominalInterval * 2 ? slowFrames + 1 : 0
            if slowFrames >= 4 {
                beginFinalization(detail: "The device could not save frames fast enough. The recorded portion was kept.", worldMap: false)
            }
        } catch {
            beginFinalization(detail: Self.failure(error, defaultMessage: "A frame could not be saved. The earlier data was kept."),
                              worldMap: false)
        }
    }

    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { write(anchors, event: "added") }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { write(anchors, event: "updated") }
    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) { write(anchors, event: "removed") }

    func sessionWasInterrupted(_ session: ARSession) {
        beginFinalization(detail: "The camera session was interrupted. The recorded portion was kept.", worldMap: false)
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        beginFinalization(detail: "ARKit stopped the camera session. The recorded portion was kept.", worldMap: false)
    }

    private func write(_ anchors: [ARAnchor], event: String) {
        guard recording, let store else { return }
        let uptime = ProcessInfo.processInfo.systemUptime
        do {
            for anchor in anchors {
                try LiDARFrameWriter.write(anchor: anchor, event: event, index: eventIndex,
                                           frameTimestamp: lastFrameTimestamp, callbackUptime: uptime, to: store)
                eventIndex += 1
            }
        } catch {
            beginFinalization(detail: Self.failure(error, defaultMessage: "A scene update could not be saved. The earlier data was kept."),
                              worldMap: false)
        }
    }

    private func beginFinalization(detail: String?, worldMap: Bool) {
        guard recording, store != nil, finalizationID == nil else { return }
        recording = false
        let id = UUID()
        finalizationID = id
        emit(.finalizing)
        guard worldMap else {
            seal(id: id, detail: detail, worldMapStatus: "not requested after interruption")
            return
        }
        // Apple's completion runs on delegateQueue. Stop accepting frames
        // now, while the still-running session supplies its final map.
        session.getCurrentWorldMap { [weak self] map, _ in
            guard let self, finalizationID == id, let store else { return }
            var status = "ARKit did not supply a world map"
            if let map {
                do {
                    let data = try NSKeyedArchiver.archivedData(withRootObject: map, requiringSecureCoding: true)
                    try store.data("world-map.arexperience", data)
                    store.commit()
                    status = "available"
                } catch {
                    status = "world map could not be archived"
                }
            }
            seal(id: id, detail: detail, worldMapStatus: status)
        }
        queue.asyncAfter(deadline: .now() + .seconds(5)) {
            self.seal(id: id, detail: detail, worldMapStatus: "ARKit world map request timed out")
        }
    }

    private func seal(id: UUID, detail: String?, worldMapStatus: String) {
        guard finalizationID == id, let store else { return }
        finalizationID = nil
        session.pause()
        do {
            let capture = try store.finalize(detail: detail, worldMapStatus: worldMapStatus)
            self.store = nil
            emit(.saved(capture))
        } catch {
            self.store = nil
            emit(.failed(message: Self.failure(error, defaultMessage: "The scan is still on this device, but could not be finalized."),
                         canRecover: true))
        }
    }

    private func emit(_ event: Update) {
        guard let update else { return }
        DispatchQueue.main.async { [deliveryGate] in
            if case .saved = event, !deliveryGate.allowsSave { return }
            update(event)
        }
        if case .discarded = event { self.update = nil }
    }

    private static func failure(_ error: Error, defaultMessage: String) -> String {
        let nsError = error as NSError
        let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? NSError
        let full = nsError.domain == NSCocoaErrorDomain && nsError.code == CocoaError.fileWriteOutOfSpace.rawValue
            || nsError.domain == NSPOSIXErrorDomain && nsError.code == Int(ENOSPC)
            || underlying?.domain == NSPOSIXErrorDomain && underlying?.code == Int(ENOSPC)
        if full { return "The device ran out of storage. Free space to finish saving the recorded data." }
        return (error as? LiDARFrameWriter.BufferError)?.errorDescription ?? defaultMessage
    }
}
