import AVFoundation
import CryptoKit
import Foundation
import UIKit
import UserNotifications

struct MobileDevicePreparedSoundStore {
    struct Receipt: Codable {
        let id: String
        let attachmentId: String
        let versionId: String
        let filename: String
    }
    let library: URL
    private func receiptURL(_ id: String, scope: MobileDevicePairing.Scope) -> URL {
        let hash = SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined()
        return library.appendingPathComponent("ThingtimePreparedSounds", isDirectory: true)
            .appendingPathComponent(scope.key, isDirectory: true).appendingPathComponent(hash + ".json")
    }
    func resolve(_ id: String, scope: MobileDevicePairing.Scope) throws -> Receipt? {
        let file = receiptURL(id, scope: scope)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        let receipt = try JSONDecoder().decode(Receipt.self, from: Data(contentsOf: file))
        let soundURL = library.appendingPathComponent("Sounds").appendingPathComponent(receipt.filename)
        guard receipt.id == id, MobileDeviceNotificationSound.validatedName(receipt.filename) != nil,
              FileManager.default.fileExists(atPath: soundURL.path) else {
            throw MobileDevicePairing.Failure.invalid
        }
        let audio = try AVAudioFile(forReading: soundURL)
        let duration = Double(audio.length) / audio.fileFormat.sampleRate
        guard duration.isFinite, duration > 0, duration < 30,
              audio.fileFormat.settings[AVFormatIDKey] as? UInt32 == kAudioFormatLinearPCM else { throw MobileDevicePairing.Failure.invalid }
        return receipt
    }
    func save(_ receipt: Receipt, scope: MobileDevicePairing.Scope) throws {
        guard MobileDeviceNotificationSound.validatedName(receipt.filename) != nil else { throw MobileDevicePairing.Failure.invalid }
        let file = receiptURL(receipt.id, scope: scope)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        try JSONEncoder().encode(receipt).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

/// These actions report OS acceptance/playback initiation, never that a person
/// heard a sound. Notification permissions, Focus and silent mode remain normal.
@MainActor
final class MobileDeviceAlertActions {
    enum Failure: Error { case unavailable, invalidInput, soundNotPrepared, foregroundRequired }
    private let store: MobileDevicePreparedSoundStore
    private let resolveAttachment: (MobileDeviceCommandWorker.Command, MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> URL
    private let authorizeMedia: (MobileDeviceCommandWorker.Command, MobileDevicePairing.Scope, String, String, @escaping () throws -> Void) async throws -> Void
    private let confirmPrepared: (MobileDeviceCommandWorker.Command, String, Double, @escaping () throws -> Void) async throws -> Void
    private var player: AVAudioPlayer?
    private var playingFile: URL?
    init(store: MobileDevicePreparedSoundStore,
         resolveAttachment: @escaping (MobileDeviceCommandWorker.Command, MobileDevicePairing.Scope, @escaping () throws -> Void) async throws -> URL,
         authorizeMedia: @escaping (MobileDeviceCommandWorker.Command, MobileDevicePairing.Scope, String, String, @escaping () throws -> Void) async throws -> Void,
         confirmPrepared: @escaping (MobileDeviceCommandWorker.Command, String, Double, @escaping () throws -> Void) async throws -> Void) {
        self.store = store; self.resolveAttachment = resolveAttachment; self.authorizeMedia = authorizeMedia; self.confirmPrepared = confirmPrepared
    }
    func stop() {
        player?.stop(); player = nil
        if let playingFile { try? FileManager.default.removeItem(at: playingFile) }
        playingFile = nil
    }
    func execute(_ command: MobileDeviceCommandWorker.Command, scope: MobileDevicePairing.Scope,
                 check: @escaping () throws -> Void) async throws {
        try check(); try Task.checkCancellation()
        switch command.kind {
        case "notification.show":
            guard let title = command.input["title"] as? String, let message = command.input["message"] as? String,
                  let sound = command.input["sound"] as? [String: Any], let kind = sound["kind"] as? String else { throw Failure.invalidInput }
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            try check()
            guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { throw Failure.unavailable }
            let content = UNMutableNotificationContent()
            content.title = title; content.body = message
            switch kind {
            case "none": content.sound = nil
            case "default": content.sound = .default
            case "prepared":
                guard let id = sound["id"] as? String, let prepared = try store.resolve(id, scope: scope) else { throw Failure.soundNotPrepared }
                try await authorizeMedia(command, scope, prepared.attachmentId, prepared.versionId, check)
                content.sound = UNNotificationSound(named: .init(rawValue: prepared.filename))
            default: throw Failure.invalidInput
            }
            content.userInfo = ["thingtimeDeviceCommandId": command.id]
            try check()
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(
                identifier: command.id, content: content, trigger: nil))
        case "media.prepare":
            guard command.input["format"] as? String == "notification-sound",
                  let soundId = command.input["soundId"] as? String,
                  soundId.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
                  let attachment = command.input["attachmentId"] as? String,
                  let version = command.input["versionId"] as? String else { throw Failure.invalidInput }
            let receipt: MobileDevicePreparedSoundStore.Receipt
            if let saved = try store.resolve(soundId, scope: scope) {
                guard saved.attachmentId == attachment, saved.versionId == version else { throw Failure.invalidInput }
                receipt = saved
            } else {
                let source = try await resolveAttachment(command, scope, check)
                defer { try? FileManager.default.removeItem(at: source) }
                try check()
                let filename = try await MobileDeviceNotificationSound.prepare(source: source, soundId: soundId, library: store.library)
                receipt = .init(id: soundId, attachmentId: attachment, versionId: version, filename: filename)
                do {
                    try check()
                    try await authorizeMedia(command, scope, attachment, version, check)
                    try store.save(receipt, scope: scope)
                } catch {
                    try? FileManager.default.removeItem(at: store.library.appendingPathComponent("Sounds").appendingPathComponent(filename))
                    throw error
                }
            }
            let audio = try AVAudioFile(forReading: store.library.appendingPathComponent("Sounds").appendingPathComponent(receipt.filename))
            let duration = Double(audio.length) / audio.fileFormat.sampleRate
            try check()
            try await authorizeMedia(command, scope, attachment, version, check)
            try await confirmPrepared(command, soundId, duration, check)
        case "media.play":
            guard UIApplication.shared.applicationState == .active else { throw Failure.foregroundRequired }
            guard let attachment = command.input["attachmentId"] as? String, !attachment.isEmpty,
                  let version = command.input["versionId"] as? String, !version.isEmpty else { throw Failure.invalidInput }
            let file = try await resolveAttachment(command, scope, check)
            var beganPlayback = false
            defer { if !beganPlayback { try? FileManager.default.removeItem(at: file) } }
            try check()
            guard file.isFileURL, UIApplication.shared.applicationState == .active else { throw Failure.foregroundRequired }
            try await authorizeMedia(command, scope, attachment, version, check)
            let next = try AVAudioPlayer(contentsOf: file)
            // Respect the normal silent switch. Never create a background audio
            // loop or pretend this grants critical-alert privileges.
            try AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            try check()
            guard next.play() else { try? FileManager.default.removeItem(at: file); throw Failure.unavailable }
            stop(); player = next; playingFile = file; beganPlayback = true
        default: throw Failure.unavailable
        }
    }
}
