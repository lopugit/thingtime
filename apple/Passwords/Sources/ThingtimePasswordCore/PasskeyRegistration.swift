import Foundation

/// Memory-only material for one OS registration ceremony. Every retry keeps
/// its immutable payload and server write identity, including uncertain saves
/// and failures after a successful save. Never persist or log this object.
public struct PendingPasskeyRegistration {
    public let key: PasskeyMaterial
    public let id: String
    public let writeID: String
    private let origin: URL
    private let owner: String
    public init(key: PasskeyMaterial, session: ProviderSession) {
        self.key = key; origin = session.origin; owner = session.ownerId
        id = UUID().uuidString.lowercased(); writeID = UUID().uuidString.lowercased()
    }
    public func verifyScope(_ session: ProviderSession) throws {
        guard session.origin == origin, session.ownerId == owner else { throw PasswordProviderError.accountMismatch }
    }
    @MainActor public func persist(session: ProviderSession,
                                   verify: () throws -> Void,
                                   save: (PasswordEntry, String, String) async throws -> Void,
                                   read: (String) async throws -> PasswordEntry,
                                   index: (PasskeyMaterial, String) async throws -> Void) async throws {
        try verifyScope(session); try verify()
        try await save(key.entry, id, writeID); try verify()
        let stored = try await read(id), confirmed = try PasskeyMaterial(entry: stored)
        guard confirmed.credentialID == key.credentialID, confirmed.privateKey == key.privateKey,
              confirmed.relyingParty == key.relyingParty, confirmed.userHandle == key.userHandle else { throw PasswordProviderError.invalidResponse }
        try verify(); try await index(key, id); try verify()
    }
}
