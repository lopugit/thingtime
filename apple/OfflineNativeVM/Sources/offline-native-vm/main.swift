import Foundation
import AppKit
import OfflineVMCore
import Darwin

func emit(_ object: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}
final class ProcessAdapter: WorkerProcess {
    let process: Process
    init(_ process: Process) { self.process = process }
    var running: Bool { process.isRunning }
    func start() throws { try process.run() }
    func terminate() { if process.isRunning { process.terminate() } }
    func kill() { if process.isRunning { Darwin.kill(process.processIdentifier, SIGKILL) } }
}
func supervise(_ workspace: Workspace) throws -> Int32 {
    try workspace.requireAdmission()
    let (run, prepared) = try workspace.beginPreparation() // Holds exclusive lease until child is reaped.
    let process = Process()
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.resolvingSymlinksInPath()
    process.executableURL = executable
    process.arguments = ["__worker", workspace.root.path, prepared.runID, String(getpid())]
    let home = run.appendingPathComponent("home"); let temporary = run.appendingPathComponent("tmp")
    for directory in [home, temporary] { guard mkdir(directory.path, 0o700) == 0 else { throw VMFailure.path } }
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": home.path, "TMPDIR": temporary.path, "LANG": "C"]
    process.currentDirectoryURL = run
    process.standardInput = FileHandle.nullDevice; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
    var interrupted: String? = nil
    var signals: [DispatchSourceSignal] = []
    for number in [SIGTERM, SIGINT] {
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler { interrupted = VMFailure.cancelled.rawValue }
        source.resume(); signals.append(source)
    }
    defer { for source in signals { source.cancel() } }
    let result = try Supervisor.run(ProcessAdapter(process), deadlineSeconds: workspace.manifest.deadlineSeconds,
        now: { ProcessInfo.processInfo.systemUptime },
        pump: { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) },
        cancelled: { interrupted != nil })
    let reaped = result.reaped
    interrupted = result.interruption
    let workerURL = run.appendingPathComponent("worker.json")
    let worker = try? JSONDecoder().decode(WorkerReceipt.self, from: SecureFile(workerURL).data())
    let outcome = result.hardKillRequested ? VMFailure.teardownUnknown.rawValue : Lifecycle.outcome(worker: worker, reaped: reaped, interrupted: interrupted)
    let receipt = Receipt(contractVersion: Contract.version, taskID: prepared.taskID, runID: prepared.runID, sourceSHA: prepared.sourceSHA, outcome: outcome, workerReaped: reaped, teardownProven: Lifecycle.teardownProven(worker: worker, reaped: reaped, hardKillRequested: result.hardKillRequested), worker: worker, isolationEvidence: "host-VZ-configuration-readback-only", guestAcceptance: false)
    try writeJSON(receipt, to: run.appendingPathComponent("receipt.json"))
    // Mutable artifacts are deliberately retained, including on unproven teardown. No disposal claim.
    try emit(["outcome": outcome, "runID": prepared.runID, "receipt": "runs/\(prepared.runID)/receipt.json", "guestAcceptance": false])
    return outcome == "stopped" ? 0 : 1
}
func main() throws -> Int32 {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let command = args.first else { throw VMFailure.arguments }
    if command == "manifest", args.count == 1 { try emit(Contract.manifest); return 0 }
    if command == "inspect-restore", args.count == 2 {
        guard args[1].hasPrefix("/"), !args[1].utf8.contains(0) else { throw VMFailure.arguments }
        let receipt = try RestoreInspection.perform(path: URL(fileURLWithPath: args[1]), backend: ApplePreparationBackend())
        let encoded = try JSONEncoder().encode(receipt)
        FileHandle.standardOutput.write(encoded); FileHandle.standardOutput.write(Data([10])); return 0
    }
    if command == "init", args.count == 3 {
        let root = try Workspace.initialize(parent: URL(fileURLWithPath: args[1]), taskID: args[2])
        try emit(["contractVersion": Contract.version, "taskID": args[2], "root": root.path, "guestStarted": false]); return 0
    }
    if command == "view", args.count == 3 {
        return try superviseViewer(Workspace(root: URL(fileURLWithPath: args[1])), runID: args[2])
    }
    if command == "__viewer-worker", args.count == 5 {
        guard let parent = Int32(args[4]), parent == getppid() else { throw VMFailure.arguments }
        let workspace = try Workspace(root: URL(fileURLWithPath: args[1]))
        let run = try workspace.viewerWorkerRun(args[2], attemptID: args[3], parentPID: parent)
        let config = try configuration(workspace, run: run, interactive: true)
        let worker = try ViewerWorker(config: config, report: run.appendingPathComponent("viewer-" + args[3]).appendingPathComponent("worker.json"),
            taskID: workspace.owner.taskID, parent: parent, seconds: min(1800, workspace.manifest.deadlineSeconds))
        let app = NSApplication.shared; app.setActivationPolicy(.regular); app.delegate = worker
        withExtendedLifetime(worker) { app.run() }; return 1
    }
    if command == "install", args.count == 3 {
        let workspace = try Workspace(root: URL(fileURLWithPath: args[1]))
        return try superviseInstallation(workspace, runID: args[2])
    }
    if command == "__install-worker", args.count == 4 {
        guard let parent = Int32(args[3]), parent == getppid() else { throw VMFailure.arguments }
        let workspace = try Workspace(root: URL(fileURLWithPath: args[1]))
        let run = try workspace.installationWorkerRun(args[2], parentPID: parent)
        let config = try configuration(workspace, run: run)
        let worker = try InstallerWorker(config: config, restore: workspace.input(workspace.manifest.restoreImage),
            report: run.appendingPathComponent("install-worker.json"), parent: parent, seconds: workspace.manifest.deadlineSeconds)
        worker.begin(); RunLoop.main.run(); return 1
    }
    if command == "__worker", args.count == 4 {
        let workspace = try Workspace(root: URL(fileURLWithPath: args[1])); try workspace.requireAdmission()
        guard UUID(uuidString: args[2]) != nil, let parent = Int32(args[3]), parent == getppid() else { throw VMFailure.arguments }
        let run = workspace.root.appendingPathComponent("runs").appendingPathComponent(args[2])
        try Workspace.privateDirectory(run)
        let prepared = try JSONDecoder().decode(Prepared.self, from: SecureFile(run.appendingPathComponent("prepared.json")).data())
        guard prepared.taskID == workspace.owner.taskID, prepared.sourceSHA == workspace.manifest.sourceSHA,
              prepared.runID == args[2] else { throw VMFailure.ownership }
        // Internal worker also fails the closed readiness gate; imported declarations cannot admit a start.
        let config = try configuration(workspace, run: run)
        let worker = try VMWorker(config: config, report: run.appendingPathComponent("worker.json"), parent: parent, seconds: workspace.manifest.deadlineSeconds)
        worker.begin(); RunLoop.main.run(); return 1
    }
    guard args.count == 2, ["validate", "plan", "prepare", "run"].contains(command) else { throw VMFailure.arguments }
    let workspace = try Workspace(root: URL(fileURLWithPath: args[1]))
    if command == "run" { return try supervise(workspace) }
    if command == "prepare" {
        let run = try Preparation.perform(workspace: workspace, backend: ApplePreparationBackend())
        let config = try configuration(workspace, run: run)
        try verifyConfiguration(config)
        try writeJSON(WorkerReceipt(), to: run.appendingPathComponent("configuration-readback.json"))
        try emit(["contractVersion": Contract.version, "state": "prepared-empty", "configurationValidated": true, "runID": run.lastPathComponent,
                  "guestStarted": false, "installed": false, "setupComplete": false, "toolchainVerified": false,
                  "runAdmitted": false, "guestAcceptance": false]); return 0
    }
    try emit(["contractVersion": Contract.version, "taskID": workspace.owner.taskID, "sourceSHA": workspace.manifest.sourceSHA,
              "manifestSHA256": workspace.manifestHash, "structurallyValid": true,
              "preparationAdmitted": PreparationAdmission.available,
              "configurationValidated": false, "guestStarted": false, "networkDevices": 0,
              "mutableCopiesPlanned": ["boot.img", "auxiliary.bin", "output.img"],
              "inputReadOnly": true, "guestAcceptance": false])
    return 0
}
do { exit(try main()) }
catch {
    // Fixed labels only: never arbitrary NSError descriptions, guest logs, command arguments or environment.
    var diagnostic: [String: Any] = ["contractVersion": Contract.version, "error": (error as? VMFailure)?.rawValue ?? "validation", "guestAcceptance": false]
    if !(error is VMFailure) {
        let encoded = try? JSONEncoder().encode(SafePlatformError.chain(error))
        if let encoded, let codes = try? JSONSerialization.jsonObject(with: encoded) { diagnostic["platformErrors"] = codes }
    }
    try? emit(diagnostic)
    exit(1)
}
