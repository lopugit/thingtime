import SwiftUI
import ThingtimeRecoveryCore

private enum RecoverySelection: Hashable {
    case desktopCache
    case recoveryCache
    case desktopRelease(String)
    case recoveryRelease(String)
}

struct RecoveryContentView: View {
    @ObservedObject var store: RecoveryStore
    @State private var selection: RecoverySelection? = .desktopCache

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("This Mac") {
                    Label("Cached Thingtime", systemImage: "desktopcomputer")
                        .tag(RecoverySelection.desktopCache)
                    Label("Cached Recovery", systemImage: "cross.case")
                        .tag(RecoverySelection.recoveryCache)
                }
                Section("Available releases") {
                    if let status = store.catalogStatus {
                        Text(status).font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(store.desktopReleases) { release in
                        Label(release.isUnsigned ? "UNSIGNED \(release.version ?? release.tag)" : release.version ?? release.tag, systemImage: release.isUnsigned ? "exclamationmark.triangle.fill" : "arrow.down.circle")
                            .foregroundStyle(release.isUnsigned ? .orange : .primary)
                            .tag(RecoverySelection.desktopRelease(release.id))
                    }
                    ForEach(store.recoveryReleases) { release in
                        Label(release.isUnsigned ? "UNSIGNED Recovery \(release.version ?? release.tag)" : "Recovery \(release.version ?? release.tag)", systemImage: release.isUnsigned ? "exclamationmark.triangle.fill" : "cross.case.fill")
                            .foregroundStyle(release.isUnsigned ? .orange : .primary)
                            .tag(RecoverySelection.recoveryRelease(release.id))
                    }
                }
            }
            .navigationTitle("Recovery")
        } detail: {
            detail
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await store.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .help("Refresh GitHub releases")
                .disabled(store.isRefreshing || store.isCaching)
            }
        }
        .alert("Thingtime Recovery", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
            Button("OK", role: .cancel) { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch selection {
        case .desktopCache:
            CacheListView(component: .desktop, bundles: store.desktopBundles, store: store)
        case .recoveryCache:
            CacheListView(component: .recovery, bundles: store.recoveryBundles, store: store)
        case .desktopRelease(let id):
            if let release = store.desktopReleases.first(where: { $0.id == id }) {
                ReleaseDetailView(component: .desktop, release: release, store: store)
            } else { EmptyStateView(title: "Release unavailable", systemImage: "exclamationmark.triangle") }
        case .recoveryRelease(let id):
            if let release = store.recoveryReleases.first(where: { $0.id == id }) {
                ReleaseDetailView(component: .recovery, release: release, store: store)
            } else { EmptyStateView(title: "Release unavailable", systemImage: "exclamationmark.triangle") }
        case nil:
            EmptyStateView(title: "Choose a cached bundle or release", systemImage: "arrow.triangle.2.circlepath")
        }
    }
}

private struct CacheListView: View {
    let component: RecoveryComponent
    let bundles: [CachedBundle]
    @ObservedObject var store: RecoveryStore

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(component == .desktop ? "Thingtime versions cached on this Mac" : "Recovery launchers cached on this Mac", systemImage: component == .desktop ? "desktopcomputer" : "cross.case")
                .font(.title2.weight(.semibold))
            Text(component == .desktop ? "Launch an older desktop version or install it as the current app. Installing saves the current verified desktop first." : "This standalone recovery app can replace itself without depending on any Electron version.")
                .foregroundStyle(.secondary)
            if bundles.isEmpty {
                EmptyStateView(title: "No cached bundles", systemImage: "externaldrive.badge.questionmark", message: "Cache a GitHub release first. Unsigned releases remain visibly marked and require acknowledgement.")
            } else {
                List(bundles) { bundle in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(bundle.displayName).fontWeight(.medium)
                            Text(bundle.entry.cachedAt ?? "Cached date unavailable").font(.caption).foregroundStyle(.secondary)
                            if bundle.entry.isUnsigned == true {
                                Text("UNSIGNED — manually approved, not verified by Apple")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.orange)
                            }
                        }
                        Spacer()
                        if component == .desktop {
                            Button("Launch") { store.launch(bundle) }
                        }
                        Button("Install") { store.install(bundle) }
                        Button(role: .destructive) { store.remove(bundle) } label: { Image(systemName: "trash") }
                            .help("Remove cached bundle")
                    }
                }
                .frame(minHeight: 250)
                .disabled(store.isCaching)
            }
            HStack {
                Button("Show in Finder") { store.reveal(component) }
                if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .padding(28)
    }
}

private struct EmptyStateView: View {
    let title: String
    let systemImage: String
    var message: String? = nil

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage).font(.system(size: 36)).foregroundStyle(.secondary)
            Text(title).font(.headline)
            if let message { Text(message).foregroundStyle(.secondary) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

private struct ReleaseDetailView: View {
    let component: RecoveryComponent
    let release: RecoveryRelease
    @ObservedObject var store: RecoveryStore
    @State private var showingUnsignedAcknowledgement = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label(component == .desktop ? "Thingtime Desktop release" : "Thingtime Recovery release", systemImage: component == .desktop ? "arrow.down.app" : "cross.case.fill")
                .font(.title2.weight(.semibold))
            Text(release.version ?? release.tag).font(.title3.monospaced())
            Text("\(release.asset.name)\(release.isPrerelease ? " · prerelease" : "")")
                .foregroundStyle(.secondary)
            if release.isUnsigned {
                Label("UNSIGNED — no Developer ID certificate or notarization", systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.headline)
                Text("You can cache, launch, or install this release after acknowledging that macOS may require Privacy & Security → Open Anyway before its first launch. It is never shown as a verified update.")
                    .foregroundStyle(.secondary)
            }
            if let published = release.publishedAt {
                Text(published, style: .date).font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Button(release.isUnsigned ? "Cache unsigned bundle" : "Download and verify") {
                    if release.isUnsigned {
                        showingUnsignedAcknowledgement = true
                    } else {
                        Task { await store.cache(release, component: component) }
                    }
                }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.isRefreshing || store.isCaching)
                if let releaseURL = release.releaseURL {
                    Link("Open on GitHub", destination: releaseURL)
                }
            }
            if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary) }
            Text(release.isUnsigned
                ? "Unsigned archives receive only bundle-ID and ad-hoc integrity checks. They remain visibly marked UNSIGNED in the cache and are available for manual launch or installation."
                : (component == .desktop ? "The archive is checked for the stable Thingtime bundle ID, team signature, and—on production builds—Developer ID notarization before it enters the shared cache." : "A cached Recovery release can replace this app through its signed helper, so the recovery UI remains independently updateable."))
                .font(.callout)
                .foregroundStyle(.secondary)
            Spacer()
        }
        .padding(28)
        .alert("Cache unsigned release?", isPresented: $showingUnsignedAcknowledgement) {
            Button("Cache unsigned bundle", role: .destructive) {
                Task { await store.cache(release, component: component) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This build has no Developer ID certificate or notarization. It can be launched or installed from Recovery, but macOS may require Privacy & Security → Open Anyway before it can run.")
        }
    }
}
