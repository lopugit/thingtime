import Foundation

/// An explicit sync-root-relative list, not discovery of on-disk .gitignore
/// files. Matching follows Git's case-sensitive byte wildcard semantics.
public struct MobileFolderIgnoreRules: Sendable {
    public let text: String?
    private struct Rule: Sendable {
        let tokens: [Token]
        let basename: Bool
        let directory: Bool
        let negative: Bool
    }
    private enum Token: Sendable {
        case literal(UInt8), any, star, globstar, globstarSlash
        case members(Set<UInt8>, negative: Bool)
    }
    private let rules: [Rule]
    public init(_ text: String? = nil) throws {
        let text = text.flatMap { $0.isEmpty ? nil : $0 }
        guard let text else { self.text = nil; rules = []; return }
        let bytes = Array(text.utf8)
        guard !bytes.contains(0) else { throw MobileFolderStore.Failure.invalid }
        self.text = text
        var parsed: [Rule] = []
        for (lineIndex, raw) in bytes.split(separator: 10, omittingEmptySubsequences: false).enumerated() {
            var line = Array(raw)
            if line.last == 13 { line.removeLast() }
            if lineIndex == 0, line.starts(with: [239, 187, 191]) { line.removeFirst(3) }
            // Only unescaped trailing spaces are discarded. The escape itself
            // remains for the wildcard compiler to consume.
            while line.last == 32 {
                var i = line.count - 2, escapes = 0
                while i >= 0 && line[i] == 92 { escapes += 1; i -= 1 }
                if escapes % 2 == 1 { break }
                line.removeLast()
            }
            guard !line.isEmpty, line[0] != 35 else { continue }
            let negative = line[0] == 33
            if negative { line.removeFirst() }
            guard !line.isEmpty else { continue }
            let directory = line.last == 47
            if directory { line.removeLast() }
            let anchored = line.first == 47
            if anchored { line.removeFirst() }
            guard !line.isEmpty, let tokens = Self.compile(line) else { continue }
            parsed.append(Rule(tokens: tokens, basename: !anchored && !line.contains(47), directory: directory, negative: negative))
        }
        rules = parsed
    }

    /// Swift String equality folds canonically equivalent Unicode. Policy
    /// identity must instead bind the actual bytes used by Git-style matching.
    public static func sameText(_ a: String?, _ b: String?) -> Bool {
        switch (a, b) {
        case (nil, nil): return true
        case let (a?, b?): return a.utf8.elementsEqual(b.utf8)
        default: return false
        }
    }

    /// Parent exclusion wins before any descendant negation can run. Traversal
    /// also enforces this by never entering an ignored directory.
    public func ignores(_ path: String, isDirectory: Bool) -> Bool {
        let bytes = Array(path.utf8)
        guard !bytes.isEmpty else { return false }
        for i in bytes.indices where bytes[i] == 47 {
            if ignored(Array(bytes[..<i]), directory: true) { return true }
        }
        return ignored(bytes, directory: isDirectory)
    }
    func ignoresEntry(_ path: String, isDirectory: Bool) -> Bool { ignored(Array(path.utf8), directory: isDirectory) }
    private func ignored(_ path: [UInt8], directory: Bool) -> Bool {
        var ignored = false
        let basename = Array(path[(path.lastIndex(of: 47).map { $0 + 1 } ?? 0)...])
        for rule in rules where !rule.directory || directory {
            if Self.matches(rule.tokens, rule.basename ? basename : path) { ignored = !rule.negative }
        }
        return ignored
    }
    private static func compile(_ pattern: [UInt8]) -> [Token]? {
        var result: [Token] = [], i = 0
        while i < pattern.count {
            let byte = pattern[i]
            switch byte {
            case 92:
                i += 1; guard i < pattern.count else { return nil }
                result.append(.literal(pattern[i])); i += 1
            case 63: result.append(.any); i += 1
            case 42:
                let start = i
                while i < pattern.count && pattern[i] == 42 { i += 1 }
                let beforeSlash = start == 0 || pattern[start - 1] == 47
                let afterSlash = i < pattern.count && (pattern[i] == 47 || (pattern[i] == 92 && i + 1 < pattern.count && pattern[i + 1] == 47))
                if i - start >= 2 && beforeSlash && (i == pattern.count || afterSlash) {
                    if afterSlash && pattern[i] == 47 {
                        i += 1; result.append(.globstarSlash)
                    } else {
                        // Git lets ** cross slashes before an escaped slash,
                        // but that separator remains mandatory; it cannot
                        // stand for an omitted intermediate directory.
                        result.append(.globstar)
                    }
                } else { result.append(.star) }
            case 91:
                guard let value = bracket(pattern, start: i) else { return nil }
                result.append(.members(value.members, negative: value.negative)); i = value.end
            default: result.append(.literal(byte)); i += 1
            }
        }
        return result
    }
    private static func bracket(_ pattern: [UInt8], start: Int) -> (members: Set<UInt8>, negative: Bool, end: Int)? {
        var i = start + 1, members = Set<UInt8>(), previous: UInt8?
        guard i < pattern.count else { return nil }
        let negative = pattern[i] == 33 || pattern[i] == 94
        if negative { i += 1 }
        var first = true
        while i < pattern.count {
            if pattern[i] == 93 && !first { return (members, negative, i + 1) }
            first = false
            if pattern[i] == 91 && i + 1 < pattern.count && pattern[i + 1] == 58,
               let close = (i + 2..<pattern.count).first(where: { pattern[$0] == 58 && $0 + 1 < pattern.count && pattern[$0 + 1] == 93 }) {
                let name = String(decoding: pattern[(i + 2)..<close], as: UTF8.self)
                guard let values = asciiClass(name) else { return nil }
                members.formUnion(values); previous = nil; i = close + 2; continue
            }
            var value = pattern[i]; let escaped = value == 92; i += 1
            if escaped { guard i < pattern.count else { return nil }; value = pattern[i]; i += 1 }
            if !escaped, value == 45, let from = previous, i < pattern.count, pattern[i] != 93 {
                var to = pattern[i]; i += 1
                if to == 92 { guard i < pattern.count else { return nil }; to = pattern[i]; i += 1 }
                if from <= to { members.formUnion(from...to) }; previous = nil
            } else { members.insert(value); previous = value }
        }
        return nil
    }
    private static func asciiClass(_ name: String) -> Set<UInt8>? {
        let alpha: (UInt8) -> Bool = { (65...90).contains($0) || (97...122).contains($0) }
        let digit: (UInt8) -> Bool = { (48...57).contains($0) }
        let predicate: (UInt8) -> Bool
        switch name {
        case "alnum": predicate = { alpha($0) || digit($0) }
        case "alpha": predicate = alpha
        case "blank": predicate = { $0 == 9 || $0 == 32 }
        case "cntrl": predicate = { $0 < 32 || $0 == 127 }
        case "digit": predicate = digit
        case "graph": predicate = { (33...126).contains($0) }
        case "lower": predicate = { (97...122).contains($0) }
        case "print": predicate = { (32...126).contains($0) }
        case "punct": predicate = { (33...126).contains($0) && !alpha($0) && !digit($0) }
        case "space": predicate = { (9...13).contains($0) || $0 == 32 }
        case "upper": predicate = { (65...90).contains($0) }
        case "xdigit": predicate = { digit($0) || (65...70).contains($0) || (97...102).contains($0) }
        default: return nil
        }
        return Set((UInt8(0)...127).filter(predicate))
    }
    /// Dynamic programming uses O(path bytes) memory and no recursive wildcard
    /// backtracking, even for adversarial lists of overlapping stars.
    private static func matches(_ tokens: [Token], _ path: [UInt8]) -> Bool {
        var reachable = [Bool](repeating: false, count: path.count + 1); reachable[0] = true
        for token in tokens {
            var next = [Bool](repeating: false, count: path.count + 1)
            switch token {
            case .star:
                var active = false
                for p in 0...path.count {
                    active = active || reachable[p]; next[p] = active
                    if p < path.count && path[p] == 47 { active = false }
                }
            case .globstar:
                if let start = reachable.firstIndex(of: true) { for p in start...path.count { next[p] = true } }
            case .globstarSlash:
                next = reachable
                if let start = reachable.firstIndex(of: true), start < path.count {
                    for p in start..<path.count where path[p] == 47 { next[p + 1] = true }
                }
            default:
                for p in path.indices where reachable[p] {
                    switch token {
                    case .literal(let byte): next[p + 1] = path[p] == byte
                    case .any: next[p + 1] = path[p] != 47
                    case .members(let values, let negative): next[p + 1] = path[p] != 47 && values.contains(path[p]) != negative
                    default: break
                    }
                }
            }
            reachable = next
            if !reachable.contains(true) { return false }
        }
        return reachable[path.count]
    }
}
