import SwiftUI
import ThingtimeRecoveryCore

private enum RecoverySelection: Hashable {
    case cache(RecoveryComponent)
    case release(RecoveryComponent, String)
}

private struct RecoveryCatalogRow: Identifiable {
    let component: RecoveryComponent
    let release: RecoveryRelease
    var id: String { "\(component.rawValue):\(release.id)" }
}

struct RecoveryContentView: View {
    @ObservedObject var store: RecoveryStore
    @State private var selection: RecoverySelection? = .cache(.desktop)

    private var releaseRows: [RecoveryCatalogRow] {
        (store.releases(for: store.selectedProduct.component).map { RecoveryCatalogRow(component: store.selectedProduct.component, release: $0) }
         + store.recoveryReleases.map { RecoveryCatalogRow(component: .recovery, release: $0) })
            .sorted { ($0.release.publishedAt ?? .distantPast) > ($1.release.publishedAt ?? .distantPast) }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section("This Mac") {
                    Label("Cached \(store.selectedProduct.title)", systemImage: store.selectedProduct.systemImage)
                        .tag(RecoverySelection.cache(store.selectedProduct.component))
                    Label("Cached Recovery", systemImage: "cross.case")
                        .tag(RecoverySelection.cache(.recovery))
                }
                Section("GitHub releases") {
                    Text("\(store.releases(for: store.selectedProduct.component).count) \(store.selectedProduct.title) · \(store.recoveryReleases.count) Recovery")
                        .font(.caption).foregroundStyle(.secondary)
                    if let status = store.catalogStatus {
                        Text(status).font(.caption).foregroundStyle(.secondary)
                    }
                    ForEach(releaseRows) { row in
                        ReleaseCardView(component: row.component, release: row.release, isSelected: selection == .release(row.component, row.release.id))
                            .tag(RecoverySelection.release(row.component, row.release.id))
                    }
                    if store.releases(for: store.selectedProduct.component).isEmpty {
                        Text("No compatible \(store.selectedProduct.title) archives published yet.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationSplitViewColumnWidth(min: 300, ideal: 370, max: 520)
        } detail: {
            detail
        }
        .toolbar {
            ToolbarItem(placement: .navigation) {
                Picker("App", selection: $store.selectedProduct) {
                    ForEach(RecoveryProduct.allCases) { product in
                        Text(product.title).tag(product)
                    }
                }
                .pickerStyle(.menu)
                .labelsHidden()
                .fixedSize()
                .help("Choose the app to recover")
                .disabled(store.isCaching)
            }
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await store.refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .help("Refresh GitHub releases")
                    .disabled(store.isRefreshing || store.isCaching)
            }
        }
        .onAppear { selection = .cache(store.selectedProduct.component) }
        .onChange(of: store.selectedProduct) { product in selection = .cache(product.component) }
        .alert("Thingtime Recovery", isPresented: Binding(get: { store.errorMessage != nil }, set: { if !$0 { store.errorMessage = nil } })) {
            Button("OK", role: .cancel) { store.errorMessage = nil }
        } message: { Text(store.errorMessage ?? "") }
    }

    @ViewBuilder private var detail: some View {
        switch selection {
        case .cache(let component):
            CacheListView(component: component, bundles: store.bundles(for: component), store: store)
        case .release(let component, let id):
            if let release = store.releases(for: component).first(where: { $0.id == id }) {
                ReleaseDetailView(component: component, release: release, store: store)
                    .id("\(component.rawValue):\(id)")
            } else { EmptyStateView(title: "Release unavailable", systemImage: "exclamationmark.triangle") }
        case nil:
            EmptyStateView(title: "Choose a cached bundle or release", systemImage: "arrow.triangle.2.circlepath")
        }
    }
}

struct EmptyStateView: View {
    let title: String
    let systemImage: String
    var message: String? = nil
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: systemImage).font(.system(size: 36)).foregroundStyle(.secondary)
            Text(title).font(.headline)
            if let message { Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}
