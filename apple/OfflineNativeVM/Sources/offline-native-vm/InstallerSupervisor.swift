import Foundation
import OfflineVMCore
import Darwin

func superviseInstallation(_ workspace: Workspace, runID: String) throws -> Int32 {
    let run = try workspace.beginInstallation(runID, parentPID: getpid())
    // Parent retains the exclusive workspace lease through the entire child lifetime.
    let process = Process()
    process.executableURL = Bundle.main.executableURL
    process.arguments = ["__install-worker", workspace.root.path, runID, String(getpid())]
    let home = run.appendingPathComponent("install-home"); let temporary = run.appendingPathComponent("install-tmp")
    for directory in [home, temporary] { guard mkdir(directory.path, 0o700) == 0 else { throw VMFailure.path } }
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": home.path, "TMPDIR": temporary.path, "LANG": "C"]
    process.currentDirectoryURL = run
    process.standardInput = FileHandle.nullDevice; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
    var interrupted = false
    var signals: [DispatchSourceSignal] = []
    for number in [SIGTERM, SIGINT] {
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler { interrupted = true }; source.resume(); signals.append(source)
    }
    defer { for source in signals { source.cancel() } }
    // Separate installer grace: cancellation callback (60s), post-callback stop (15s),
    // and receipt/exit margin. Runtime's 15s shutdown budget is deliberately not reused.
    let result = try Supervisor.run(ProcessAdapter(process), deadlineSeconds: workspace.manifest.deadlineSeconds,
        now: { ProcessInfo.processInfo.systemUptime }, pump: { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) },
        cancelled: { interrupted }, terminationGraceSeconds: 90)
    let worker = try? JSONDecoder().decode(InstallWorkerReceipt.self, from: SecureFile(run.appendingPathComponent("install-worker.json")).data())
    let exitedNormally = result.reaped && process.terminationReason == .exit
    let exitCode: Int32? = result.reaped ? process.terminationStatus : nil
    var finalFiles: [String: FileIdentity] = [:]
    if InstallReceipt.eligible(worker: worker, supervision: result, workerExitedNormally: exitedNormally, workerExitCode: exitCode) {
        for name in ["boot.img", "output.img", "auxiliary.bin", "hardware.bin", "machine-id.bin"] {
            finalFiles[name] = try FileIdentity(run.appendingPathComponent(name))
        }
    }
    let receipt = InstallReceipt(taskID: workspace.owner.taskID, runID: runID, sourceSHA: workspace.manifest.sourceSHA, manifestSHA256: workspace.manifestHash, files: finalFiles, worker: worker, supervision: result, workerExitedNormally: exitedNormally, workerExitCode: exitCode)
    try writeJSON(receipt, to: run.appendingPathComponent("installation.json"))
    try emit(["contractVersion": Contract.version, "outcome": receipt.outcome, "installed": receipt.installed,
              "quarantined": receipt.quarantined, "readiness": false, "runID": runID])
    return receipt.installed ? 0 : 1
}
