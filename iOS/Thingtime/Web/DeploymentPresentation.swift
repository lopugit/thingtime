import SwiftUI

enum DeploymentPresentation {
    static func title(for deployment: ThingtimeWebDestination.DeploymentSummary) -> String {
        let state = stateTitle(deployment.state)
        let commit = deployment.commitSha?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .prefix(7)

        guard let commit, !commit.isEmpty else {
            return state
        }

        return "\(state) · \(commit)"
    }

    static func subtitle(
        for deployment: ThingtimeWebDestination.DeploymentSummary,
        destination: ThingtimeWebDestination.Destination
    ) -> String {
        [deployment.readyLabel, destination.url.host]
            .compactMap(nonEmpty)
            .joined(separator: " - ")
    }

    static func stateTitle(_ state: String) -> String {
        state.replacingOccurrences(of: "_", with: " ").capitalized
    }

    static func statusIcon(for state: String) -> String {
        switch state.lowercased() {
        case "ready":
            return "checkmark.circle.fill"
        case "building", "initializing", "queued":
            return "clock.fill"
        case "blocked", "canceled", "error":
            return "exclamationmark.triangle.fill"
        default:
            return "circle.dotted"
        }
    }

    static func statusColor(for state: String) -> Color {
        switch state.lowercased() {
        case "ready":
            return .green
        case "building", "initializing", "queued":
            return .orange
        case "blocked", "canceled", "error":
            return .red
        default:
            return .secondary
        }
    }

    static func nonEmpty(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)

        guard let trimmed, !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }
}
