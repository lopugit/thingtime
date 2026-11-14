import CryptoKit
import Foundation

/// The wire payload intentionally has no arbitrary text, URLs, paths, asset IDs,
/// exception descriptions or authentication material. Keep this closed model
/// aligned with remix/app/devices/deviceDiagnostics.ts.
struct MobileDeviceDiagnosticEvent: Codable, Equatable, Sendable {
    enum Failure: Error { case invalid }
    enum Category: String, Codable, Sendable { case lifecycle, sync, upload, index, network, storage, permission }
    enum Level: String, Codable, Sendable { case info, warning, error }
    enum State: String, Codable, Sendable { case running, waiting, failed, paused, complete, idle }
    enum Code: String, Codable, Sendable {
        case snapshot = "sync.snapshot", started = "sync.started", waiting = "sync.waiting"
        case failed = "sync.failed", completed = "sync.completed"
        case backgroundRequest = "background.request", backgroundEnded = "background.ended"
        case transportFailed = "transport.failed"
        case appStarted = "app.started", appForeground = "app.foreground", appBackground = "app.background"
    }
    struct Counts: Codable, Equatable, Sendable {
        var inspectedAssets: Int64?
        var indexedResources: Int64?
        var pendingOriginals: Int64?
        var unavailableOriginals: Int64?
        var uploadedFiles: Int64?
        var uploadedBytes: Int64?
        var totalBytes: Int64?
        var values: [Int64?] { [inspectedAssets, indexedResources, pendingOriginals, unavailableOriginals, uploadedFiles, uploadedBytes, totalBytes] }
    }
    struct Runtime: Codable, Equatable, Sendable {
        enum Platform: String, Codable, Sendable { case ios, macos, web }
        var platform: Platform = .ios
        var appVersion: String?
        var build: String?
        var osVersion: String?
        static func current(bundle: Bundle = .main, os: OperatingSystemVersion = ProcessInfo.processInfo.operatingSystemVersion) -> Self {
            func version(_ value: Any?) -> String? {
                guard let value = value as? String, value.range(of: #"^\d{1,6}(?:\.\d{1,6}){0,3}$"#, options: .regularExpression) != nil else { return nil }
                return value
            }
            let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
            return .init(appVersion: version(bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString")),
                         build: build.flatMap { $0.range(of: #"^\d{1,12}$"#, options: .regularExpression) != nil ? $0 : nil },
                         osVersion: version("\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)"))
        }
    }
    struct Background: Codable, Equatable, Sendable {
        enum ApplicationState: String, Codable, Sendable { case active, inactive, background }
        enum Outcome: String, Codable, Sendable {
            case unregistered, busy, cancelled, submitted, declined
            case launchTimeout = "launch-timeout"
            case active, expired, completed, failed
        }
        var request: NativePhotoRunActivity.BackgroundRequest?
        var cause: NativePhotoRunActivity.BackgroundEndCause?
        var outcome: Outcome?
        var measuredUnits: Int64?
        var lastProgressAt: String?
        var applicationState: ApplicationState?
    }
    struct SystemError: Codable, Equatable, Sendable {
        enum Domain: String, Codable, Sendable {
            case background = "BGTaskSchedulerErrorDomain", network = "NSURLErrorDomain"
            case storage = "NSCocoaErrorDomain", photos = "PHPhotosErrorDomain"
        }
        let domain: Domain
        let code: Int64
        init?(error: Error) {
            let error = error as NSError
            guard let domain = Domain(rawValue: error.domain),
                  (-MobileDeviceDiagnosticEvent.maximumJSONInteger...MobileDeviceDiagnosticEvent.maximumJSONInteger).contains(Int64(error.code)) else { return nil }
            self.domain = domain; self.code = Int64(error.code)
        }
    }

    let eventId: String
    let occurredAt: String
    var category: Category
    var level: Level
    var code: Code
    var state: State
    var configurationId: String?
    var runKey: String?
    var phase: NativePhotoRunActivity.Phase?
    var reason: NativePhotoRunActivity.Reason?
    var failureOperation: NativeDeferredUploadClient.Operation?
    var retrySource: NativePhotoRunRecord.RetrySource?
    var retryAt: String?
    var counts: Counts?
    var runtime: Runtime?
    var background: Background?
    var systemError: SystemError?

    static let maximumJSONInteger: Int64 = 9_007_199_254_740_991
    init(category: Category, level: Level, code: Code, state: State,
         id: UUID = UUID(), at: Date = Date(), runtime: Runtime? = .current()) {
        eventId = id.uuidString.lowercased(); occurredAt = Self.timestamp(at)
        self.category = category; self.level = level; self.code = code; self.state = state; self.runtime = runtime
    }
    static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
    static func correlationKey(runId: String, epoch: UUID) -> String {
        SHA256.hash(data: Data((runId + "\n" + epoch.uuidString).utf8)).map { String(format: "%02x", $0) }.joined()
    }
    /// Omit an unrepresentable measurement instead of changing its value.
    static func measurement(_ value: Int64?) -> Int64? {
        value.flatMap { (0...maximumJSONInteger).contains($0) ? $0 : nil }
    }
    func validate() throws {
        func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
        func date(_ value: String) -> Bool {
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let parsed = formatter.date(from: value), parsed.timeIntervalSince1970.isFinite else { return false }
            return Self.timestamp(parsed) == value
        }
        guard matches(eventId, #"^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$"#), date(occurredAt),
              configurationId.map({ matches($0, #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$"#) }) ?? true,
              runKey.map({ matches($0, #"^[a-f0-9]{64}$"#) }) ?? true,
              retryAt.map(date) ?? true, background?.lastProgressAt.map(date) ?? true,
              counts?.values.compactMap({ $0 }).allSatisfy({ (0...Self.maximumJSONInteger).contains($0) }) ?? true,
              background?.measuredUnits.map({ (0...Self.maximumJSONInteger).contains($0) }) ?? true,
              systemError.map({ (-Self.maximumJSONInteger...Self.maximumJSONInteger).contains($0.code) }) ?? true,
              runtime?.appVersion.map({ matches($0, #"^\d{1,6}(?:\.\d{1,6}){0,3}$"#) }) ?? true,
              runtime?.osVersion.map({ matches($0, #"^\d{1,6}(?:\.\d{1,6}){0,3}$"#) }) ?? true,
              runtime?.build.map({ matches($0, #"^\d{1,12}$"#) }) ?? true else { throw Failure.invalid }
    }
    func encoded() throws -> Data {
        try validate()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(self)
    }
}
