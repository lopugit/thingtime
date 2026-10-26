import Foundation
import Virtualization
import OfflineVMCore
import Darwin

struct ApplePreparationBackend: FreshPreparationBackend {
    func hardwareModel(restoreImage: URL) throws -> RestoreMetadata {
        let completion = LockedCompletion<Result<VZMacOSRestoreImage, Error>>()
        VZMacOSRestoreImage.load(from: restoreImage) { completion.complete($0) }
        let deadline = ProcessInfo.processInfo.systemUptime + 30
        var result: Result<VZMacOSRestoreImage, Error>?
        while ProcessInfo.processInfo.systemUptime < deadline {
            if let value = completion.take() { result = value; break }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
        guard let result else { completion.cancel(); throw VMFailure.deadline }
        let image = try result.get()
        guard let supported = image.mostFeaturefulSupportedConfiguration, supported.hardwareModel.isSupported else { throw VMFailure.configuration }
        let os = image.operatingSystemVersion
        return RestoreMetadata(hardware: supported.hardwareModel.dataRepresentation, operatingSystem: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)", build: image.buildVersion)
    }
    func freshMachineIdentifier() -> Data { VZMacMachineIdentifier().dataRepresentation }
    func createAuxiliary(at path: URL, hardware: Data) throws {
        guard let model = VZMacHardwareModel(dataRepresentation: hardware), model.isSupported,
            !FileManager.default.fileExists(atPath: path.path) else { throw VMFailure.configuration }
        _ = try VZMacAuxiliaryStorage(creatingStorageAt: path, hardwareModel: model, options: [])
    }
}
// No network attachment, share, socket, clipboard, or serial implementation exists here.
func configuration(_ workspace: Workspace, run: URL) throws -> VZVirtualMachineConfiguration {
    let manifest = workspace.manifest
    guard VZVirtualMachine.isSupported,
          let hardware = VZMacHardwareModel(dataRepresentation: try SecureFile(run.appendingPathComponent("hardware.bin")).data()), hardware.isSupported,
          let identity = VZMacMachineIdentifier(dataRepresentation: try SecureFile(run.appendingPathComponent("machine-id.bin")).data()) else { throw VMFailure.configuration }
    let platform = VZMacPlatformConfiguration()
    platform.hardwareModel = hardware; platform.machineIdentifier = identity
    platform.auxiliaryStorage = VZMacAuxiliaryStorage(url: run.appendingPathComponent("auxiliary.bin"))
    let config = VZVirtualMachineConfiguration()
    config.platform = platform; config.bootLoader = VZMacOSBootLoader()
    config.cpuCount = manifest.cpuCount; config.memorySize = manifest.memoryGiB * 1024*1024*1024
    config.networkDevices = []; config.directorySharingDevices = []; config.socketDevices = []
    config.serialPorts = []; config.audioDevices = []; config.consoleDevices = []
    config.keyboards = []; config.pointingDevices = []
    let boot = try VZDiskImageStorageDeviceAttachment(url: run.appendingPathComponent("boot.img"), readOnly: false)
    let input = try VZDiskImageStorageDeviceAttachment(url: workspace.input(manifest.input), readOnly: true)
    let output = try VZDiskImageStorageDeviceAttachment(url: run.appendingPathComponent("output.img"), readOnly: false)
    config.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: boot), VZUSBMassStorageDeviceConfiguration(attachment: input), VZUSBMassStorageDeviceConfiguration(attachment: output)]
    let graphics = VZMacGraphicsDeviceConfiguration()
    graphics.displays = [VZMacGraphicsDisplayConfiguration(widthInPixels: 1280, heightInPixels: 800, pixelsPerInch: 80)]
    config.graphicsDevices = [graphics]
    // Configuration is inspected again immediately before VZVirtualMachine construction.
    try verifyConfiguration(config)
    try config.validate()
    return config
}
func verifyConfiguration(_ config: VZVirtualMachineConfiguration) throws {
    guard config.networkDevices.isEmpty, config.directorySharingDevices.isEmpty, config.socketDevices.isEmpty,
          config.serialPorts.isEmpty, config.audioDevices.isEmpty, config.consoleDevices.isEmpty,
          config.storageDevices.count == 3,
          let boot = config.storageDevices[0].attachment as? VZDiskImageStorageDeviceAttachment, !boot.isReadOnly,
          let input = config.storageDevices[1].attachment as? VZDiskImageStorageDeviceAttachment, input.isReadOnly,
          let output = config.storageDevices[2].attachment as? VZDiskImageStorageDeviceAttachment, !output.isReadOnly else { throw VMFailure.configuration }
}
final class VMWorker: NSObject, VZVirtualMachineDelegate {
    let vm: VZVirtualMachine
    let report: URL
    let parent: pid_t
    let deadline: TimeInterval
    var receipt = WorkerReceipt()
    var signals: [DispatchSourceSignal] = []
    var timer: DispatchSourceTimer?
    var finishing = false
    init(config: VZVirtualMachineConfiguration, report: URL, parent: pid_t, seconds: Int) throws {
        try verifyConfiguration(config)
        vm = VZVirtualMachine(configuration: config, queue: .main)
        self.report = report; self.parent = parent
        deadline = ProcessInfo.processInfo.systemUptime + Double(seconds)
        super.init(); vm.delegate = self
    }
    func save() { do { try writeJSON(receipt, to: report) } catch { exit(2) } }
    func begin() {
        for number in [SIGTERM, SIGINT] {
            signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
            source.setEventHandler { self.stop(reason: VMFailure.cancelled.rawValue) }
            source.resume(); signals.append(source)
        }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(100))
        timer.setEventHandler {
            if getppid() != self.parent { self.stop(reason: VMFailure.cancelled.rawValue) }
            else if ProcessInfo.processInfo.systemUptime >= self.deadline { self.stop(reason: VMFailure.deadline.rawValue) }
        }
        self.timer = timer; timer.resume()
        receipt.startRequested = true; save()
        vm.start { result in
            switch result {
            case .success:
                self.receipt.runningObserved = self.vm.state == .running
                self.save()
                if self.finishing { self.forceStop() }
            case .failure:
                self.receipt.failure = VMFailure.worker.rawValue
                self.finish()
            }
        }
    }
    func stop(reason: String) {
        if receipt.failure == nil { receipt.failure = reason }
        finishing = true; receipt.stopRequested = true; save()
        if vm.state == .stopped { finish() }
        else if vm.canStop { forceStop() }
        // Starting/stopping state is rechecked by timer; parent separately bounds completion.
    }
    func forceStop() {
        guard vm.canStop else { return }
        vm.stop { error in
            if error != nil { self.receipt.failure = VMFailure.teardownUnknown.rawValue }
            self.finish()
        }
    }
    func finish() {
        receipt.stoppedObserved = vm.state == .stopped
        save(); exit(receipt.failure == nil && receipt.stoppedObserved ? 0 : 1)
    }
    func guestDidStop(_ virtualMachine: VZVirtualMachine) { finish() }
    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        receipt.failure = VMFailure.worker.rawValue; finish()
    }
}
