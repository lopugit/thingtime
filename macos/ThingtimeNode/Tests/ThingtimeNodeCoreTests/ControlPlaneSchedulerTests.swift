import Foundation
import XCTest
@testable import ThingtimeNodeCore

private actor TestControlPlaneClient: ControlPlaneClient {
    enum Failure: Error { case heartbeat, leaseHeartbeat }

    var heartbeatCount = 0
    var leaseCount = 0
    var leaseHeartbeatCount = 0
    var leaseHeartbeatCounts: [String: Int] = [:]
    var reports: [CommandExecutionReport] = []
    var batches: [CommandLeaseBatch]
    let heartbeatFails: Bool
    let leaseHeartbeatFails: Bool

    init(batch: CommandLeaseBatch, heartbeatFails: Bool = false, leaseHeartbeatFails: Bool = false) {
        batches = [batch]
        self.heartbeatFails = heartbeatFails
        self.leaseHeartbeatFails = leaseHeartbeatFails
    }

    init(batches: [CommandLeaseBatch], heartbeatFails: Bool = false, leaseHeartbeatFails: Bool = false) {
        self.batches = batches
        self.heartbeatFails = heartbeatFails
        self.leaseHeartbeatFails = leaseHeartbeatFails
    }

    func preparePairing(_ request: PairingPrepareRequest) async throws -> PairingPrepareResponse {
        PairingPrepareResponse(pairingID: "pairing", serverNonce: Data(repeating: 1, count: 32), expiresAt: Date().addingTimeInterval(60))
    }

    func claimPairing(_ request: PairingClaimRequest) async throws -> PairingClaimResponse {
        PairingClaimResponse(deviceID: "device", refreshToken: "token")
    }

    func sendHeartbeat(_ heartbeat: DeviceHeartbeat) async throws {
        heartbeatCount += 1
        if heartbeatFails { throw Failure.heartbeat }
    }

    func leaseCommands(_ request: CommandLeaseRequest) async throws -> CommandLeaseBatch {
        leaseCount += 1
        return batches.isEmpty ? .init(commands: []) : batches.removeFirst()
    }

    func heartbeatCommand(commandID: String, leaseID: String) async throws -> Date {
        leaseHeartbeatCount += 1
        leaseHeartbeatCounts[commandID, default: 0] += 1
        if leaseHeartbeatFails { throw Failure.leaseHeartbeat }
        return Date().addingTimeInterval(30)
    }

    func waitForLeaseHeartbeats(atLeast minimum: Int, within timeout: Duration) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        while leaseHeartbeatCount < minimum {
            guard clock.now < deadline else { return false }
            try? await Task.sleep(for: .milliseconds(1))
        }
        return true
    }

    func reportCommand(_ report: CommandExecutionReport) async throws {
        reports.append(report)
    }
}

private actor ConcurrentDispatchProbe {
    private(set) var dispatched: [String] = []
    private(set) var completed: [String] = []
    private(set) var maximumSerialDispatches = 0
    private var activeSerialDispatches = 0
    private var completedControls = Set<String>()
    private var releaseQueue = false

    func dispatch(_ command: LeasedCommand) async -> NodeResponse {
        dispatched.append(command.commandID)
        if command.parameters.objectValue?["delivery"]?.stringValue == "queue" {
            while !releaseQueue {
                do {
                    try await Task.sleep(for: .milliseconds(2))
                } catch {
                    return .failure(
                        id: command.leaseID,
                        code: ThingtimeNodeError.commandOutcomeUncertain.code,
                        message: "cancelled"
                    )
                }
            }
            completed.append(command.commandID)
            return .success(id: command.leaseID)
        }

        activeSerialDispatches += 1
        maximumSerialDispatches = max(maximumSerialDispatches, activeSerialDispatches)
        do {
            try await Task.sleep(for: .milliseconds(15))
        } catch {
            activeSerialDispatches -= 1
            return .failure(
                id: command.leaseID,
                code: ThingtimeNodeError.commandOutcomeUncertain.code,
                message: "cancelled"
            )
        }
        completedControls.insert(command.commandID)
        completed.append(command.commandID)
        if completedControls.isSuperset(of: ["interrupt", "steer"]) { releaseQueue = true }
        activeSerialDispatches -= 1
        return .success(id: command.leaseID)
    }
}

final class ControlPlaneSchedulerTests: XCTestCase {
    private func heartbeat(at now: Date) -> DeviceHeartbeat {
        DeviceHeartbeat(
            deviceID: "device-1",
            telemetry: DeviceTelemetry(
                deviceName: "Mac",
                hostName: "mac.local",
                modelIdentifier: "Mac1,1",
                operatingSystemVersion: "macOS",
                architecture: "arm64",
                outputVolume: 0.5,
                session: SessionTelemetry(isLocked: false, isOnConsole: true),
                permissions: PermissionPreflight(accessibility: .denied, screenRecording: .denied),
                runningApplications: [],
                displays: [],
                collectedAt: now
            ),
            connector: ConnectorRuntimeHealth(state: .running),
            observedAt: now
        )
    }

    func testRunOnceHeartbeatsDispatchesAndReports() async throws {
        let now = Date(timeIntervalSince1970: 4_000)
        let command = LeasedCommand(
            commandID: "command-1",
            leaseID: "lease-1",
            method: "connector.send",
            parameters: .object([:]),
            leaseExpiresAt: now.addingTimeInterval(30)
        )
        let client = TestControlPlaneClient(batch: CommandLeaseBatch(commands: [command]))
        let heartbeat = heartbeat(at: now)
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: ControlPlaneSchedulerHooks(
                makeHeartbeat: { heartbeat },
                dispatchCommand: { leased in
                    .success(id: leased.leaseID, result: .bool(true))
                }
            )
        )

        try await scheduler.runOnce(now: now)
        let heartbeatCount = await client.heartbeatCount
        let reports = await client.reports
        XCTAssertEqual(heartbeatCount, 1)
        XCTAssertEqual(reports.count, 1)
        XCTAssertEqual(reports.first?.commandID, "command-1")
        XCTAssertEqual(reports.first?.status, .succeeded)
    }

    func testLongRunningDispatchRenewsLeaseAndStopsRenewingAfterCompletion() async throws {
        let now = Date()
        let command = LeasedCommand(
            commandID: "command-long",
            leaseID: "lease-long",
            method: "session.send",
            parameters: .object([:]),
            leaseExpiresAt: now.addingTimeInterval(30)
        )
        let client = TestControlPlaneClient(batch: .init(commands: [command]))
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: .init(
                makeHeartbeat: { self.heartbeat(at: now) },
                dispatchCommand: { leased in
                    guard await client.waitForLeaseHeartbeats(atLeast: 3, within: .seconds(1)) else {
                        return .failure(
                            id: leased.leaseID,
                            code: "test_timeout",
                            message: "The lease heartbeat did not renew three times while dispatch was active."
                        )
                    }
                    return .success(id: leased.leaseID, result: .bool(true))
                }
            ),
            leaseHeartbeatInterval: .milliseconds(10)
        )

        try await scheduler.runOnce(now: now)
        let countAtCompletion = await client.leaseHeartbeatCount
        let statusAtCompletion = await client.reports.first?.status
        XCTAssertGreaterThanOrEqual(countAtCompletion, 3)
        XCTAssertEqual(statusAtCompletion, .succeeded)
        try await Task.sleep(for: .milliseconds(35))
        let countAfterWaiting = await client.leaseHeartbeatCount
        XCTAssertEqual(countAfterWaiting, countAtCompletion)
    }

    func testLeaseHeartbeatFailureReportsAmbiguousOutcome() async throws {
        let now = Date()
        let command = LeasedCommand(
            commandID: "command-uncertain",
            leaseID: "lease-uncertain",
            method: "session.send",
            parameters: .object([:]),
            leaseExpiresAt: now.addingTimeInterval(30)
        )
        let client = TestControlPlaneClient(
            batch: .init(commands: [command]),
            leaseHeartbeatFails: true
        )
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: .init(
                makeHeartbeat: { self.heartbeat(at: now) },
                dispatchCommand: { leased in
                    try? await Task.sleep(for: .milliseconds(35))
                    return .success(id: leased.leaseID, result: .bool(true))
                }
            ),
            leaseHeartbeatInterval: .milliseconds(5)
        )

        try await scheduler.runOnce(now: now)
        let reports = await client.reports
        let report = try XCTUnwrap(reports.first)
        XCTAssertEqual(report.status, .uncertain)
        XCTAssertEqual(report.response.error?.code, ThingtimeNodeError.commandOutcomeUncertain.code)
    }

    func testStateHeartbeatFailureDoesNotStrandCommandClaimOrReport() async throws {
        let now = Date()
        let command = LeasedCommand(
            commandID: "command-after-state-rejection",
            leaseID: "lease-after-state-rejection",
            method: "connector.stop",
            parameters: .object([:]),
            leaseExpiresAt: now.addingTimeInterval(30)
        )
        let client = TestControlPlaneClient(batch: .init(commands: [command]), heartbeatFails: true)
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: .init(
                makeHeartbeat: { self.heartbeat(at: now) },
                dispatchCommand: { .success(id: $0.leaseID, result: .bool(true)) }
            ),
            leaseHeartbeatInterval: .seconds(10)
        )

        try await scheduler.runOnce(now: now)
        let heartbeatCount = await client.heartbeatCount
        let leaseCount = await client.leaseCount
        let reportStatus = await client.reports.first?.status
        XCTAssertEqual(heartbeatCount, 1)
        XCTAssertEqual(leaseCount, 1)
        XCTAssertEqual(reportStatus, .succeeded)
    }

    func testStoppingSchedulerCancelsInFlightLeaseHeartbeatWithoutReporting() async throws {
        let now = Date()
        let command = LeasedCommand(
            commandID: "command-stop",
            leaseID: "lease-stop",
            method: "session.send",
            parameters: .object([:]),
            leaseExpiresAt: now.addingTimeInterval(30)
        )
        let client = TestControlPlaneClient(batch: .init(commands: [command]))
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: .init(
                makeHeartbeat: { self.heartbeat(at: now) },
                dispatchCommand: { leased in
                    do {
                        try await Task.sleep(for: .seconds(5))
                    } catch {}
                    return .success(id: leased.leaseID, result: .bool(true))
                }
            ),
            leaseHeartbeatInterval: .milliseconds(5)
        )

        await scheduler.start(delayBetweenPolls: .seconds(5))
        for _ in 0 ..< 50 {
            if await client.leaseHeartbeatCount > 0 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let countBeforeStop = await client.leaseHeartbeatCount
        XCTAssertGreaterThan(countBeforeStop, 0)
        await scheduler.stop()
        try await Task.sleep(for: .milliseconds(25))
        let countAfterStop = await client.leaseHeartbeatCount
        let reportsAfterStop = await client.reports
        try await Task.sleep(for: .milliseconds(25))
        let finalCount = await client.leaseHeartbeatCount
        XCTAssertEqual(finalCount, countAfterStop)
        XCTAssertTrue(reportsAfterStop.isEmpty)
    }

    func testRemoteInterruptAndSteerOvertakeBlockedQueueWithIndependentLeaseRenewal() async throws {
        let now = Date()
        let queue = LeasedCommand(
            commandID: "queue",
            leaseID: "lease-queue",
            method: "session.send",
            parameters: .object(["delivery": .string("queue")]),
            leaseExpiresAt: now.addingTimeInterval(60)
        )
        let interrupt = LeasedCommand(
            commandID: "interrupt",
            leaseID: "lease-interrupt",
            method: "session.interrupt",
            parameters: .object([:]),
            leaseExpiresAt: now.addingTimeInterval(60)
        )
        let steer = LeasedCommand(
            commandID: "steer",
            leaseID: "lease-steer",
            method: "session.send",
            parameters: .object(["delivery": .string("steer")]),
            leaseExpiresAt: now.addingTimeInterval(60)
        )
        let client = TestControlPlaneClient(batches: [queue, interrupt, steer].map {
            .init(commands: [$0])
        })
        let probe = ConcurrentDispatchProbe()
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: .init(
                makeHeartbeat: { self.heartbeat(at: now) },
                dispatchCommand: { await probe.dispatch($0) }
            ),
            leaseHeartbeatInterval: .milliseconds(2)
        )

        await scheduler.start(delayBetweenPolls: .milliseconds(1))
        for _ in 0 ..< 400 {
            if await client.reports.count == 3 { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        await scheduler.stop()

        let dispatched = await probe.dispatched
        let completed = await probe.completed
        let maximumSerialDispatches = await probe.maximumSerialDispatches
        let reports = await client.reports
        let heartbeatCounts = await client.leaseHeartbeatCounts
        XCTAssertEqual(dispatched, ["queue", "interrupt", "steer"])
        XCTAssertEqual(reports.count, 3)
        XCTAssertLessThan(
            try XCTUnwrap(completed.firstIndex(of: "interrupt")),
            try XCTUnwrap(completed.firstIndex(of: "queue"))
        )
        XCTAssertLessThan(
            try XCTUnwrap(completed.firstIndex(of: "steer")),
            try XCTUnwrap(completed.firstIndex(of: "queue"))
        )
        XCTAssertGreaterThan(heartbeatCounts["queue", default: 0], 0)
        XCTAssertEqual(maximumSerialDispatches, 1)
    }

    func testQueueWaitConcurrencyCapFailsOverflowAndStopCancelsTheTrackedWait() async throws {
        let now = Date()
        let queues = (1 ... 2).map { index in
            LeasedCommand(
                commandID: "queue-\(index)",
                leaseID: "lease-queue-\(index)",
                method: "session.send",
                parameters: .object(["delivery": .string("queue")]),
                leaseExpiresAt: now.addingTimeInterval(60)
            )
        }
        let client = TestControlPlaneClient(batches: queues.map { .init(commands: [$0]) })
        let probe = ConcurrentDispatchProbe()
        let scheduler = ControlPlaneScheduler(
            client: client,
            hooks: .init(
                makeHeartbeat: { self.heartbeat(at: now) },
                dispatchCommand: { await probe.dispatch($0) }
            ),
            leaseHeartbeatInterval: .milliseconds(2),
            maximumConcurrentCommands: 4,
            maximumConcurrentQueueWaits: 1
        )

        await scheduler.start(delayBetweenPolls: .milliseconds(1))
        for _ in 0 ..< 200 {
            if await client.reports.contains(where: { $0.commandID == "queue-2" }) { break }
            try await Task.sleep(for: .milliseconds(5))
        }
        let overflowReport = await client.reports.first(where: { $0.commandID == "queue-2" })
        let dispatched = await probe.dispatched
        XCTAssertEqual(overflowReport?.status, .failed)
        XCTAssertEqual(dispatched, ["queue-1"])
        await scheduler.stop()
        let reportsAfterStop = await client.reports
        XCTAssertFalse(reportsAfterStop.contains(where: { $0.commandID == "queue-1" }))
    }
}
