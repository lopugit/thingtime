import AppKit
import SwiftUI

@main
struct ThingtimeWidgetsApp: App {
    @NSApplicationDelegateAdaptor(WidgetAppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var connection = WidgetConnection.shared
    var body: some Scene {
        Window("Thingtime Widgets", id: "main") {
            WidgetHome(connection: connection)
                .onReceive(NotificationCenter.default.publisher(for: .thingtimeWidgetAction)) { _ in connection.takePending() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        connection.takePending()
                        Task { await connection.refresh() }
                    }
                }
                .task {
                    connection.takePending()
                    while !Task.isCancelled {
                        await connection.refresh()
                        do { try await Task.sleep(for: .seconds(60)) } catch { break }
                    }
                }
        }
        .defaultSize(width: 900, height: 680)
        Settings {
            WidgetConnectionSettings(connection: connection)
                .frame(width: 540, height: 520)
        }
    }
}

@MainActor
final class WidgetAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) { NSWindow.allowsAutomaticWindowTabbing = false }
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls where WidgetRoute.path(for: url) != nil { WidgetConnection.shared.open(url) }
        // OAuth responses are delivered only to the originating system auth
        // session. Arbitrary launch URLs cannot establish a connection.
    }
}

private enum WidgetSection: String, CaseIterable, Identifiable {
    case home = "Overview", things = "Things", gallery = "Widget Gallery", connection = "Connection"
    var id: String { rawValue }
    var symbol: String {
        switch self {
        case .home: return "square.grid.2x2"
        case .things: return "square.stack.3d.up"
        case .gallery: return "rectangle.3.group"
        case .connection: return "person.crop.circle"
        }
    }
}

private struct WidgetHome: View {
    @ObservedObject var connection: WidgetConnection
    @State private var section: WidgetSection? = .home
    var body: some View {
        NavigationSplitView {
            List(WidgetSection.allCases, selection: $section) { item in
                Label(item.rawValue, systemImage: item.symbol).tag(item)
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 200, max: 240)
            .safeAreaInset(edge: .bottom) {
                VStack(alignment: .leading, spacing: 5) {
                    Label(connection.credential?.displayName ?? "Not connected", systemImage: "person.crop.circle")
                    Text(connection.origin.host ?? "Thingtime").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
            }
        } detail: {
            Group {
                switch section ?? .home {
                case .home: overview
                case .things: sharedThings
                case .gallery: WidgetGallery()
                case .connection: WidgetConnectionSettings(connection: connection)
                }
            }
            .navigationTitle((section ?? .home).rawValue)
            .toolbar { Button { Task { await connection.refresh() } } label: {
                Label("Refresh shared Things", systemImage: "arrow.clockwise")
            }.disabled(connection.busy || connection.credential == nil) }
        }
        .frame(minWidth: 740, minHeight: 540)
        .safeAreaInset(edge: .bottom) {
            if let error = connection.error {
                HStack {
                    Image(systemName: "exclamationmark.circle")
                    Text(error).font(.callout).fixedSize(horizontal: false, vertical: true)
                    Spacer()
                    Button("Dismiss") { connection.error = nil }
                }.padding().background(.regularMaterial)
            }
        }
    }

    private var overview: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your Things, a glance away.").font(.largeTitle.bold())
                    Text("Connect Thingtime, choose what to share, and make each widget your own.")
                        .foregroundStyle(.secondary)
                }
                GroupBox {
                    HStack {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(connection.credential.map { "Connected as \($0.displayName)" } ?? "Connect your account").font(.headline)
                            Text(connection.credential == nil ? "Sign in securely in your browser, then return here." : "\(connection.things.count) Things available on this Mac.")
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(connection.credential == nil ? "Connect Thingtime" : "Manage Connection") { section = .connection }
                    }.padding(8)
                }
                VStack(alignment: .leading, spacing: 12) {
                    Text("Quick actions").font(.title2.bold())
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170))], spacing: 12) {
                        ForEach(WidgetAction.allCases, id: \.rawValue) { action in
                            Button { connection.open(action.url) } label: {
                                VStack(alignment: .leading, spacing: 12) {
                                    Image(systemName: action.symbol).font(.title2).foregroundStyle(.tint)
                                    Text(action.title).font(.headline)
                                }.frame(maxWidth: .infinity, minHeight: 80, alignment: .leading).padding(12)
                            }.buttonStyle(.bordered)
                        }
                    }
                    Text("Actions open your selected Thingtime site. Lopu voice and transcription start there after microphone permission.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                GroupBox("Configure each widget") {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Right-click your desktop → Edit Widgets → Thingtime to add a widget.")
                        Text("Right-click the actual widget → Edit Widget to choose its Thing, action, title, and layout.")
                        Button("Browse widget layouts") { section = .gallery }
                    }.frame(maxWidth: .infinity, alignment: .leading).padding(8)
                }
            }.padding(28).frame(maxWidth: 860)
        }
    }

    private var sharedThings: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Choose what your widgets can show").font(.title2.bold())
                    Text("Choose specific Things or approve access to all Things in the browser.").foregroundStyle(.secondary)
                }
                Spacer()
                Button("Permissions…") { connection.connect() }.disabled(connection.busy)
            }
            Toggle("Show shared Things in widgets", isOn: $connection.shareContent)
            if connection.things.isEmpty {
                ContentUnavailableView("No shared Things yet", systemImage: "square.stack.3d.up",
                    description: Text("Open Permissions, choose Things or approve All Things, then enable widget content."))
            } else {
                List(connection.things) { thing in
                    HStack {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(thing.title).font(.headline)
                            if !thing.text.isEmpty { Text(thing.text).lineLimit(2).foregroundStyle(.secondary) }
                            Text(thing.kind).font(.caption).foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Button("Open") { connection.open(thing.url) }
                    }.padding(.vertical, 6)
                }
            }
            if let date = connection.lastRefresh {
                Text("Updated \(date.formatted(date: .omitted, time: .shortened)). Widget copies expire after 30 minutes without a refresh.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.padding(24)
    }
}

private struct WidgetConnectionSettings: View {
    @ObservedObject var connection: WidgetConnection
    var body: some View {
        Form {
            Section("Thingtime connection") {
                TextField("Server address", text: $connection.address)
                    .textContentType(.URL)
                    .disabled(connection.busy)
                Text("Use thingtime.com or the address of your own Thingtime server. Local connections can use http://127.0.0.1 with your server’s port.")
                    .font(.caption).foregroundStyle(.secondary)
                if let credential = connection.credential {
                    LabeledContent("Account", value: credential.displayName)
                    LabeledContent("Connected server", value: credential.origin)
                }
                HStack {
                    Button(connection.credential == nil ? "Sign in with Thingtime" : "Sign in / Change permissions") { connection.connect() }
                        .disabled(connection.busy)
                    if connection.busy { Button("Cancel") { connection.cancelSignIn() } }
                }
                Text("Your browser handles sign-in. The connection credential stays in this app’s Keychain; widgets receive only the display content you enable.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            Section("Widget content") {
                Toggle("Show shared Things in widgets", isOn: $connection.shareContent)
                Text("Off by default. Up to 50 Things covered by your permissions are copied to widget storage. They may be visible on your desktop. Right-click each widget to select its Thing and display options.")
                    .font(.caption).foregroundStyle(.secondary)
                Button("Clear widget content") { connection.shareContent = false }
            }
            if connection.credential != nil {
                Section("Disconnect") {
                    Button("Disconnect this Mac", role: .destructive) { connection.disconnect() }
                    Text("Revokes this connection and removes its saved credential and widget content from this Mac. Other devices remain connected.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }.formStyle(.grouped)
    }
}
