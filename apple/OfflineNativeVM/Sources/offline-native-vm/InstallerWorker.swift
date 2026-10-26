import Foundation
import Virtualization
import OfflineVMCore
import Darwin

// Distinct from runtime VMWorker: stopping/pausing during active install is undefined.
final class InstallerWorker: NSObject, VZVirtualMachineDelegate {
    let vm: VZVirtualMachine
    let installer: VZMacOSInstaller
    let lifecycle = InstallLifecycle()
    let report: URL
    let parent: pid_t
    let deadline: TimeInterval
    var signals: [DispatchSourceSignal] = []
    var timer: DispatchSourceTimer?
    init(config: VZVirtualMachineConfiguration, restore: URL, report: URL, parent: pid_t, seconds: Int) throws {
        try verifyConfiguration(config)
        vm = VZVirtualMachine(configuration: config, queue: .main)
        installer = VZMacOSInstaller(virtualMachine: vm, restoringFromImageAt: restore)
        self.report = report; self.parent = parent; deadline = ProcessInfo.processInfo.systemUptime + Double(seconds)
        super.init(); vm.delegate = self
    }
    var now: TimeInterval { ProcessInfo.processInfo.systemUptime }
    func save() { do { try writeJSON(lifecycle.receipt, to: report) } catch { exit(2) } }
    func begin() {
        // The VM is fresh, stopped, with its original preparation model/ID/aux pair.
        guard vm.state == .stopped, getppid() == parent else { save(); exit(1) }
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { self.apply(self.lifecycle.cancel(reason: "cancelled", now: self.now)) }
            source.resume(); signals.append(source)
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100))
        timer.setEventHandler {
            if getppid() != self.parent { self.apply(self.lifecycle.cancel(reason: "cancelled", now: self.now)) }
            else if self.now >= self.deadline { self.apply(self.lifecycle.cancel(reason: "deadline", now: self.now)) }
            self.tick()
        }
        self.timer = timer; timer.resume()
        apply(lifecycle.begin())
    }
    func tick() { apply(lifecycle.tick(now: now, stopped: vm.state == .stopped, canStop: vm.canStop)) }
    func apply(_ actions: [InstallAction]) {
        save()
        for action in actions {
            switch action {
            case .begin:
                installer.install { result in
                    switch result {
                    case .success: self.apply(self.lifecycle.completed(success: true, now: self.now))
                    case .failure(let error):
                        self.lifecycle.platformFailure(SafePlatformError.chain(error))
                        self.apply(self.lifecycle.completed(success: false, now: self.now))
                    }
                    self.tick()
                }
            case .cancelProgress:
                // Only emitted AFTER install was invoked; never cancelled before begin.
                installer.progress.cancel()
            case .stopVM:
                // Only emitted AFTER installer completion callback, never during install.
                vm.stop { error in
                    if let error { self.lifecycle.stopFailed(SafePlatformError.chain(error)) }
                    self.tick()
                }
            case .finish, .unknown:
                save(); exit(lifecycle.receipt.installationSucceeded && lifecycle.receipt.stoppedObserved && lifecycle.receipt.failure == nil ? 0 : 1)
            }
        }
    }
    func guestDidStop(_ virtualMachine: VZVirtualMachine) { tick() }
    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        lifecycle.platformFailure(SafePlatformError.chain(error), phase: .virtualMachine)
        apply(lifecycle.cancel(reason: "worker", now: now)); tick()
    }
}
