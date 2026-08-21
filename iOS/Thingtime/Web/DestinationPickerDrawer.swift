import SwiftUI

struct DestinationPickerDrawer: View {
    let deploymentSections: [ThingtimeWebDestination.DeploymentSection]
    let staticDestinations: [ThingtimeWebDestination.Destination]
    let selectedDestinationID: String
    let deploymentsLoadState: ThingtimeWebView.DeploymentsLoadState
    let safeAreaInsets: EdgeInsets
    let onSelect: (ThingtimeWebDestination.Destination) -> Void
    let onRefreshDeployments: () async -> Void
    let onClose: () -> Void

    @State private var expandedDeploymentSectionIDs: Set<String>

    init(
        deploymentSections: [ThingtimeWebDestination.DeploymentSection],
        staticDestinations: [ThingtimeWebDestination.Destination],
        selectedDestinationID: String,
        deploymentsLoadState: ThingtimeWebView.DeploymentsLoadState,
        safeAreaInsets: EdgeInsets,
        onSelect: @escaping (ThingtimeWebDestination.Destination) -> Void,
        onRefreshDeployments: @escaping () async -> Void,
        onClose: @escaping () -> Void
    ) {
        self.deploymentSections = deploymentSections
        self.staticDestinations = staticDestinations
        self.selectedDestinationID = selectedDestinationID
        self.deploymentsLoadState = deploymentsLoadState
        self.safeAreaInsets = safeAreaInsets
        self.onSelect = onSelect
        self.onRefreshDeployments = onRefreshDeployments
        self.onClose = onClose

        let selectedSectionID = deploymentSections.first(where: { section in
            section.deployments.contains(where: { $0.id == selectedDestinationID })
        })?.id
        _expandedDeploymentSectionIDs = State(
            initialValue: Set(selectedSectionID.map { [$0] } ?? [])
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DestinationPickerHeader(
                isRefreshing: deploymentsLoadState == .loading,
                onRefresh: refreshDeployments,
                onClose: onClose
            )

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(staticDestinations) { destination in
                        DestinationRow(
                            destination: destination,
                            isSelected: destination.id == selectedDestinationID,
                            onSelect: onSelect
                        )
                    }

                    if !deploymentSections.isEmpty {
                        Text("Branches & PRs")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .textCase(.uppercase)
                            .tracking(1.2)
                            .padding(.top, 10)
                            .padding(.horizontal, 10)
                            .accessibilityAddTraits(.isHeader)

                        ForEach(deploymentSections) { section in
                            DeploymentSectionDisclosure(
                                section: section,
                                selectedDestinationID: selectedDestinationID,
                                isExpanded: expansionBinding(for: section.id),
                                onSelect: onSelect
                            )
                        }
                    }
                }
                .padding(.horizontal, 16)

                Divider()
                    .padding(.horizontal, 16)
                    .padding(.vertical, 18)

                DeploymentLoadStatus(
                    deploymentSections: deploymentSections,
                    loadState: deploymentsLoadState
                )
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.bottom, 20)
            }
            .scrollIndicators(.visible)
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityIdentifier("destination-picker-scroll-view")
        }
        .padding(.top, safeAreaInsets.top + 18)
        .padding(.bottom, safeAreaInsets.bottom + 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.regularMaterial)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(.primary.opacity(0.08))
                .frame(width: 1)
        }
        .onChange(of: selectedDestinationID) { _, selectedID in
            expandSelectedDeploymentSection(selectedID)
        }
        .onChange(of: deploymentSections) { _, _ in
            expandSelectedDeploymentSection(selectedDestinationID)
        }
    }

    private func refreshDeployments() {
        Task {
            await onRefreshDeployments()
        }
    }

    private func expandSelectedDeploymentSection(_ selectedID: String) {
        guard let selectedSectionID = deploymentSections.first(where: { section in
            section.deployments.contains(where: { $0.id == selectedID })
        })?.id else {
            return
        }

        expandedDeploymentSectionIDs.insert(selectedSectionID)
    }

    private func expansionBinding(for sectionID: String) -> Binding<Bool> {
        Binding(
            get: { expandedDeploymentSectionIDs.contains(sectionID) },
            set: { isExpanded in
                withAnimation(.easeOut(duration: 0.18)) {
                    if isExpanded {
                        expandedDeploymentSectionIDs.insert(sectionID)
                    } else {
                        expandedDeploymentSectionIDs.remove(sectionID)
                    }
                }
            }
        )
    }
}

private struct DestinationPickerHeader: View {
    let isRefreshing: Bool
    let onRefresh: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            Text("Web destination")
                .font(.headline)

            Spacer()

            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isRefreshing)
            .accessibilityLabel("Refresh Vercel deployments")

            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close destination picker")
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 18)
    }
}

private struct DeploymentLoadStatus: View {
    let deploymentSections: [ThingtimeWebDestination.DeploymentSection]
    let loadState: ThingtimeWebView.DeploymentsLoadState

    @ViewBuilder
    var body: some View {
        switch loadState {
        case .idle:
            EmptyView()
        case .loading:
            Label("Loading deployments", systemImage: "arrow.triangle.2.circlepath")
                .font(.caption)
                .foregroundStyle(.secondary)
        case .loaded:
            if deploymentSections.isEmpty {
                Label("No Vercel deployments", systemImage: "tray")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle")
                .font(.caption)
                .foregroundStyle(.red)
        }
    }
}

#Preview("Destination deployment history") {
    let group = ThingtimeWebDestination.DeploymentGroup(
        branch: "codex/ios-drawer-camera-crash",
        deployments: [
            ThingtimeWebDestination.DeploymentSummary(
                branch: "codex/ios-drawer-camera-crash",
                commitSha: "queued123456789",
                createdAt: "2026-08-18T03:00:00.000Z",
                dashboardUrl: nil,
                environment: "preview",
                id: "dpl_queued",
                readyAt: nil,
                readyLabel: "just now",
                state: "queued",
                url: "https://thingtime-queued-lopugits-projects.vercel.app"
            ),
            ThingtimeWebDestination.DeploymentSummary(
                branch: "codex/ios-drawer-camera-crash",
                commitSha: "ready123456789",
                createdAt: "2026-08-18T02:00:00.000Z",
                dashboardUrl: nil,
                environment: "preview",
                id: "dpl_ready",
                readyAt: "2026-08-18T02:02:00.000Z",
                readyLabel: "1h",
                state: "ready",
                url: "https://thingtime-ready-lopugits-projects.vercel.app"
            ),
        ],
        id: "codex/ios-drawer-camera-crash"
    )
    let sections = ThingtimeWebDestination.deploymentSections(from: [group])

    DestinationPickerDrawer(
        deploymentSections: sections,
        staticDestinations: [ThingtimeWebDestination.production],
        selectedDestinationID: sections.first?.deployments.last?.id ?? ThingtimeWebDestination.production.id,
        deploymentsLoadState: .loaded,
        safeAreaInsets: EdgeInsets(top: 48, leading: 0, bottom: 24, trailing: 0),
        onSelect: { _ in },
        onRefreshDeployments: {},
        onClose: {}
    )
    .frame(width: 360, height: 800)
}
