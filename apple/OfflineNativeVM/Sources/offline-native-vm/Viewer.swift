import Foundation
import AppKit
import Virtualization
import OfflineVMCore
import Darwin

// Native framebuffer/input is the sole interactive guest channel. No pasteboard,
// serial console, shared folders, socket, networking or guest result reader.
final class ViewerWorker: NSObject, NSApplicationDelegate, NSWindowDelegate, VZVirtualMachineDelegate {
    let vm: VZVirtualMachine
    let lifecycle = ViewerLifecycle()
    let report: URL
    let parent: pid_t
    let deadline: TimeInterval
    let taskID: String
    var window: NSWindow?
    var signals: [DispatchSourceSignal] = []
    var timer: DispatchSourceTimer?
    init(config: VZVirtualMachineConfiguration, report: URL, taskID: String, parent: pid_t, seconds: Int) throws {
        try verifyConfiguration(config, interactive: true)
        vm = VZVirtualMachine(configuration: config, queue: .main)
        self.report = report; self.taskID = taskID; self.parent = parent
        deadline = ProcessInfo.processInfo.systemUptime + Double(seconds)
        super.init(); vm.delegate = self
    }
    var now: TimeInterval { ProcessInfo.processInfo.systemUptime }
    func save() { do { try writeJSON(lifecycle.receipt, to: report) } catch { exit(2) } }
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard getppid() == parent, vm.state == .stopped else { save(); exit(1) }
        let app = NSApplication.shared
        let menu = NSMenu(); let item = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Stop and close viewer", action: #selector(stopViewer), keyEquivalent: "q").target = self
        item.submenu = appMenu; menu.addItem(item); app.mainMenu = menu
        let view = VZVirtualMachineView(); view.virtualMachine = vm
        view.capturesSystemKeys = false
        view.translatesAutoresizingMaskIntoConstraints = false
        let label = NSTextField(labelWithString: "Offline task " + taskID + " • Guest readiness not verified")
        label.lineBreakMode = .byTruncatingMiddle
        let stop = NSButton(title: "Stop and checkpoint", target: self, action: #selector(stopViewer))
        stop.setAccessibilityLabel("Stop guest and save host checkpoint")
        let bar = NSStackView(views: [label, stop]); bar.orientation = .horizontal; bar.spacing = 16
        bar.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView()
        content.addSubview(bar); content.addSubview(view)
        NSLayoutConstraint.activate([
            bar.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 16),
            bar.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -16),
            bar.topAnchor.constraint(equalTo: content.topAnchor, constant: 12),
            stop.widthAnchor.constraint(greaterThanOrEqualToConstant: 170),
            stop.heightAnchor.constraint(greaterThanOrEqualToConstant: 32),
            view.topAnchor.constraint(equalTo: bar.bottomAnchor, constant: 12),
            view.leadingAnchor.constraint(equalTo: content.leadingAnchor), view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            view.bottomAnchor.constraint(equalTo: content.bottomAnchor)])
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Thingtime offline VM — " + taskID
        window.minSize = NSSize(width: 800, height: 560)
        window.contentView = content; window.delegate = self; window.center(); window.makeKeyAndOrderFront(nil)
        self.window = window
        app.activate(ignoringOtherApps: true)
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { self.requestStop("cancelled") }; source.resume(); signals.append(source)
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
        timer.setEventHandler {
            if getppid() != self.parent { self.requestStop("parentLost") }
            else if self.now >= self.deadline { self.requestStop("deadline") }
            self.tick()
        }
        self.timer = timer; timer.resume()
        apply(lifecycle.begin())
    }
    @objc func stopViewer() { requestStop("requested") }
    func windowShouldClose(_ sender: NSWindow) -> Bool { stopViewer(); return false }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply { stopViewer(); return .terminateCancel }
    func requestStop(_ reason: String) { lifecycle.stop(reason: reason, now: now); tick() }
    func tick() { apply(lifecycle.tick(now: now, stopped: vm.state == .stopped, canStop: vm.canStop)) }
    func apply(_ actions: [ViewerAction]) {
        save()
        for action in actions {
            switch action {
            case .start:
                vm.start { result in
                    switch result {
                    case .success: self.lifecycle.started(running: self.vm.state == .running)
                    case .failure(let error): self.lifecycle.started(running: false); self.lifecycle.failed(SafePlatformError.chain(error)); self.lifecycle.stop(reason: "worker", now: self.now)
                    }
                    self.tick()
                }
            case .stop:
                vm.stop { error in
                    if let error { self.lifecycle.failed(SafePlatformError.chain(error)) }
                    self.tick()
                }
            case .finish, .unknown:
                save(); exit(lifecycle.receipt.runningObserved && lifecycle.receipt.stoppedObserved && lifecycle.receipt.failure == nil ? 0 : 1)
            }
        }
    }
    func guestDidStop(_ virtualMachine: VZVirtualMachine) { tick() }
    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        lifecycle.failed(SafePlatformError.chain(error)); requestStop("worker")
    }
}

func superviseViewer(_ workspace: Workspace, runID: String) throws -> Int32 {
    let (run, attempt) = try workspace.beginViewer(runID, parentPID: getpid())
    let phase = run.appendingPathComponent("viewer-" + attempt.id)
    let process = Process(); process.executableURL = Bundle.main.executableURL
    process.arguments = ["__viewer-worker", workspace.root.path, runID, attempt.id, String(getpid())]
    for name in ["home", "tmp"] { guard mkdir(phase.appendingPathComponent(name).path, 0o700) == 0 else { throw VMFailure.path } }
    process.environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "HOME": phase.appendingPathComponent("home").path,
        "TMPDIR": phase.appendingPathComponent("tmp").path, "LANG": "C"]
    process.currentDirectoryURL = phase
    process.standardInput = FileHandle.nullDevice; process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice
    var interrupted = false
    var signals: [DispatchSourceSignal] = []
    for number in [SIGTERM, SIGINT] {
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
        source.setEventHandler { interrupted = true }; source.resume(); signals.append(source)
    }
    defer { for source in signals { source.cancel() } }
    // Finite first-boot session, never lengthened by guest actions. Parent grace exceeds
    // worker's 15s stop budget, then Supervisor allows 5s for exact-worker reap.
    let result = try Supervisor.run(ProcessAdapter(process), deadlineSeconds: min(1800, workspace.manifest.deadlineSeconds),
        now: { ProcessInfo.processInfo.systemUptime }, pump: { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05)) },
        cancelled: { interrupted }, terminationGraceSeconds: 25)
    let worker = try? JSONDecoder().decode(ViewerWorkerReceipt.self, from: SecureFile(phase.appendingPathComponent("worker.json")).data())
    let normal = result.reaped && process.terminationReason == .exit
    let code: Int32? = result.reaped ? process.terminationStatus : nil
    var files: [String: FileIdentity] = [:]
    if ViewerCheckpoint.eligible(worker: worker, supervision: result, normal: normal, exitCode: code) {
        for name in Workspace.pairedFiles {
            let identity = try FileIdentity(run.appendingPathComponent(name))
            guard identity.device == attempt.expectedFiles[name]?.device, identity.inode == attempt.expectedFiles[name]?.inode else { throw VMFailure.integrity }
            files[name] = identity
        }
    }
    let checkpoint = ViewerCheckpoint(attempt: attempt, worker: worker, supervision: result, normal: normal, exitCode: code, files: files)
    try writeJSON(checkpoint, to: phase.appendingPathComponent("checkpoint.json"))
    try emit(["contractVersion": Contract.version, "runID": runID, "attemptID": attempt.id,
        "teardownProven": checkpoint.teardownProven, "quarantined": checkpoint.quarantined, "readiness": false, "candidateExecuted": false])
    return checkpoint.teardownProven ? 0 : 1
}
