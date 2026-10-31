import SwiftUI
import ThingtimeRecoveryCore

struct ReleaseDetailView: View {
    let component: RecoveryComponent
    let release: RecoveryRelease
    @ObservedObject var store: RecoveryStore
    @State private var showingUnsignedAcknowledgement = false
    @State private var installAfterDownload = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Label("\(component.title) release", systemImage: component == .recovery ? "cross.case.fill" : "arrow.down.app")
                    .font(.title2.weight(.semibold))
                Text(release.version ?? release.tag).font(.title3.monospaced())
                    .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                ReleaseCardView(component: component, release: release)
                Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 10) {
                    metadataRow("Build", release.metadata.buildNumber ?? "Not recorded in release tag")
                    metadataRow("Date", release.publishedAt.map { RecoveryBuildDate.released($0).label } ?? RecoveryBuildDate.unavailable.label)
                    metadataRow("GitHub release", "#\(release.id)")
                    if let branch = release.branch { metadataRow("Branch", branch) }
                    if let commit = release.metadata.commit { metadataRow("Commit", commit) }
                    metadataRow("Archive", release.asset.name)
                }
                .font(.callout).textSelection(.enabled)
                if let reason = release.unavailableReason {
                    Label("Unavailable — damaged release archive", systemImage: "xmark.circle").font(.headline)
                    Text(reason).foregroundStyle(.secondary)
                } else if release.isUnsigned {
                    Label("Unsigned · no Developer ID or notarization", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange).font(.headline)
                    Text("This release requires explicit acknowledgement. macOS may require Privacy & Security → Open Anyway before its first launch.")
                        .foregroundStyle(.secondary)
                } else {
                    Label("Signature checked before caching", systemImage: "checkmark.shield").font(.headline)
                    Text("Recovery verifies the app identity, code signature and team. Production Recovery also requires Developer ID notarization.")
                        .foregroundStyle(.secondary)
                }
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) { downloadButton; installButton; githubLink }
                    VStack(alignment: .leading, spacing: 12) { downloadButton; installButton; githubLink }
                }
                if let notice = store.notice { Text(notice).font(.callout).foregroundStyle(.secondary).textSelection(.enabled) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .alert(installAfterDownload ? "Install unsigned release?" : "Cache unsigned release?", isPresented: $showingUnsignedAcknowledgement) {
            Button(installAfterDownload ? "Download & install unsigned bundle" : "Cache unsigned bundle", role: .destructive) {
                download(install: installAfterDownload)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This build has no Developer ID certificate or notarization. It can be launched or installed from Recovery, but macOS may require Privacy & Security → Open Anyway before it can run.")
        }
    }

    private func metadataRow(_ label: String, _ value: String) -> some View {
        GridRow(alignment: .top) {
            Text(label).foregroundStyle(.secondary)
            Text(value).fixedSize(horizontal: false, vertical: true).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
    private var downloadButton: some View {
        Button(release.unavailableReason != nil ? "Unavailable" : (release.isUnsigned ? "Cache unsigned bundle" : "Download and verify")) {
            installAfterDownload = false
            if release.isUnsigned { showingUnsignedAcknowledgement = true }
            else { download(install: false) }
        }
        .buttonStyle(.borderedProminent)
        .disabled(release.unavailableReason != nil || store.isRefreshing || store.isCaching)
    }
    private var installButton: some View {
        Button("Download & install") {
            installAfterDownload = true
            if release.isUnsigned { showingUnsignedAcknowledgement = true }
            else { download(install: true) }
        }
        .buttonStyle(.bordered)
        .disabled(release.unavailableReason != nil || store.isRefreshing || store.isCaching)
        .help("Download and verify this release, then install it. The previous app is preserved for recovery.")
    }

    private func download(install: Bool) {
        Task {
            if install { await store.downloadAndInstall(release, component: component) }
            else { await store.cache(release, component: component) }
        }
    }
    @ViewBuilder private var githubLink: some View {
        if let url = release.releaseURL { Link("Open on GitHub", destination: url) }
    }
}
