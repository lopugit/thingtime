import Foundation
import ThingtimePasswordCore

// A separate signed target. The production scheme does not build or embed it,
// and the production helper has no synthetic-store command.
@main enum PasswordFixture {
    static func main() {
        do {
            #if THINGTIME_PASSWORD_DEVELOPMENT_FIXTURE
            let info = Bundle.main.infoDictionary ?? [:]
            guard info["ThingtimePasswordDevelopmentFixture"] as? Bool == true,
                  let host = info["ThingtimePasswordDevelopmentHost"] as? String,
                  host != "com.thingtime.passwords",
                  Bundle.main.bundleIdentifier == host + ".fixture",
                  let group = info["ThingtimePasswordKeychainGroup"] as? String,
                  group.hasSuffix("." + host), !group.contains("$("),
                  info["ThingtimePasswordNotificationName"] as? String == host + ".destination-changed"
            else { throw PasswordProviderError.invalidSession }
            if CommandLine.arguments == [CommandLine.arguments[0], "--assert-empty"] {
                guard try PasswordSessionStore.loadIfPresent() == nil else { throw PasswordProviderError.conflict }
                FileHandle.standardOutput.write(Data("{\"ok\":true}\n".utf8))
            } else if CommandLine.arguments == [CommandLine.arguments[0], "--seed"] ||
                        CommandLine.arguments == [CommandLine.arguments[0], "--exact-state"] {
                guard let bytes = try FileHandle.standardInput.read(upToCount: 65537), bytes.count <= 65536 else { throw PasswordProviderError.invalidSession }
                let decoded = try JSONDecoder().decode(ProviderSession.self, from: bytes)
                let session = try ProviderSession(origin: decoded.origin, ownerId: decoded.ownerId, cookie: decoded.cookie)
                guard session.origin.host?.hasSuffix(".invalid") == true,
                      session.ownerId.hasPrefix("native-bundle-qa-"),
                      session.cookie.hasPrefix("tt_auth=thingtime-native-qa-"), decoded.companionConnectionID == nil
                else { throw PasswordProviderError.invalidSession }
                if CommandLine.arguments[1] == "--exact-state" {
                    let saved = try PasswordSessionStore.loadIfPresent()
                    let result = ["empty": saved == nil, "matches": saved == session]
                    FileHandle.standardOutput.write(try JSONEncoder().encode(result))
                } else {
                    guard try PasswordSessionStore.loadIfPresent() == nil else { throw PasswordProviderError.conflict }
                    try PasswordSessionStore.saveIfAbsent(session)
                    guard try PasswordSessionStore.load() == session else { throw PasswordProviderError.unavailable }
                    FileHandle.standardOutput.write(Data("{\"ok\":true}\n".utf8))
                }
            } else { throw PasswordProviderError.invalidSession }
            #else
            throw PasswordProviderError.invalidSession
            #endif
        } catch { exit(1) }
    }
}
