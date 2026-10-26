import Foundation

// Pure host lifecycle control. The adapter owns exactly one worker PID; guest processes
// are contained by VZ, never enumerated/killed on the host by UID or process name.
public protocol WorkerProcess: AnyObject {
    var running: Bool { get }
    func start() throws
    func terminate()
    func kill()
}
public struct Supervision {
    public let reaped: Bool
    public let interruption: String?
    public let hardKillRequested: Bool
}
public enum Supervisor {
    public static func run(_ worker: WorkerProcess, deadlineSeconds: Int,
                           now: () -> TimeInterval, pump: () -> Void,
                           cancelled: () -> Bool) throws -> Supervision {
        let deadline = now() + Double(deadlineSeconds)
        try worker.start()
        while worker.running, !cancelled(), now() < deadline { pump() }
        var interruption: String? = nil
        var hardKill = false
        if worker.running {
            interruption = cancelled() ? VMFailure.cancelled.rawValue : VMFailure.deadline.rawValue
            worker.terminate()
            let grace = now() + 15
            while worker.running, now() < grace { pump() }
            if worker.running { hardKill = true; worker.kill() }
            let reap = now() + 5
            while worker.running, now() < reap { pump() }
        }
        return Supervision(reaped: !worker.running, interruption: interruption, hardKillRequested: hardKill)
    }
}
