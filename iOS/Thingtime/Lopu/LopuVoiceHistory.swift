import Foundation

enum LopuVoiceHistory {
    static func bounded(_ input: [[String: String]]) -> [[String: String]] {
        var remaining = 24000
        var result: [[String: String]] = []
        for item in input.reversed() {
            guard let role = item["role"], ["user", "assistant"].contains(role), let raw = item["text"] else { continue }
            let text = String(String.UnicodeScalarView(raw.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.suffix(min(12000, remaining))))
            guard !text.isEmpty else { continue }
            result.insert(["role": role, "text": text], at: 0)
            remaining -= text.unicodeScalars.count
            if remaining == 0 || result.count == 20 { break }
        }
        return result
    }

    static func events(_ input: [[String: String]]) -> [[String: Any]] {
        bounded(input).map { item in
            ["type": "conversation.item.create", "item": ["type": "message", "role": item["role"]!,
                "content": [["type": item["role"] == "assistant" ? "output_text" : "input_text", "text": item["text"]!]]]]
        }
    }
}
