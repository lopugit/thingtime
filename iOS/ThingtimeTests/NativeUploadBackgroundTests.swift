import XCTest
import UIKit
import BackgroundTasks
import AppleFileSync
@testable import Thingtime

@MainActor
private final class BackgroundTaskFixture: NativeUploadBackgroundTask {
    var expiration: (() -> Void)?
    let progress = Progress(totalUnitCount: 0)
    var completions = [Bool]()
    var subtitles = [String]()
    func update(subtitle: String) { subtitles.append(subtitle) }
    func complete(success: Bool) { completions.append(success) }
}
@MainActor
private final class BackgroundSchedulerFixture: NativeUploadBackgroundScheduling {
    var handler: ((NativeUploadBackgroundTask) -> Void)?
    var registrations = 0, submissions = 0, cancellations = 0
    var reject = false, unavailable = false
    var delivered: BackgroundTaskFixture?
    var requestedTitle: String?
    func register(_ handler: @escaping (NativeUploadBackgroundTask) -> Void) -> Bool {
        registrations += 1; self.handler = handler; return !unavailable
    }
    func submit() throws {
        submissions += 1
        if reject { throw URLError(.notConnectedToInternet) }
        if let delivered { handler?(delivered) }
    }
    func submit(title: String, subtitle: String) throws { requestedTitle = title; try submit() }
    func cancel() { cancellations += 1 }
}

@MainActor
private final class ProcessingTaskFixture: NativeDeferredUploadSystemTask {
    var expiration: (() -> Void)?
    var completions: [Bool] = []
    func complete(_ success: Bool) { completions.append(success) }
}
@MainActor
final class NativeUploadBackgroundTests: XCTestCase {
    func testDistinctDuplicateDeliveryCannotReplaceTheActiveLease() async throws {
        let scheduler = BackgroundSchedulerFixture()
        let coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate()
        let original = BackgroundTaskFixture()
        scheduler.delivered = original
        var expirations = 0
        let granted = await coordinator.begin(size: 100, expired: { expirations += 1 })
        let lease = try XCTUnwrap(granted)
        lease.progress(30)

        let duplicate = BackgroundTaskFixture()
        scheduler.handler?(duplicate)
        XCTAssertEqual(duplicate.completions, [false])
        XCTAssertTrue(original.completions.isEmpty)
        XCTAssertNil(duplicate.expiration)
        XCTAssertTrue(lease.canContinue)
        XCTAssertEqual(original.progress.completedUnitCount, 30)

        lease.progress(100)
        lease.finish(success: true)
        XCTAssertEqual(original.completions, [true])
        XCTAssertEqual(duplicate.completions, [false])
        XCTAssertEqual(expirations, 0)
    }

    func testRepeatedDeliveryOfTheActiveTaskDoesNotCompleteItTwice() async throws {
        let scheduler = BackgroundSchedulerFixture()
        let coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate()
        let original = BackgroundTaskFixture()
        scheduler.delivered = original
        let granted = await coordinator.begin(size: 100, expired: {
            XCTFail("A duplicate callback must not expire the active task")
        })
        let lease = try XCTUnwrap(granted)

        scheduler.handler?(original)
        XCTAssertTrue(original.completions.isEmpty)
        XCTAssertTrue(lease.canContinue)
        lease.finish(success: true)
        scheduler.handler?(original)
        XCTAssertEqual(original.completions, [true])
    }

    func testSettledAvailablePassPreservesMeasuredProgressAndRetrySubtitle() async throws {
        let scheduler = BackgroundSchedulerFixture()
        let coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate()
        let task = BackgroundTaskFixture()
        scheduler.delivered = task
        let granted = await coordinator.begin(presentation: .init(title: "Photos backup", subtitle: "Preparing",
            completedSubtitle: "Photos backup finished", bytes: nil), expired: {
                XCTFail("A settled pass must not expire")
            })
        let lease = try XCTUnwrap(granted)
        lease.work(completed: 1, total: 3, subtitle: "1 of 3 originals saved")
        let subtitle = "Available originals saved · remaining originals will retry"
        lease.finish(success: true, settledSubtitle: subtitle)
        lease.finish(success: false)

        XCTAssertEqual(task.completions, [true])
        XCTAssertEqual(task.progress.completedUnitCount, 1)
        XCTAssertEqual(task.progress.totalUnitCount, 3)
        XCTAssertFalse(task.progress.isFinished)
        XCTAssertEqual(task.subtitles.last, subtitle)
        XCTAssertFalse(lease.canContinue)
    }

    func testActualSimulatorBackgroundSubmissionIsUnavailable() throws {
        guard ProcessInfo.processInfo.environment["THINGTIME_BG_SCHEDULER_PROBE"] == "1" else {
            throw XCTSkip("Opt in to the actual simulator scheduler probe")
        }
#if targetEnvironment(simulator)
        guard #available(iOS 26.0, *) else { throw XCTSkip("Continued processing requires iOS 26") }
        XCTAssertEqual(UIApplication.shared.applicationState, .active)
        let bundle = try XCTUnwrap(Bundle.main.bundleIdentifier)
        let permitted = try XCTUnwrap(Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String])
        let processing = BGProcessingTaskRequest(identifier: bundle + ".file-sync-processing")
        processing.requiresNetworkConnectivity = true
        let continued = BGContinuedProcessingTaskRequest(identifier: bundle + ".file-upload",
            title: "Simulator capability probe", subtitle: "Checking scheduler availability")
        continued.strategy = .fail

        for (kind, request) in [("processing", processing as BGTaskRequest), ("continued", continued as BGTaskRequest)] {
            XCTAssertTrue(permitted.contains(request.identifier))
            do {
                try BGTaskScheduler.shared.submit(request)
                BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: request.identifier)
                print("IOS_SIMULATOR_SCHEDULER: kind=\(kind) submit=accepted")
                XCTFail("The simulator accepted a request that Apple documents as unavailable. Record the platform behavior before using this result.")
            } catch {
                let failure = error as NSError
                print("IOS_SIMULATOR_SCHEDULER: kind=\(kind) domain=\(failure.domain) code=\(failure.code)")
                XCTAssertEqual(failure.domain, BGTaskScheduler.errorDomain)
                XCTAssertEqual(failure.code, BGTaskScheduler.Error.Code.unavailable.rawValue)
            }
        }
#else
        throw XCTSkip("This probe is scoped to a disposable simulator")
#endif
    }

    func testPhotoWorkerKeepsOneLeaseAcrossForegroundSystemWakeAndReturn() throws {
        var state = UIApplication.State.active
        let lease = NativePhotoExecutionLease(foregroundAllowed: true, applicationState: { state })
        var cancellations = 0
        lease.expired = { cancellations += 1 }
        try lease.check()
        state = .inactive; try lease.check()
        state = .background; XCTAssertThrowsError(try lease.check())
        let first = ProcessingTaskFixture(); XCTAssertTrue(lease.attach(first)); try lease.check()
        let duplicate = ProcessingTaskFixture(); XCTAssertFalse(lease.attach(duplicate))
        state = .active; first.expiration?(); try lease.check()
        XCTAssertEqual(first.completions, [false]); XCTAssertEqual(cancellations, 0)
        state = .background
        let second = ProcessingTaskFixture(); XCTAssertTrue(lease.attach(second)); try lease.check()
        second.expiration?()
        XCTAssertEqual(cancellations, 1); XCTAssertEqual(second.completions, [false])
        XCTAssertThrowsError(try lease.check()); lease.finish(false)
        XCTAssertEqual(second.completions, [false])
    }

    func testContinuedPhotosUsesOnlyMeasuredOriginalsAndCompletesOnce() async throws {
        let scheduler = BackgroundSchedulerFixture(), coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate(); let task = BackgroundTaskFixture(); scheduler.delivered = task
        let granted = await coordinator.begin(presentation: .init(title: "Thingtime Photos backup", subtitle: "Checking…",
            completedSubtitle: "Photos backup finished", bytes: nil), expired: { XCTFail("Unexpected expiration") })
        let lease = try XCTUnwrap(granted)
        XCTAssertEqual(scheduler.requestedTitle, "Thingtime Photos backup")
        XCTAssertEqual(task.progress.completedUnitCount, 0)
        lease.work(completed: 1, total: 3, subtitle: "1 original checked")
        lease.work(completed: 0, total: 3, subtitle: "Stale update")
        XCTAssertEqual(task.progress.completedUnitCount, 1)
        XCTAssertEqual(task.subtitles.last, "1 original checked")
        lease.work(completed: 3, total: 4, subtitle: "3 originals checked")
        lease.finish(success: true); lease.finish(success: false)
        XCTAssertEqual(task.completions, [true])
    }

    func testSingleRegistrationSerialJobsProgressAndExactTerminalCompletion() async throws {
        let scheduler=BackgroundSchedulerFixture(), coordinator=NativeUploadBackgroundCoordinator(scheduler:scheduler)
        coordinator.activate();coordinator.activate();XCTAssertEqual(scheduler.registrations,1)
        let task=BackgroundTaskFixture();scheduler.delivered=task
        let lease=await coordinator.begin(size:100,expired:{XCTFail("Unexpected expiration")})
        let active=try XCTUnwrap(lease);XCTAssertTrue(active.canContinue)
        let busy=await coordinator.begin(size:100,expired:{});XCTAssertNil(busy)
        XCTAssertEqual(scheduler.submissions,1)
        active.progress(30);active.progress(20);active.progress(101);XCTAssertEqual(task.progress.completedUnitCount,30)
        active.progress(100);XCTAssertFalse(task.progress.isFinished);XCTAssertEqual(task.subtitles.last,"Verifying upload…")
        let stale=task.expiration
        active.finish(success:true);active.finish(success:false);stale?()
        XCTAssertEqual(task.completions,[true]);XCTAssertTrue(task.progress.isFinished);XCTAssertFalse(active.canContinue)
        scheduler.delivered=BackgroundTaskFixture()
        let next=await coordinator.begin(size:200,expired:{});XCTAssertNotNil(next);XCTAssertEqual(scheduler.registrations,1)
        next?.finish(success:true)
    }
    func testExpirationCancelsOnceAndCannotCancelLaterJob() async throws {
        let scheduler=BackgroundSchedulerFixture(), coordinator=NativeUploadBackgroundCoordinator(scheduler:scheduler)
        coordinator.activate();let task=BackgroundTaskFixture();scheduler.delivered=task;var expirations=0
        let lease=await coordinator.begin(size:10,expired:{expirations+=1})
        let expire=task.expiration;expire?();expire?()
        XCTAssertEqual(expirations,1);XCTAssertEqual(task.completions,[false]);XCTAssertFalse(lease?.canContinue ?? true)
        scheduler.delivered=BackgroundTaskFixture()
        let next=await coordinator.begin(size:10,expired:{expirations+=1})
        expire?();XCTAssertTrue(next?.canContinue ?? false);XCTAssertEqual(expirations,1)
        next?.finish(success:true)
    }
    func testPhotosIndexingReportsMeasuredWorkBeforeKnowingTheUploadTotal() async throws {
        let scheduler = BackgroundSchedulerFixture()
        let coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate()
        let system = BackgroundTaskFixture()
        scheduler.delivered = system
        let granted = await coordinator.begin(presentation: .init(title: "Photos backup", subtitle: "Indexing",
            completedSubtitle: "Finished", bytes: nil), expired: {})
        let lease = try XCTUnwrap(granted)
        let activity = NativePhotoRunActivity()
        var previousFraction = 0.0
        for inspected in [1, 2] {
            let item = PhotoLibraryReader.InventoryProgress.Item(kind: .photo, capturedAt: nil)
            _ = activity.capture(.enumerating(.init(inspected: inspected, total: 76_109, indexed: .init(), latest: item)))
            let known = activity.knownWork()
            let total = NativePhotoContinuedProgress.total(indexed: activity.measuredIndexingWork(),
                knownIndexing: known.indexing, preparation: 0, knownPreparation: 0,
                completed: 0, knownOriginals: 0, activeFiles: 0)
            lease.work(completed: NativePhotoContinuedProgress.units(indexed: activity.measuredIndexingWork(),
                preparation: 0, completed: 0, files: []), total: total, subtitle: "Actual discovered asset")
            XCTAssertFalse(system.progress.isIndeterminate)
            XCTAssertGreaterThan(system.progress.fractionCompleted, previousFraction,
                "Incremental discovery must report a changing real fraction before original backlog is known")
            previousFraction = system.progress.fractionCompleted
            XCTAssertLessThan(previousFraction, 1)
        }
        XCTAssertEqual(system.progress.completedUnitCount, 20_000)
        let before = system.progress.completedUnitCount
        lease.work(completed: 30_000, total: nil, subtitle: "Unknown denominator")
        lease.work(completed: 30_000, total: 30_000, subtitle: "Premature completion")
        XCTAssertEqual(system.progress.completedUnitCount, before)
        lease.finish(success: true)
        XCTAssertEqual(system.progress.fractionCompleted, 1, "Only verified terminal completion settles the reserved final unit")
        lease.work(completed: 90_000, total: 90_001, subtitle: "Stale worker")
        XCTAssertEqual(system.completions, [true])
    }

    func testPendingTimeoutQuarantinesIdentifierUntilLateLaunchIsRejected() async throws {
        let scheduler=BackgroundSchedulerFixture(), coordinator=NativeUploadBackgroundCoordinator(scheduler:scheduler)
        coordinator.activate()
        let result=await coordinator.begin(size:10,timeoutNanoseconds:1_000_000,expired:{XCTFail("Timed-out launch gained authority")})
        XCTAssertNil(result);XCTAssertEqual(scheduler.cancellations,1)
        let blocked=await coordinator.begin(size:10,expired:{});XCTAssertNil(blocked);XCTAssertEqual(scheduler.submissions,1)
        let late=BackgroundTaskFixture();scheduler.handler?(late);XCTAssertEqual(late.completions,[false])
        scheduler.delivered=BackgroundTaskFixture()
        let next=await coordinator.begin(size:10,expired:{});XCTAssertTrue(next?.canContinue ?? false)
        next?.finish(success:true)
    }
    func testRejectedAndUnavailableSchedulersFallBackWithoutRetainingAuthority() async {
        let scheduler=BackgroundSchedulerFixture(), coordinator=NativeUploadBackgroundCoordinator(scheduler:scheduler)
        coordinator.activate();scheduler.reject=true
        let rejected=await coordinator.begin(size:10,expired:{});XCTAssertNil(rejected)
        scheduler.reject=false;scheduler.delivered=BackgroundTaskFixture()
        let accepted=await coordinator.begin(size:10,expired:{});XCTAssertNotNil(accepted);accepted?.finish(success:true)
        let absent=NativeUploadBackgroundCoordinator(scheduler:nil);absent.activate()
        let unavailable=await absent.begin(size:10,expired:{});XCTAssertNil(unavailable)
    }
    func testCancellationBeforeLaunchSettlesWaitAndRejectsLateTask() async throws {
        let scheduler=BackgroundSchedulerFixture(), coordinator=NativeUploadBackgroundCoordinator(scheduler:scheduler)
        coordinator.activate()
        let start=Task { await coordinator.begin(size:10,expired:{XCTFail("Cancelled job expired")}) }
        while scheduler.submissions==0 { await Task.yield() }
        start.cancel();let value=await start.value;XCTAssertNil(value);XCTAssertEqual(scheduler.cancellations,1)
        let late=BackgroundTaskFixture();scheduler.handler?(late);XCTAssertEqual(late.completions,[false])
    }
    func testFiveConcurrentOriginalsKeepSiblingsPartialWorkWhenOneReceiptFinishes() async throws {
        let scheduler = BackgroundSchedulerFixture(), coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate(); let system = BackgroundTaskFixture(); scheduler.delivered = system
        let granted = await coordinator.begin(presentation: .init(title: "Photos", subtitle: "Uploading",
            completedSubtitle: "Finished", bytes: nil), expired: {})
        let lease = try XCTUnwrap(granted)
        var files = Array(repeating: (sent: Int64(99_999), total: Int64(100_000)), count: 5)
        func report(_ completed: Int64) {
            lease.work(completed: NativePhotoContinuedProgress.units(indexed: 0, preparation: 0,
                completed: completed, files: files), total: 50_001, subtitle: "Measured transfer")
        }
        report(0)
        XCTAssertEqual(system.progress.completedUnitCount, 49_995)
        for completed in 1...5 {
            files.removeLast()
            report(Int64(completed))
            XCTAssertEqual(system.progress.completedUnitCount, Int64(completed * 10_000 + (5 - completed) * 9_999),
                "A verified receipt replaces only that original's partial units, preserving every sibling")
        }
        XCTAssertEqual(system.progress.completedUnitCount, 50_000)
        XCTAssertFalse(system.progress.isFinished, "Publication, not payload sent, finishes the system task")
        lease.finish(success: true)
    }

    func testCloudDownloadCallbacksAdvanceMeasuredSystemProgressWithoutUploadBytes() async throws {
        let scheduler = BackgroundSchedulerFixture(), coordinator = NativeUploadBackgroundCoordinator(scheduler: scheduler)
        coordinator.activate(); let system = BackgroundTaskFixture(); scheduler.delivered = system
        let granted = await coordinator.begin(presentation: .init(title: "Photos", subtitle: "Downloading",
            completedSubtitle: "Finished", bytes: nil), expired: {})
        let lease = try XCTUnwrap(granted)
        let activity = NativePhotoRunActivity(), firstResource = UUID()
        activity.beginCloudPreparation(firstResource)
        var previousFraction = 0.0
        for (fraction, expected) in [(0.2, Int64(2_000)), (0.4, 4_000), (0.3, 4_000)] {
            _ = activity.cloudPreparation(fraction, resource: firstResource)
            lease.work(completed: NativePhotoContinuedProgress.units(indexed: 0,
                preparation: activity.measuredPreparationWork(), completed: 0, files: []),
                total: NativePhotoContinuedProgress.total(indexed: 0, knownIndexing: 0,
                    preparation: activity.measuredPreparationWork(), knownPreparation: activity.knownWork().preparation,
                    completed: 0, knownOriginals: 0, activeFiles: 0), subtitle: "iCloud original")
            XCTAssertEqual(system.progress.completedUnitCount, expected)
            XCTAssertGreaterThan(system.progress.fractionCompleted, 0)
            XCTAssertGreaterThanOrEqual(system.progress.fractionCompleted, previousFraction)
            if fraction == 0.4 { XCTAssertGreaterThan(system.progress.fractionCompleted, previousFraction) }
            previousFraction = system.progress.fractionCompleted
            XCTAssertLessThan(previousFraction, 1)
        }
        let measuredAt = try XCTUnwrap(lease.lastProgressAt)
        _ = activity.cloudPreparation(nil, resource: firstResource)
        XCTAssertEqual(activity.measuredPreparationWork(), 4_000, "Ending a partial download invents no remaining work")
        let secondResource = UUID()
        activity.beginCloudPreparation(secondResource)
        _ = activity.cloudPreparation(0.1, resource: secondResource)
        XCTAssertFalse(activity.cloudPreparation(0.9, resource: firstResource), "A late old-resource callback has no authority")
        XCTAssertEqual(activity.snapshot().cloudPreparationFraction, 0.1)
        XCTAssertEqual(activity.measuredPreparationWork(), 5_000, "A distinct resource contributes its actual new work")
        activity.backgroundEnded(.systemEnded, measuredUnits: lease.measuredUnits, lastProgressAt: measuredAt)
        let reopened = NativePhotoRunActivity(try JSONDecoder().decode(NativePhotoRunActivity.Snapshot.self,
            from: JSONEncoder().encode(activity.snapshot())))
        XCTAssertEqual(reopened.snapshot().backgroundEnd?.cause, .systemEnded)
        XCTAssertEqual(reopened.snapshot().backgroundEnd?.measuredUnits, 4_000)
        XCTAssertEqual(reopened.measuredPreparationWork(), 0, "A new process/lease must not replay historical measured units")
        _ = activity.cloudPreparation(0.9, resource: secondResource)
        XCTAssertEqual(reopened.measuredPreparationWork(), 0, "An old resource callback cannot advance the replacement activity")
        lease.finish(success: false)
        XCTAssertEqual(system.completions, [false])
    }

}
