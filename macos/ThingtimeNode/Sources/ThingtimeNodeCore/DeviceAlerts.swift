import AppKit
import AVFoundation
import Foundation
import UserNotifications

public protocol DeviceAlertClient: Sendable {
    func verifyAlertsCapabilities() async throws
    func verifyAlertLease(_ command: LeasedCommand) async throws
    func alertMedia(command: LeasedCommand) async throws -> ThingtimeAPIClient.AlertMedia
    func registerAlertSound(command: LeasedCommand, soundID: String, duration: Double, cacheGeneration: String) async throws
}
extension ThingtimeAPIClient: DeviceAlertClient {}

@MainActor protocol DeviceAlertPlayback: AnyObject {
    var isPlaying: Bool { get }
    var numberOfLoops: Int { get set }
    func prepareToPlay() -> Bool
    func play() -> Bool
}
extension AVAudioPlayer: DeviceAlertPlayback {}

private final class AlertDownloadPolicy: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor public final class DeviceAlertService {
    private var players: [String: any DeviceAlertPlayback] = [:]
    var downloadOverride: (@MainActor (URL) async throws -> (URL, HTTPURLResponse))?
    var playbackFactory: @MainActor (URL) throws -> any DeviceAlertPlayback = { try AVAudioPlayer(contentsOf: $0) }
    var soundDirectoryOverride: URL?
    public init() {}
    public func execute(_ command: LeasedCommand, client: any DeviceAlertClient) async throws -> JSONValue {
        guard command.approvedForExecution, command.leaseExpiresAt > Date() else { throw ThingtimeNodeError.invalidRequest("The alert lease is unavailable.") }
        try await client.verifyAlertsCapabilities()
        let input = command.parameters.objectValue ?? [:]
        switch command.method {
        case "notification.show":
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else {
                throw ThingtimeNodeError.invalidRequest("Enable notifications locally before sending a message to this Mac.")
            }
            guard let title = input["title"]?.stringValue, let message = input["message"]?.stringValue,
                  let sound = input["sound"]?.objectValue, let kind = sound["kind"]?.stringValue else {
                throw ThingtimeNodeError.invalidRequest("The notification payload is invalid.")
            }
            let content = UNMutableNotificationContent(); content.title = title; content.body = message
            switch kind {
            case "none": content.sound = nil
            case "default": content.sound = .default
            case "prepared":
                guard let id = sound["id"]?.stringValue, Self.validSoundID(id),
                      FileManager.default.fileExists(atPath: try soundURL(id).path) else { throw ThingtimeNodeError.invalidRequest("Prepare this notification sound on the Mac first.") }
                content.sound = UNNotificationSound(named: UNNotificationSoundName(id + ".caf"))
            default: throw ThingtimeNodeError.invalidRequest("The notification sound is invalid.")
            }
            try Task.checkCancellation()
            try await client.verifyAlertLease(command)
            if kind == "prepared" { _ = try await client.alertMedia(command: command) }
            do { try await center.add(UNNotificationRequest(identifier: command.commandID, content: content, trigger: nil)) }
            catch { throw ThingtimeNodeError.commandOutcomeUncertain }
        case "media.play", "media.prepare":
            let media = try await client.alertMedia(command: command)
            guard media.attachmentId == input["attachmentId"]?.stringValue,
                  media.versionId == input["versionId"]?.stringValue,
                  media.url.scheme == "https", media.url.user == nil, media.url.password == nil else {
                throw ThingtimeNodeError.invalidRequest("The authorized media version does not match the command.")
            }
            // This signed storage request never carries the node bearer credential.
            let (temporary, response) = try await downloadMedia(media.url)
            defer { try? FileManager.default.removeItem(at: temporary) }
            guard response.statusCode == 200,
                  response.url == media.url,
                  (try temporary.resourceValues(forKeys: [.fileSizeKey])).fileSize.map(Int64.init) == media.size else { throw ThingtimeAPIClientError.invalidResponse }
            try Task.checkCancellation()
            if command.method == "media.play" {
                let player = try playbackFactory(temporary)
                player.numberOfLoops = 0
                guard player.prepareToPlay() else { throw ThingtimeNodeError.invalidRequest("The audio could not be prepared before the lease expired.") }
                try await client.verifyAlertLease(command)
                try await authorizeMediaEffect(command, initial: media, client: client)
                players = players.filter { $0.value.isPlaying }
                players[command.commandID] = player
                guard player.play() else { throw ThingtimeNodeError.commandOutcomeUncertain }
            } else {
                guard let id = input["soundId"]?.stringValue, Self.validSoundID(id), input["format"]?.stringValue == "notification-sound" else { throw ThingtimeNodeError.invalidRequest("The sound preparation payload is invalid.") }
                let source = try AVAudioFile(forReading: temporary)
                let duration = Double(source.length) / source.processingFormat.sampleRate
                // Apple's notification-sound protocol requires sounds shorter than 30 seconds.
                guard duration > 0, duration < 30 else { throw ThingtimeNodeError.invalidRequest("macOS notification sounds must be shorter than 30 seconds; use Play audio for longer recordings.") }
                let destination = try soundURL(id)
                let staging = destination.deletingLastPathComponent().appendingPathComponent(UUID().uuidString + ".caf")
                defer { try? FileManager.default.removeItem(at: staging) }
                do {
                let output = try AVAudioFile(forWriting: staging, settings: source.processingFormat.settings)
                guard let buffer = AVAudioPCMBuffer(pcmFormat: source.processingFormat, frameCapacity: 16_384) else { throw ThingtimeAPIClientError.invalidResponse }
                while source.framePosition < source.length { try Task.checkCancellation(); try source.read(into: buffer); try output.write(from: buffer) }
                }
                try await client.verifyAlertLease(command)
                try await authorizeMediaEffect(command, initial: media, client: client)
                if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: staging) }
                else { try FileManager.default.moveItem(at: staging, to: destination) }
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: destination.path)
                try await client.registerAlertSound(command: command, soundID: id, duration: duration, cacheGeneration: try cacheGeneration())
            }
        default: throw ThingtimeNodeError.invalidRequest("Unsupported alert operation.")
        }
        return .object(["accepted": .bool(true)])
    }
    private func authorizeMediaEffect(_ command: LeasedCommand, initial: ThingtimeAPIClient.AlertMedia, client: any DeviceAlertClient) async throws {
        // Lease renewal proves command ownership, not current attachment authorization.
        // This fresh media grant fences deletion, moderation and version changes during download/conversion.
        let current = try await client.alertMedia(command: command)
        guard current.attachmentId == initial.attachmentId, current.versionId == initial.versionId,
              current.size == initial.size, current.contentType == initial.contentType else {
            throw ThingtimeAPIClientError.invalidResponse
        }
        try Task.checkCancellation()
    }
    private func downloadMedia(_ url: URL) async throws -> (URL, HTTPURLResponse) {
        if let downloadOverride { return try await downloadOverride(url) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil; configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration, delegate: AlertDownloadPolicy(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (temporary, raw) = try await session.download(for: URLRequest(url: url, timeoutInterval: 120))
        guard let response = raw as? HTTPURLResponse else {
            try? FileManager.default.removeItem(at: temporary)
            throw ThingtimeAPIClientError.invalidResponse
        }
        return (temporary, response)
    }
    public func requestPermission() async throws -> Bool {
        try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
    }
    nonisolated static func validSoundID(_ id: String) -> Bool { id.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    private func cacheGeneration() throws -> String {
        let path = try soundURL(String(repeating: "0", count: 64)).deletingLastPathComponent().appendingPathComponent(".thingtime-cache-generation")
        if let data = try? Data(contentsOf: path), let value = String(data: data, encoding: .utf8), UUID(uuidString: value) != nil { return value }
        let value = UUID().uuidString.lowercased()
        try Data(value.utf8).write(to: path, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path.path)
        return value
    }
    private func soundURL(_ id: String) throws -> URL {
        guard Self.validSoundID(id) else { throw ThingtimeNodeError.invalidRequest("Invalid sound identifier.") }
        let directory = soundDirectoryOverride ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Sounds", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        return directory.appendingPathComponent(id + ".caf")
    }
}
