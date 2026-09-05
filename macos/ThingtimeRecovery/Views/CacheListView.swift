import SwiftUI
import ThingtimeRecoveryCore

struct CacheListView: View {
    let component: RecoveryComponent
    let bundles: [CachedBundle]
    @ObservedObject var store: RecoveryStore

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Label("\(component.title) on this Mac", systemImage: component == .recovery ? "cross.case" : "desktopcomputer")
                .font(.title2.weight(.semibold))
            Text(component == .recovery ? "Saved Recovery builds can replace this app through its independent installer." : "Save, launch or restore a verified build. Installing preserves the previous app for recovery.")
                .foregroundStyle(.secondary)
            HStack {
                Button("Save installed build") { Task { await store.cacheInstalled(component) } }
                    .disabled(store.isCaching || !FileManager.default.fileExists(atPath: store.paths.installedApp(for: component).path))
                Spacer()
                Text("\(bundles.count) cached").font(.caption).foregroundStyle(.secondary)
            }
            if bundles.isEmpty {
                EmptyStateView(title: "No cached builds yet", systemImage: "externaldrive.badge.questionmark", message: "Save the installed app, or download a compatible GitHub release.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(bundles) { bundle in cachedCard(bundle) }
                    }.padding(1)
                }
            }
            HStack(alignment: .top) {
                Button("Show in Finder") { store.reveal(component) }
                if let notice = store.notice { Text(notice).font(.caption).foregroundStyle(.secondary).textSelection(.enabled) }
            }
        }
        .padding(24)
    }

    private func cachedCard(_ bundle: CachedBundle) -> some View {
        let metadata = bundle.metadata
        return VStack(alignment: .leading, spacing: 10) {
            Text(bundle.displayName).font(.headline).textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 6) {
                RecoveryBadge(title: metadata.buildLabel, icon: "number", color: .blue)
                RecoveryBadge(title: bundle.entry.isUnsigned == true ? "Unsigned" : "Signed", icon: bundle.entry.isUnsigned == true ? "exclamationmark.triangle.fill" : "checkmark.seal.fill", color: bundle.entry.isUnsigned == true ? .orange : .green)
            }
            if let sha = metadata.shortCommit {
                Label(sha, systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
            }
            if let date = bundle.entry.cachedDate {
                Text("Cached \(date.formatted(.dateTime.day().month(.abbreviated).year().hour().minute()))")
                    .font(.caption).foregroundStyle(.secondary)
            } else { Text(bundle.entry.cachedAt ?? "Cache date unavailable").font(.caption).foregroundStyle(.secondary) }
            if bundle.entry.isUnsigned == true {
                Text("Manually approved · not verified by Apple").font(.caption).foregroundStyle(.orange)
            }
            HStack {
                if component != .recovery { Button("Launch") { store.launch(bundle) } }
                Button("Install") { store.install(bundle) }.buttonStyle(.borderedProminent)
                Spacer()
                Button(role: .destructive) { store.remove(bundle) } label: { Image(systemName: "trash") }
                    .help("Remove this cached build")
                    .accessibilityLabel("Remove \(component.title) \(metadata.buildLabel)")
            }
            .disabled(store.isCaching)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(.quaternary, lineWidth: 1))
    }
}
