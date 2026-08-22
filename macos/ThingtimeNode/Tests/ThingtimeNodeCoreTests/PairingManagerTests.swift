import CryptoKit
import Foundation
import Security
import XCTest
@testable import ThingtimeNodeCore

final class PairingManagerTests: XCTestCase {
    private let serverPairingSecret = "ttpair_abcdefghijklmnopqrstuvwxyzABCDEFGH123456789"

    func testPairCompleteAndUnpairLifecycle() async throws {
        let store = InMemoryDeviceCredentialStore()
        let manager = PairingManager(store: store)
        let now = Date(timeIntervalSince1970: 1_000)
        let challenge = try await manager.begin(now: now)
        let initialStatus = try await manager.status()
        XCTAssertEqual(challenge.publicKey.count, 32)
        XCTAssertEqual(challenge.nonce.count, 32)
        XCTAssertFalse(initialStatus.paired)

        let request = try await manager.bindPreparedClaim(
            pairingID: challenge.pairingID,
            serverProof: PairingPrepareResponse(
                pairingID: "pairing-1",
                serverNonce: Data(repeating: 7, count: 32),
                expiresAt: now.addingTimeInterval(60)
            ),
            device: PairingDeviceDescriptor(
                name: " Mac ", platform: "macos", model: "Mac1,1", osVersion: " macOS 15 ", appVersion: " 0.1.0 "
            ),
            capabilities: ["system.volume.write", "apps.read", "apps.read"],
            now: now
        )

        let paired = try await manager.complete(
            pairingID: challenge.pairingID,
            deviceID: "device-123",
            refreshToken: request.credential,
            now: now.addingTimeInterval(1)
        )
        XCTAssertEqual(paired, PairingStatus(paired: true, deviceID: "device-123"))
        let credential = try await store.load()
        XCTAssertEqual(credential?.deviceID, "device-123")
        XCTAssertEqual(credential?.signingPrivateKey.count, 32)
        let pendingBeforeJournalCommit = try await store.loadPendingPairingClaim()
        XCTAssertNotNil(pendingBeforeJournalCommit, "Pending proof remains until the journaled command commits.")
        try await manager.clearCompletedClaim(pairingID: challenge.pairingID)
        let pendingAfterJournalCommit = try await store.loadPendingPairingClaim()
        XCTAssertNil(pendingAfterJournalCommit)

        let unpaired = try await manager.unpair()
        let deletedCredential = try await store.load()
        XCTAssertEqual(unpaired, PairingStatus(paired: false, deviceID: nil))
        XCTAssertNil(deletedCredential)
    }

    func testExpiredChallengeCannotComplete() async throws {
        let manager = PairingManager(store: InMemoryDeviceCredentialStore())
        let now = Date(timeIntervalSince1970: 2_000)
        let challenge = try await manager.begin(now: now, lifetime: 1)
        do {
            _ = try await manager.bindPreparedClaim(
                pairingID: challenge.pairingID,
                serverProof: PairingPrepareResponse(
                    pairingID: "pairing",
                    serverNonce: Data(repeating: 1, count: 32),
                    expiresAt: now.addingTimeInterval(10)
                ),
                device: PairingDeviceDescriptor(
                    name: "Mac", platform: "macos", model: nil, osVersion: "macOS", appVersion: "0.1.0"
                ),
                capabilities: [],
                now: now.addingTimeInterval(2)
            )
            XCTFail("Expired challenge should fail")
        } catch {
            XCTAssertEqual(
                error as? ThingtimeNodeError,
                .invalidRequest("The server pairing proof is invalid or expired.")
            )
        }
    }

    func testOneMacCanRetainIndependentPairingsForMultipleAccounts() async throws {
        let store = InMemoryDeviceCredentialStore()
        let manager = PairingManager(store: store)
        let now = Date(timeIntervalSince1970: 3_000)

        for (index, deviceID) in ["account-one-device", "account-two-device"].enumerated() {
            let challenge = try await manager.begin(now: now.addingTimeInterval(Double(index) * 10))
            let request = try await manager.bindPreparedClaim(
                pairingID: challenge.pairingID,
                serverProof: PairingPrepareResponse(
                    pairingID: "pairing-\(index)",
                    serverNonce: Data(repeating: UInt8(index + 1), count: 32),
                    expiresAt: now.addingTimeInterval(120)
                ),
                device: PairingDeviceDescriptor(
                    name: "Mac", platform: "macos", model: nil, osVersion: "macOS", appVersion: "0.1.0"
                ),
                capabilities: ["apps.read"],
                now: now.addingTimeInterval(Double(index) * 10)
            )
            _ = try await manager.complete(
                pairingID: challenge.pairingID,
                deviceID: deviceID,
                refreshToken: request.credential,
                now: now.addingTimeInterval(Double(index) * 10 + 1)
            )
            try await manager.clearCompletedClaim(pairingID: challenge.pairingID)
        }

        let credentials = try await store.loadAll()
        let status = try await manager.status()
        XCTAssertEqual(credentials.map(\.deviceID), ["account-one-device", "account-two-device"])
        XCTAssertEqual(
            status,
            PairingStatus(
                paired: true,
                deviceID: "account-one-device",
                deviceIDs: ["account-one-device", "account-two-device"]
            )
        )
    }

    func testServerPairingSecretCanBackTheLocalKeyChallenge() async throws {
        let manager = PairingManager(store: InMemoryDeviceCredentialStore())
        let localChallenge = try await manager.begin()
        let challenge = try await manager.begin(pairingID: serverPairingSecret)
        XCTAssertEqual(challenge.pairingID, serverPairingSecret)
        XCTAssertEqual(challenge.publicKey, localChallenge.publicKey)
        XCTAssertEqual(challenge.nonce, localChallenge.nonce)

        do {
            _ = try await manager.begin(pairingID: "bad\nsecret")
            XCTFail("Control characters must be rejected.")
        } catch {
            XCTAssertEqual(error as? ThingtimeNodeError, .invalidRequest("The pairing secret is invalid."))
        }
    }

    func testPendingClaimAndExactSignedCompleteSurviveManagerRecreation() async throws {
        let store = InMemoryDeviceCredentialStore()
        let firstManager = PairingManager(store: store)
        let now = Date(timeIntervalSince1970: 10_000)
        let challenge = try await firstManager.begin(pairingID: serverPairingSecret, now: now)
        let prepare = PairingPrepareRequest(
            pairingSecret: challenge.pairingID,
            publicKey: challenge.publicKey,
            nonce: challenge.nonce
        )

        let recreatedBeforePrepare = PairingManager(store: store)
        let replayedChallenge = try await recreatedBeforePrepare.begin(pairingID: serverPairingSecret, now: now.addingTimeInterval(1))
        XCTAssertEqual(
            PairingPrepareRequest(
                pairingSecret: replayedChallenge.pairingID,
                publicKey: replayedChallenge.publicKey,
                nonce: replayedChallenge.nonce
            ),
            prepare
        )

        let complete = try await recreatedBeforePrepare.bindPreparedClaim(
            pairingID: serverPairingSecret,
            serverProof: PairingPrepareResponse(
                pairingID: "pairing-id",
                serverNonce: Data(repeating: 9, count: 32),
                expiresAt: now.addingTimeInterval(120)
            ),
            device: PairingDeviceDescriptor(
                name: "Mac", platform: "macos", model: nil, osVersion: "macOS 15", appVersion: "0.1.0"
            ),
            capabilities: ["system.volume.write", "apps.read"],
            now: now.addingTimeInterval(2)
        )
        let recreatedBeforeComplete = PairingManager(store: store)
        let replayedComplete = try await recreatedBeforeComplete.preparedClaim(pairingID: serverPairingSecret)
        XCTAssertEqual(replayedComplete, complete)

        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: complete.proof.publicKey)
        let canonical = PairingClaimProof.canonicalMessage(
            pairingID: complete.proof.pairingID,
            pairingSecret: complete.pairingSecret,
            credential: complete.credential,
            publicKey: complete.proof.publicKey,
            nonce: complete.proof.nonce,
            serverNonce: complete.proof.serverNonce,
            device: complete.device,
            capabilities: complete.capabilities
        )
        XCTAssertTrue(publicKey.isValidSignature(complete.proof.signature, for: canonical))
        XCTAssertEqual(complete.capabilities, ["apps.read", "system.volume.write"])
        XCTAssertEqual(complete.device.name, "Mac")
    }

    func testMacCredentialStoreDoesNotRequireAProvisioningOnlyKeychainEntitlement() {
        let store = KeychainDeviceCredentialStore(
            service: "com.thingtime.desktop.node.tests",
            account: "credential-query-test"
        )
        let query = store.baseQuery(account: "credential-query-test")

        XCTAssertEqual(query[kSecClass as String] as! CFString, kSecClassGenericPassword)
        XCTAssertEqual(query[kSecAttrService as String] as? String, "com.thingtime.desktop.node.tests")
        XCTAssertEqual(query[kSecAttrAccount as String] as? String, "credential-query-test")
        XCTAssertNil(
            query[kSecUseDataProtectionKeychain as String],
            "A manually signed macOS helper has no provisioning-authorized application identifier and must not request the Data Protection Keychain."
        )
    }
}
