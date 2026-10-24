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

    @Environment(\.scenePhase) private var scenePhase
    @State private var widgetPath: String?
    @State private var widgetSettingsOpen = false
    @State private var deploymentGroups: [ThingtimeWebDestination.DeploymentGroup] = []
    @State private var isDestinationPickerOpen = false
    @State private var deploymentsLoadState = DeploymentsLoadState.idle
    @State private var destinationRequestID = UUID()
    @State private var loadedDestination: ThingtimeWebDestination.Destination?
    @State private var pendingDestination: ThingtimeWebDestination.Destination?
    @State private var failedDestination: ThingtimeWebDestination.Destination?

    private static let destinationSwitchError = "Could not switch destinations. Unlock this device, then retry. Your current destination is still open."

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

    private var pickerStaticDestinations: [ThingtimeWebDestination.Destination] {
        guard let loadedDestination, !destinations.contains(where: { $0.id == loadedDestination.id }) else {
            return staticDestinations
        }
        return staticDestinations + [loadedDestination]
    }

    private var selectedDestination: ThingtimeWebDestination.Destination {
        pendingDestination
            ?? destinations.first(where: { $0.id == selectedDestinationID })
            ?? (loadedDestination?.id == selectedDestinationID ? loadedDestination : nil)
            ?? destinations.first(where: { $0.id == ThingtimeWebDestination.defaultDestinationID })
            ?? ThingtimeWebDestination.production
    }

    var body: some View {
        GeometryReader { proxy in
            let drawerWidth = min(proxy.size.width - 48, 360)

            ZStack(alignment: .leading) {
                WebView(
                    url: selectedDestination.url,
                    widgetPath: $widgetPath,
                    destinationRequestID: destinationRequestID,
                    onDestinationResult: destinationResult
                )
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
                    staticDestinations: pickerStaticDestinations,
                    selectedDestinationID: selectedDestination.id,
                    deploymentsLoadState: deploymentsLoadState,
                    safeAreaInsets: proxy.safeAreaInsets,
                    onSelect: select,
                    onRefreshDeployments: refreshDeployments,
                    onClose: closeDestinationPicker,
                    onWidgetSettings: { closeDestinationPicker(); widgetSettingsOpen = true },
                    onMail: { closeDestinationPicker(); widgetPath = "/mail" },
                    destinationSwitchError: failedDestination == nil ? nil : Self.destinationSwitchError,
                    onRetryDestination: retryDestination
                )
                .accessibilityHidden(!isDestinationPickerOpen)
                .frame(width: max(drawerWidth, 280))
                .frame(maxHeight: .infinity)
                .offset(x: isDestinationPickerOpen ? 0 : -max(drawerWidth, 280))
                .simultaneousGesture(closeDrawerGesture)
                .ignoresSafeArea(.container, edges: [.top, .bottom, .leading])
            }
            .background(Color.white.ignoresSafeArea())
            .simultaneousGesture(openDrawerGesture(leadingEdgeWidth: 28))
            .animation(.easeOut(duration: 0.22), value: isDestinationPickerOpen)
            .sheet(isPresented: $widgetSettingsOpen) {
                NavigationStack {
                    WidgetPreferences().toolbar {
                        ToolbarItem(placement: .confirmationAction) { Button("Done") { widgetSettingsOpen = false } }
                    }
                }
            }
            .onOpenURL { url in widgetPath = WidgetRoute.path(for: url) }
            .onReceive(NotificationCenter.default.publisher(for: .thingtimeWidgetAction)) { _ in receiveWidgetAction() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { receiveWidgetAction() } }
            .onAppear { prepareDestinationState(); receiveWidgetAction() }
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

    private func receiveWidgetAction() {
        if let url = WidgetActionInbox.take() { widgetPath = WidgetRoute.path(for: url) }
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
        if startupSelection.selectedDestinationID != selectedDestinationID {
            pendingDestination = staticDestinations.first(where: { $0.id == startupSelection.selectedDestinationID })
        }
        lastConfiguredDestinationID = startupSelection.lastConfiguredDestinationID
        ensureSelectedDestinationIsAvailable()
    }

    private func ensureSelectedDestinationIsAvailable() {
        let resolvedDestination = selectedDestination

        guard selectedDestinationID != resolvedDestination.id else {
            return
        }

        // Keep persisted selection tied to the accepted native root. A fallback
        // caused by a refreshed deployment list goes through the same clear gate.
        if pendingDestination == nil { pendingDestination = resolvedDestination }
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
        destinationRequestID = UUID()
        failedDestination = nil
        pendingDestination = loadedDestination?.url == destination.url ? nil : destination
        if pendingDestination == nil { selectedDestinationID = destination.id }
        hasExplicitDestinationSelection = true
        closeDestinationPicker()
    }

    private func retryDestination() {
        guard let destination = failedDestination else { return }
        select(destination)
    }

    private func destinationResult(_ attemptedURL: URL, _ requestID: UUID, _ activeURL: URL, _ succeeded: Bool) {
        // A delayed result from an older selection must never roll back a newer one.
        guard destinationRequestID == requestID, selectedDestination.url == attemptedURL else { return }
        let attemptedDestination = selectedDestination
        let activeDestination = (attemptedDestination.url == activeURL ? attemptedDestination : nil)
            ?? destinations.first(where: { $0.url == activeURL })
            ?? (loadedDestination?.url == activeURL ? loadedDestination : nil)
            ?? ThingtimeWebDestination.Destination(
                id: activeURL.absoluteString, title: activeURL.host ?? "Current destination",
                subtitle: activeURL.absoluteString, url: activeURL, source: .vercelDeployment
            )
        loadedDestination = activeDestination
        selectedDestinationID = activeDestination.id
        pendingDestination = nil
        guard !succeeded else { return }
        failedDestination = attemptedDestination
        // The drawer reopens with the actual active selection and an explicit retry.
        withAnimation(.easeOut(duration: 0.22)) { isDestinationPickerOpen = true }
        UIAccessibility.post(notification: .announcement, argument: Self.destinationSwitchError)
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
