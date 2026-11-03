import XCTest
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
    func register(_ handler: @escaping (NativeUploadBackgroundTask) -> Void) -> Bool {
        registrations += 1; self.handler = handler; return !unavailable
    }
    func submit() throws {
        submissions += 1
        if reject { throw URLError(.notConnectedToInternet) }
        if let delivered { handler?(delivered) }
    }
    func cancel() { cancellations += 1 }
}
@MainActor
final class NativeUploadBackgroundTests: XCTestCase {
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
}
