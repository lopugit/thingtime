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
    @State private var authenticatorSetup: AuthenticatorSetupDelivery?
    @State private var widgetPath: String?
    @State private var lidarRequest: UUID?
    @State private var invalidScanLink = false
    @State private var pendingShare: UUID?
    @State private var sharedDrafts: [UUID] = []
    @State private var sharedDraftsOpen = false
    @State private var sharedDraftsLoadFailed = false
    @State private var shareReminderError: String?
    @State private var widgetSettingsOpen = false
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
                VStack(spacing: 0) {
                    if let pendingShare {
                        HStack(spacing: 8) {
                            Button {
                                openSharedDraft(pendingShare)
                            } label: {
                                Label("Continue shared draft", systemImage: "square.and.pencil")
                                    .font(.body)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                            }
                            .accessibilityIdentifier("continue-shared-draft")
                            .accessibilityHint("Opens your unfinished share in the post composer")

                            Button {
                                dismissSharedDraftReminder(pendingShare)
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.body.weight(.semibold))
                                    .frame(width: 44, height: 44)
                                    .contentShape(Rectangle())
                            }
                            .accessibilityLabel("Dismiss shared draft reminder")
                            .accessibilityHint("Keeps the draft in Shared drafts in the native drawer")
                            .accessibilityIdentifier("dismiss-shared-draft-reminder")
                        }
                        .padding(.horizontal, 8)
                        .background(.regularMaterial)
                    }
                    WebView(url: selectedDestination.url, widgetPath: $widgetPath, authenticatorSetup: $authenticatorSetup, lidarRequest: $lidarRequest)
                        .ignoresSafeArea(.container, edges: [.bottom])
                }

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
                    onClose: closeDestinationPicker,
                    onWidgetSettings: { closeDestinationPicker(); widgetSettingsOpen = true },
                    onMail: { closeDestinationPicker(); widgetPath = "/mail" },
                    onScan: { closeDestinationPicker(); lidarRequest = UUID() },
                    onSharedDrafts: { closeDestinationPicker(); refreshPendingShare(); sharedDraftsOpen = true }
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
            .sheet(isPresented: $sharedDraftsOpen) {
                NavigationStack {
                    List {
                        if sharedDraftsLoadFailed {
                            Section {
                                Text("Could not load shared drafts. Your saved shares have not been removed.")
                                    .foregroundStyle(.secondary)
                                Button("Try again", action: refreshPendingShare)
                            }
                        }
                        Section {
                            ForEach(Array(sharedDrafts.enumerated()), id: \.element) { index, id in
                                Button {
                                    sharedDraftsOpen = false
                                    openSharedDraft(id)
                                } label: {
                                    Label("Shared draft \(index + 1)", systemImage: "square.and.pencil")
                                        .frame(minHeight: 44)
                                }
                                .accessibilityIdentifier("shared-draft-\(id.uuidString)")
                            }
                        } footer: {
                            Text(sharedDraftsLoadFailed ? "" : sharedDrafts.isEmpty
                                 ? "No unfinished shared drafts for this destination."
                                 : "Your unfinished shares, oldest first. Dismissing a reminder keeps its draft here.")
                        }
                    }
                    .navigationTitle("Shared drafts")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { sharedDraftsOpen = false }
                        }
                    }
                }
            }
            .alert("Could not dismiss reminder", isPresented: Binding(
                get: { shareReminderError != nil },
                set: { if !$0 { shareReminderError = nil } }
            )) {
                Button("OK", role: .cancel) { shareReminderError = nil }
            } message: {
                Text(shareReminderError ?? "Please try again. Your draft is still saved.")
            }
            .onOpenURL { url in
                if ["otpauth", "otpauth-migration"].contains(url.scheme?.lowercased() ?? "") {
                    authenticatorSetup = AuthenticatorSetupDelivery(url: url)
                } else if url.scheme == "thingtime", url.host == "scan" {
                    if LiDARLaunchRoute.accepts(url, selectedOrigin: selectedDestination.url) {
                        closeDestinationPicker(); lidarRequest = UUID()
                    } else { invalidScanLink = true }
                } else { widgetPath = WidgetRoute.path(for: url) }
            }
            .alert("Scanner destination does not match", isPresented: $invalidScanLink) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Select the same Thingtime destination in the native drawer, then open the scanner again.")
            }
            .onReceive(NotificationCenter.default.publisher(for: .thingtimeWidgetAction)) { _ in receiveWidgetAction() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { receiveWidgetAction(); refreshPendingShare() } }
            .onAppear { prepareDestinationState(); receiveWidgetAction(); refreshPendingShare() }
            .task {
                await refreshDeploymentsIfNeeded()
            }
            .onChange(of: selectedDestinationID) { _, _ in
                ensureSelectedDestinationIsAvailable()
                refreshPendingShare()
            }
            .onChange(of: deploymentGroups) { _, _ in
                ensureSelectedDestinationIsAvailable()
            }
        }
    }

    private func refreshPendingShare() {
        do {
            let inbox = try ShareInbox.shared()
            let drafts = try inbox.pendingComposers(origin: selectedDestination.url)
            let reminder = try inbox.pendingComposers(origin: selectedDestination.url, includeDismissed: false).first
            sharedDrafts = drafts
            pendingShare = reminder
            sharedDraftsLoadFailed = false
        } catch {
            sharedDrafts = []
            pendingShare = nil
            sharedDraftsLoadFailed = true
        }
    }

    private func openSharedDraft(_ id: UUID) {
        widgetPath = ShareComposerSession.composerURL(origin: selectedDestination.url, requestId: id)?.absoluteString
        pendingShare = nil
    }

    private func dismissSharedDraftReminder(_ id: UUID) {
        do {
            try ShareInbox.shared().dismissComposerReminder(id: id, origin: selectedDestination.url)
            refreshPendingShare()
        } catch {
            shareReminderError = "Your draft is still saved. Please try again."
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
