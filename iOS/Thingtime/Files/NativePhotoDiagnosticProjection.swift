import Foundation
import UIKit

/// Closed projection: PhotoKit items, paths and run handles never enter the
/// diagnostics transport. Unknown measurements remain absent.
enum NativePhotoDiagnosticProjection {
    static func event(_ run: NativePhotoRunRecord, activity: NativePhotoRunActivity.Snapshot?,
                      code: MobileDeviceDiagnosticEvent.Code = .snapshot,
                      at: Date = Date()) -> MobileDeviceDiagnosticEvent {
        let state: MobileDeviceDiagnosticEvent.State = run.userPaused == true ? .paused :
            run.stage == "needs-review" || !run.armed ? .failed :
            run.stage == "complete" ? .complete : run.stage == "waiting" ? .waiting : .running
        var value = MobileDeviceDiagnosticEvent(category: .sync, level: state == .failed ? .error : state == .waiting ? .warning : .info,
                                                code: code, state: state, at: at)
        value.configurationId = run.authorization.id
        value.runKey = MobileDeviceDiagnosticEvent.correlationKey(runId: run.runId, epoch: run.epoch)
        value.phase = activity?.phase; value.reason = activity?.reason; value.failureOperation = activity?.failureOperation
        value.retrySource = run.retrySource
        if run.retryAt > at { value.retryAt = MobileDeviceDiagnosticEvent.timestamp(run.retryAt) }
        value.counts = .init(inspectedAssets: activity?.indexing.flatMap { $0.unit == .assets ? Int64($0.completed) : nil },
                             indexedResources: activity?.indexed.map { Int64($0.files) },
                             pendingOriginals: run.pendingOriginals.map(Int64.init),
                             unavailableOriginals: run.unavailableOriginals.map(Int64.init))
        if let end = activity?.backgroundEnd {
            value.background = .init(request: activity?.backgroundRequest, cause: end.cause,
                                     measuredUnits: MobileDeviceDiagnosticEvent.measurement(end.measuredUnits),
                                     lastProgressAt: end.lastProgressAt.map(MobileDeviceDiagnosticEvent.timestamp))
        } else if let request = activity?.backgroundRequest { value.background = .init(request: request) }
        return value
    }
    static func transitionKey(_ event: MobileDeviceDiagnosticEvent) -> String {
        [event.state.rawValue, event.phase?.rawValue, event.reason?.rawValue, event.failureOperation?.rawValue,
         event.background?.request?.rawValue, event.background?.cause?.rawValue].map { $0 ?? "" }.joined(separator: "|")
    }
    @MainActor static func outcome(_ outcome: MobileDeviceDiagnosticEvent.Background.Outcome,
                        error: MobileDeviceDiagnosticEvent.SystemError?, run: NativePhotoRunRecord? = nil) -> MobileDeviceDiagnosticEvent {
        let terminal = [.expired, .failed, .cancelled, .launchTimeout, .declined, .unregistered, .busy].contains(outcome)
        var event = run.map { self.event($0, activity: $0.activity) } ?? .init(category: .upload, level: .info, code: .backgroundRequest, state: .waiting)
        event.category = .upload
        event.code = [.submitted, .active, .declined, .busy, .unregistered].contains(outcome) ? .backgroundRequest : .backgroundEnded
        event.level = terminal ? .warning : .info
        event.state = outcome == .active ? .running : outcome == .completed ? .complete : .waiting
        event.background = .init(outcome: outcome); event.systemError = error
        event.background?.applicationState = UIApplication.shared.applicationState == .active ? .active :
            UIApplication.shared.applicationState == .background ? .background : .inactive
        return event
    }
}
