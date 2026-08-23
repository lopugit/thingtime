import SwiftUI
import UIKit

struct DestinationRow: View {
    let destination: ThingtimeWebDestination.Destination
    let isSelected: Bool
    let onSelect: (ThingtimeWebDestination.Destination) -> Void

    var body: some View {
        Button(action: select) {
            HStack(spacing: 12) {
                Image(systemName: iconName)
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(destination.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)

                    Text(destination.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityLabel("Selected")
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Color.primary.opacity(0.1) : Color.primary.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(destination.title), \(destination.subtitle)")
        .accessibilityHint("Touch and hold for URL actions")
        .contextMenu {
            DestinationContextMenu(destination: destination)
        }
    }

    private var iconName: String {
        switch destination.source {
        case .production:
            return "globe"
        case .configured:
            return "shippingbox"
        case .vercelDeployment:
            return "paperplane"
        }
    }

    private func select() {
        onSelect(destination)
    }
}

struct DeploymentSectionDisclosure: View {
    let section: ThingtimeWebDestination.DeploymentSection
    let selectedDestinationID: String
    @Binding var isExpanded: Bool
    let onSelect: (ThingtimeWebDestination.Destination) -> Void

    private var containsSelection: Bool {
        section.deployments.contains(where: { $0.id == selectedDestinationID })
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(section.deployments) { option in
                    DeploymentOptionRow(
                        option: option,
                        branchTitle: section.title,
                        successfulLabel: successfulLabel(for: option),
                        isSelected: option.id == selectedDestinationID,
                        onSelect: onSelect
                    )
                }
            }
            .padding(.top, 8)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "paperplane")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(width: 28, height: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(section.title)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)

                    Text(sectionSubtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 8)

                if containsSelection {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityLabel("Contains selected deployment")
                }
            }
            .contentShape(Rectangle())
        }
        .tint(.primary)
        .padding(.vertical, 10)
        .padding(.horizontal, 10)
        .background(containsSelection ? Color.primary.opacity(0.1) : Color.primary.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityLabel("\(section.title), \(section.deployments.count) deployments")
        .accessibilityHint("Expands deployment history")
        .accessibilityIdentifier("destination-branch-\(section.id)")
    }

    private var sectionSubtitle: String {
        let latest = section.latestDeployment?.deployment
        let countLabel = "\(section.deployments.count) deployment\(section.deployments.count == 1 ? "" : "s")"

        return [latest.map { DeploymentPresentation.stateTitle($0.state) }, latest?.readyLabel, countLabel]
            .compactMap(DeploymentPresentation.nonEmpty)
            .joined(separator: " - ")
    }

    private func successfulLabel(for option: ThingtimeWebDestination.DeploymentOption) -> String? {
        guard option.id == section.latestSuccessfulDeploymentID else {
            return nil
        }

        return option.id == section.latestDeployment?.id ? "Latest successful" : "Last successful"
    }
}

private struct DeploymentOptionRow: View {
    let option: ThingtimeWebDestination.DeploymentOption
    let branchTitle: String
    let successfulLabel: String?
    let isSelected: Bool
    let onSelect: (ThingtimeWebDestination.Destination) -> Void

    private var deployment: ThingtimeWebDestination.DeploymentSummary {
        option.deployment
    }

    private var destination: ThingtimeWebDestination.Destination {
        option.destination
    }

    var body: some View {
        Button(action: select) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: DeploymentPresentation.statusIcon(for: deployment.state))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(DeploymentPresentation.statusColor(for: deployment.state))
                    .frame(width: 24, height: 24)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(DeploymentPresentation.title(for: deployment))
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)

                        if let successfulLabel {
                            Text(successfulLabel)
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.green)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.green.opacity(0.12))
                                .clipShape(Capsule())
                                .fixedSize()
                        }
                    }

                    Text(DeploymentPresentation.subtitle(for: deployment, destination: destination))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 6)

                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityLabel("Selected")
                }
            }
            .padding(.vertical, 9)
            .padding(.horizontal, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? Color.primary.opacity(0.12) : Color.primary.opacity(0.035))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .padding(.leading, 16)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint("Selects this deployment. Touch and hold for URL actions")
        .accessibilityIdentifier("destination-deployment-\(deployment.id ?? destination.id)")
        .contextMenu {
            DestinationContextMenu(destination: destination)
        }
    }

    private var accessibilityLabel: String {
        [
            branchTitle,
            DeploymentPresentation.title(for: deployment),
            successfulLabel,
            deployment.readyLabel,
        ]
        .compactMap(DeploymentPresentation.nonEmpty)
        .joined(separator: ", ")
    }

    private func select() {
        onSelect(destination)
    }
}

private struct DestinationContextMenu: View {
    @Environment(\.openURL) private var openURL

    let destination: ThingtimeWebDestination.Destination

    var body: some View {
        Group {
            Button(action: copyURL) {
                Label("Copy URL", systemImage: "doc.on.doc")
            }

            Button(action: openInBrowser) {
                Label("Open in Browser", systemImage: "safari")
            }

            ShareLink(item: destination.url) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
        }
    }

    private func copyURL() {
        UIPasteboard.general.string = destination.url.absoluteString
    }

    private func openInBrowser() {
        openURL(destination.url)
    }
}
