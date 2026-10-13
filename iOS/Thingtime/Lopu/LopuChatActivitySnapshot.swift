import Foundation

struct LopuChatActivitySnapshot: Equatable {
    struct Chat: Equatable {
        let chatId: String
        let status: String
        let management: String
    }
    let contextKey: String
    let ownerId: String?
    let chats: [Chat]

    init?(payload: [String: Any]) {
        guard let rows = payload["chats"] as? [[String: Any]], rows.count <= 100 else { return nil }
        let owner = payload["ownerId"] as? String
        guard owner == nil || Self.validIdentifier(owner!), owner != nil || rows.isEmpty else { return nil }
        var chats: [Chat] = []
        var seen = Set<String>()
        for row in rows {
            guard let id = row["chatId"] as? String, Self.validIdentifier(id),
                  let status = row["status"] as? String, ["running", "retrying"].contains(status),
                  let management = row["management"] as? String, ["server", "client"].contains(management) else { return nil }
            if seen.insert(id).inserted { chats.append(Chat(chatId: id, status: status, management: management)) }
        }
        let context = payload["contextKey"] as? String ?? "unresolved"
        guard Self.validIdentifier(context) else { return nil }
        self.contextKey = context
        self.ownerId = owner
        self.chats = chats.sorted { $0.chatId < $1.chatId }
    }

    var content: LopuChatActivityAttributes.ContentState {
        .init(activeCount: chats.count, serverCount: chats.filter { $0.management == "server" }.count,
              phase: chats.isEmpty ? "finished" : chats.allSatisfy { $0.status == "retrying" } ? "retrying" : "running")
    }

    private static func validIdentifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 200 && !value.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
}
