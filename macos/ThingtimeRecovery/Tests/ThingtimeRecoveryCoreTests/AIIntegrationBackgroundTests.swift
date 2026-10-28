import Foundation
import Testing
@testable import ThingtimeRecoveryCore

struct AIIntegrationBackgroundTests {
    private func fixture() throws -> URL {
        let home = FileManager.default.temporaryDirectory.resolvingSymlinksInPath().appendingPathComponent("recovery-background-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
        return home
    }

    @Test func foreignJobCannotBeRemovedOrOverwritten() throws {
        let home = try fixture(); defer { try? FileManager.default.removeItem(at: home) }
        let service = AIIntegrationBackgroundService(homeDirectory: home)
        try FileManager.default.createDirectory(at: service.plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try PropertyListSerialization.data(fromPropertyList: ["Label": AIIntegrationBackgroundService.label, "ProgramArguments": ["/bin/echo", "not ours"]], format: .xml, options: 0)
        try data.write(to: service.plistURL)
        #expect(!service.isEnabled)
        #expect(throws: (any Error).self) { try service.setEnabled(false) }
        #expect(throws: (any Error).self) { try service.setEnabled(true) }
        #expect(try Data(contentsOf: service.plistURL) == data)
    }

    @Test func symlinkedLibraryCannotRedirectSchedule() throws {
        let home = try fixture(); defer { try? FileManager.default.removeItem(at: home) }
        let outside = try fixture(); defer { try? FileManager.default.removeItem(at: outside) }
        try FileManager.default.createSymbolicLink(at: home.appendingPathComponent("Library"), withDestinationURL: outside)
        let service = AIIntegrationBackgroundService(homeDirectory: home)
        #expect(throws: (any Error).self) { try service.setEnabled(false) }
        #expect(throws: (any Error).self) { try service.setEnabled(true) }
        #expect(try FileManager.default.contentsOfDirectory(atPath: outside.path).isEmpty)
    }

    @Test func matchingProgramWithInjectedEnvironmentIsNotOwned() throws {
        let home = try fixture(); defer { try? FileManager.default.removeItem(at: home) }
        let service = AIIntegrationBackgroundService(homeDirectory: home)
        try FileManager.default.createDirectory(at: service.plistURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let job: [String: Any] = ["Label": AIIntegrationBackgroundService.label, "ProgramArguments": [home.appendingPathComponent("Applications/Thingtime Recovery.app/Contents/Helpers/ThingtimeIntegrationManager").path, "sync"], "EnvironmentVariables": ["DYLD_INSERT_LIBRARIES": "/untrusted"]]
        let data = try PropertyListSerialization.data(fromPropertyList: job, format: .xml, options: 0)
        try data.write(to: service.plistURL)
        #expect(throws: (any Error).self) { try service.setEnabled(false) }
        #expect(try Data(contentsOf: service.plistURL) == data)
    }
}
