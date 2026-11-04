import XCTest
@testable import Thingtime_Widgets

final class WidgetEndpointsTests: XCTestCase {
    func testMigrationPersistenceEditingAndRemoval() throws {
        let suite = "WidgetEndpointsTests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var library = WidgetEndpoints(defaults: defaults, currentOrigin: "http://127.0.0.1:11240")
        XCTAssertEqual(library.entries.map(\.origin), ["https://thingtime.com", "http://127.0.0.1:11240"])
        let custom = try library.save(id: nil, name: " My server ", address: "https://WIDGETS.example:443/")
        XCTAssertEqual(custom.name, "My server")
        try library.persist(to: defaults)
        library = WidgetEndpoints(defaults: defaults, currentOrigin: "http://127.0.0.1:11240")
        XCTAssertTrue(library.entries.contains(custom))
        let edited = try library.save(id: custom.id, name: "Work", address: "https://work.example")
        XCTAssertEqual(edited.id, custom.id)
        XCTAssertFalse(library.entries.contains(where: { $0.origin == custom.origin }))
        library.remove(custom.id)
        XCTAssertEqual(library.entries.count, 2)
    }
    func testDuplicateUnsafeAndEmptyEndpointsAreRejected() throws {
        let suite = "WidgetEndpointsTests.\(UUID())"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var library = WidgetEndpoints(defaults: defaults, currentOrigin: "https://thingtime.com")
        XCTAssertThrowsError(try library.save(id: nil, name: "Duplicate", address: "thingtime.com"))
        for address in ["http://remote.example", "https://user:secret@example.com", "https://example.com/api", "https://example.com?token=secret"] {
            XCTAssertThrowsError(try library.save(id: nil, name: "Unsafe", address: address))
        }
        XCTAssertThrowsError(try library.save(id: nil, name: "  ", address: "https://example.com"))
        XCTAssertEqual(library.entries.count, 1)
    }
}
