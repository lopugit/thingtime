@testable import AppleFileSync
import Foundation
import XCTest

final class MobileFolderIgnoreRulesTests: XCTestCase {
    private func git(_ args: [String], at directory: URL, input: Data? = nil) throws -> Int32 {
        let process = Process()
        // Match the shared TypeScript oracle's explicit Git selection.
        // Raw path bytes are supplied through stdin below.
        let executable = ["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
        process.executableURL = URL(fileURLWithPath: try XCTUnwrap(executable))
        process.arguments = args; process.currentDirectoryURL = directory
        process.environment = ["PATH": "/usr/bin:/bin", "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null"]
        process.standardOutput = Pipe(); process.standardError = Pipe()
        let stdin = Pipe()
        if input != nil { process.standardInput = stdin }
        try process.run()
        if let input { try stdin.fileHandleForWriting.write(contentsOf: input); try stdin.fileHandleForWriting.close() }
        process.waitUntilExit(); return process.terminationStatus
    }
    func testConformanceWithGitCheckIgnoreIncludingByteWildcards() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("native-ignore-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        XCTAssertEqual(try git(["init", "-q"], at: root), 0)
        let cases: [(String, [(String, Bool)])] = [
            ("node_modules/\n*.log\n!keep.log", [("node_modules", true), ("node_modules", false), ("project/node_modules/a.js", false), ("a.log", false), ("keep.log", false), ("src/keep.log", false), ("NODE_MODULES/a", false)]),
            ("/root.txt\ncache/file?.[ch]", [("root.txt", false), ("src/root.txt", false), ("cache/file1.c", false), ("src/cache/file1.c", false)]),
            ("foo/**/bar\na/***/b\n**/cache/\nx/**", [("foo/bar", false), ("foo/a/b/bar", false), ("a/b", false), ("a/x/y/b", false), ("x", true), ("x/a", false), ("deep/cache/a", false)]),
            ("dir/\n!dir/keep.txt", [("dir", true), ("dir/keep.txt", false), ("dir-other/keep.txt", false)]),
            ("dir/*\n!dir/keep.txt\n!dir/sub/\ndir/sub/*\n!dir/sub/yes", [("dir/keep.txt", false), ("dir/no", false), ("dir/sub/yes", false), ("dir/sub/no", false)]),
            ("#comment\n\\#literal\n\\!literal\nspace\\ \ntrailing   \nfile\\?.txt", [("#literal", false), ("!literal", false), ("space ", false), ("space", false), ("trailing", false), ("file?.txt", false), ("file1.txt", false)]),
            ("caf?.txt\nλ??\n[[:alpha:]][[:digit:]].txt\n[a/b]\nunterminated[\ntrailing\\", [("café.txt", false), ("λab", false), ("a1.txt", false), ("é1.txt", false), ("a", false), ("b", false), ("a/b", false), ("unterminated[", false), ("trailing\\", false)]),
            ("caf??.txt\n[!a-c]file\n[]a]file\n[\\-a]dash\n[A-Z]case", [("café.txt", false), ("dfile", false), ("afile", false), ("]file", false), ("-dash", false), ("acase", false), ("Zcase", false)]),
            ("a\\/b\nfoo**bar\n**/leaf\n!root/leaf\n[[:xdigit:]].hex", [("a/b", false), ("x/a/b", false), ("fooxbar", false), ("foo/x/bar", false), ("leaf", false), ("a/b/leaf", false), ("root/leaf", false), ("F.hex", false), ("z.hex", false)]),
            ("a\r\nb\r\n\\!literal\r\n", [("a", false), ("b", false), ("!literal", false), ("c", false)])
        ]
        for (text, paths) in cases {
            try Data(text.utf8).write(to: root.appendingPathComponent(".gitignore"))
            let rules = try MobileFolderIgnoreRules(text)
            for (path, directory) in paths {
                // A trailing slash is itself matchable by x/**, unlike the
                // directory entry x. Materialize the type and query its raw path.
                for child in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
                    where ![".git", ".gitignore"].contains(child.lastPathComponent) { try FileManager.default.removeItem(at: child) }
                let target = root.appendingPathComponent(path)
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                if directory { try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true) }
                else { try Data().write(to: target) }
                // Pass raw UTF-8 through stdin; Foundation's argv bridge can
                // normalize Unicode independently of Git's precompose option.
                let status = try git(["-c", "core.ignorecase=false", "-c", "core.precomposeunicode=false", "check-ignore", "--no-index", "--stdin", "-z"], at: root,
                    input: Data(path.utf8) + Data([0]))
                XCTAssertTrue(status == 0 || status == 1)
                XCTAssertEqual(rules.ignores(path, isDirectory: directory), status == 0, "rules=\(text.debugDescription), path=\(path.debugDescription), directory=\(directory)")
            }
        }
    }
    func testEscapedGlobstarSeparatorAndHyphenFollowGit() throws {
        let separator = try MobileFolderIgnoreRules("a/**\\/b")
        XCTAssertFalse(separator.ignores("a/b", isDirectory: false))
        XCTAssertTrue(separator.ignores("a/x/b", isDirectory: false))
        XCTAssertTrue(separator.ignores("a/x/y/b", isDirectory: false))
        let hyphen = try MobileFolderIgnoreRules("[a\\-c]dash")
        XCTAssertTrue(hyphen.ignores("-dash", isDirectory: false))
        XCTAssertFalse(hyphen.ignores("bdash", isDirectory: false))
        let reverse = try MobileFolderIgnoreRules("[z-a]file")
        XCTAssertTrue(reverse.ignores("zfile", isDirectory: false))
        XCTAssertFalse(reverse.ignores("afile", isDirectory: false))
    }

    func testSharedGitOracleCorpusMatchesNative() throws {
        struct Fixture: Decodable {
            struct Path: Decodable { let path: String; let kind: String; let ignored: Bool }
            let rules: String; let paths: [Path]
        }
        // One checked-in Git oracle is consumed by both Swift and TypeScript.
        // The local oracle test above independently checks additional fixtures.
        var project = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { project.deleteLastPathComponent() }
        let file = project.appendingPathComponent("remix/app/fileSync/syncIgnore.fixtures.json")
        let fixtures = try JSONDecoder().decode([Fixture].self, from: Data(contentsOf: file))
        XCTAssertFalse(fixtures.isEmpty)
        for fixture in fixtures {
            let rules = try MobileFolderIgnoreRules(fixture.rules)
            for item in fixture.paths {
                XCTAssertTrue(["file", "folder"].contains(item.kind))
                XCTAssertEqual(rules.ignores(item.path, isDirectory: item.kind == "folder"), item.ignored,
                    "rules=\(fixture.rules.debugDescription), path=\(item.path.debugDescription), kind=\(item.kind)")
            }
        }
    }

    func testValidationPreservesPolicyBytesAndHasNoBacktrackingExplosion() throws {
        XCTAssertNil(try MobileFolderIgnoreRules("").text)
        let text = "a\r\nspace\\ \n!keep\n"
        XCTAssertEqual(try MobileFolderIgnoreRules(text).text, text)
        for bad in ["\0"] {
            XCTAssertThrowsError(try MobileFolderIgnoreRules(bad))
        }
        XCTAssertNotNil(try MobileFolderIgnoreRules(String(repeating: "x", count: 16_385)).text)
        XCTAssertNotNil(try MobileFolderIgnoreRules(String(repeating: "\n", count: 2000)).text)
        let rules = try MobileFolderIgnoreRules(String(repeating: "*a", count: 150) + "z")
        XCTAssertFalse(rules.ignores(String(repeating: "a", count: 300) + "q", isDirectory: false))
        XCTAssertTrue(rules.ignores(String(repeating: "a", count: 300) + "z", isDirectory: false))
    }
}
