import SwiftUI
import UIKit

struct ThingtimeWebView: View {
    private enum StorageKey {
        static let selectedDestinationID = "thingtime.webDestination.selectedID"
        static let lastConfiguredDestinationID = "thingtime.webDestination.lastConfiguredID"
        static let hasExplicitDestinationSelection = "thingtime.webDestination.hasExplicitSelection"
    }

    enum DeploymentsLoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    private let deploymentsClient = ThingtimeWebDeploymentsClient()

    @AppStorage(StorageKey.selectedDestinationID) private var selectedDestinationID = ThingtimeWebDestination.defaultDestinationID
    @AppStorage(StorageKey.lastConfiguredDestinationID) private var lastConfiguredDestinationID = ""
    @AppStorage(StorageKey.hasExplicitDestinationSelection) private var hasExplicitDestinationSelection = false

    @State private var deploymentGroups: [ThingtimeWebDestination.DeploymentGroup] = []
    @State private var isDestinationPickerOpen = false
    @State private var deploymentsLoadState = DeploymentsLoadState.idle

    private var staticDestinations: [ThingtimeWebDestination.Destination] {
        ThingtimeWebDestination.availableDestinations()
    }

    private var deploymentSections: [ThingtimeWebDestination.DeploymentSection] {
        ThingtimeWebDestination.deploymentSections(
            from: deploymentGroups,
            excludingDestinationIDs: Set(staticDestinations.map(\.id))
        )
    }

    private var destinations: [ThingtimeWebDestination.Destination] {
        staticDestinations + deploymentSections.flatMap { section in
            section.deployments.map(\.destination)
        }
    }

    private var selectedDestination: ThingtimeWebDestination.Destination {
        destinations.first(where: { $0.id == selectedDestinationID })
            ?? destinations.first(where: { $0.id == ThingtimeWebDestination.defaultDestinationID })
            ?? ThingtimeWebDestination.production
    }

    var body: some View {
        GeometryReader { proxy in
            let drawerWidth = min(proxy.size.width - 48, 360)

            ZStack(alignment: .leading) {
                WebView(url: selectedDestination.url)
                    .ignoresSafeArea(.container, edges: [.bottom])

                if isDestinationPickerOpen {
                    Color.black.opacity(0.2)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture(perform: closeDestinationPicker)
                        .transition(.opacity)
                }

                DestinationPickerDrawer(
                    deploymentSections: deploymentSections,
                    staticDestinations: staticDestinations,
                    selectedDestinationID: selectedDestination.id,
                    deploymentsLoadState: deploymentsLoadState,
                    safeAreaInsets: proxy.safeAreaInsets,
                    onSelect: select,
                    onRefreshDeployments: refreshDeployments,
                    onClose: closeDestinationPicker
                )
                .frame(width: max(drawerWidth, 280))
                .frame(maxHeight: .infinity)
                .offset(x: isDestinationPickerOpen ? 0 : -max(drawerWidth, 280))
                .simultaneousGesture(closeDrawerGesture)
                .ignoresSafeArea(.container, edges: [.top, .bottom, .leading])
            }
            .background(Color.white.ignoresSafeArea())
            .simultaneousGesture(openDrawerGesture(leadingEdgeWidth: 28))
            .animation(.easeOut(duration: 0.22), value: isDestinationPickerOpen)
            .onAppear(perform: prepareDestinationState)
            .task {
                await refreshDeploymentsIfNeeded()
            }
            .onChange(of: selectedDestinationID) { _, _ in
                ensureSelectedDestinationIsAvailable()
            }
            .onChange(of: deploymentGroups) { _, _ in
                ensureSelectedDestinationIsAvailable()
            }
        }
    }

    private func openDrawerGesture(leadingEdgeWidth: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 18)
            .onEnded { value in
                guard !isDestinationPickerOpen else { return }
                guard value.startLocation.x <= leadingEdgeWidth else { return }
                guard value.translation.width > 56 else { return }
                openDestinationPicker()
            }
    }

    private var closeDrawerGesture: some Gesture {
        DragGesture(minimumDistance: 18)
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                guard value.translation.width < -56 else { return }
                closeDestinationPicker()
            }
    }

    private func prepareDestinationState() {
        let startupSelection = ThingtimeWebDestination.startupSelection(
            selectedDestinationID: selectedDestinationID,
            lastConfiguredDestinationID: lastConfiguredDestinationID,
            hasExplicitSelection: hasExplicitDestinationSelection,
            destinations: staticDestinations
        )
        selectedDestinationID = startupSelection.selectedDestinationID
        lastConfiguredDestinationID = startupSelection.lastConfiguredDestinationID
        ensureSelectedDestinationIsAvailable()
    }

    private func ensureSelectedDestinationIsAvailable() {
        let resolvedDestination = selectedDestination

        guard selectedDestinationID != resolvedDestination.id else {
            return
        }

        selectedDestinationID = resolvedDestination.id
    }

    private func openDestinationPicker() {
        withAnimation(.easeOut(duration: 0.22)) {
            isDestinationPickerOpen = true
        }

        Task {
            await refreshDeploymentsIfNeeded()
        }
    }

    private func closeDestinationPicker() {
        withAnimation(.easeOut(duration: 0.22)) {
            isDestinationPickerOpen = false
        }
    }

    private func select(_ destination: ThingtimeWebDestination.Destination) {
        selectedDestinationID = destination.id
        hasExplicitDestinationSelection = true
        closeDestinationPicker()
    }

    @MainActor
    private func refreshDeploymentsIfNeeded() async {
        guard deploymentsLoadState == .idle else {
            return
        }

        await refreshDeployments()
    }

    @MainActor
    private func refreshDeployments() async {
        deploymentsLoadState = .loading

        do {
            let overview = try await deploymentsClient.fetchDeployments()
            deploymentGroups = overview.resolvedDeploymentGroups
            deploymentsLoadState = .loaded
        } catch {
            deploymentsLoadState = .failed("Could not load Vercel deployments.")
        }
    }
}

#Preview {
    ThingtimeWebView()
}
