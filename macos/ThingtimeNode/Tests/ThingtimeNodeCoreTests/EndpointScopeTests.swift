import Foundation
import XCTest
@testable import ThingtimeNodeCore

final class EndpointScopeTests: XCTestCase {
    func testScopesCredentialsAndJournalsByCanonicalDeploymentOrigin() throws {
        let first = try ThingtimeNodeEndpointScope(baseURL: XCTUnwrap(URL(string: "https://PR-68.previews.dev.thingtime.com/")))
        let same = try ThingtimeNodeEndpointScope(baseURL: XCTUnwrap(URL(string: "https://pr-68.previews.dev.thingtime.com/")))
        let defaultPort = try ThingtimeNodeEndpointScope(baseURL: XCTUnwrap(URL(string: "https://pr-68.previews.dev.thingtime.com:443/")))
        let other = try ThingtimeNodeEndpointScope(baseURL: XCTUnwrap(URL(string: "https://thingtime.com/")))

        XCTAssertEqual(first, same)
        XCTAssertEqual(first, defaultPort)
        XCTAssertNotEqual(first.identifier, other.identifier)
        XCTAssertEqual(first.canonicalBaseURL.absoluteString, "https://pr-68.previews.dev.thingtime.com/")
        XCTAssertTrue(first.credentialAccount.hasPrefix("device-credential-v2."))
        XCTAssertNil(first.legacyCredentialAccount)
        XCTAssertEqual(other.legacyCredentialAccount, "device-credential-v1")
        XCTAssertTrue(first.commandJournalFileURL().lastPathComponent.contains(first.identifier))
        XCTAssertTrue(first.liveAIJournalFileURL().lastPathComponent.contains(first.identifier))
        XCTAssertEqual(other.commandJournalFileURL().lastPathComponent, "command-journal.json")
        XCTAssertEqual(other.liveAIJournalFileURL().lastPathComponent, "live-ai-sync-journal.json")
    }

    func testRejectsCredentialedOrFragmentedBaseURLs() throws {
        XCTAssertThrowsError(try ThingtimeNodeEndpointScope(baseURL: XCTUnwrap(URL(string: "https://user@example.com/"))))
        XCTAssertThrowsError(try ThingtimeNodeEndpointScope(baseURL: XCTUnwrap(URL(string: "https://example.com/#secret"))))
    }
}
