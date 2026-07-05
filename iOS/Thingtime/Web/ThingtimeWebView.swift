import SwiftUI

struct ThingtimeWebView: View {
    private enum StorageKey {
        static let selectedDestinationID = "thingtime.webDestination.selectedID"
        static let customVercelURL = "thingtime.webDestination.customVercelURL"
    }

    @AppStorage(StorageKey.selectedDestinationID) private var selectedDestinationID = ThingtimeWebDestination.defaultDestinationID
    @AppStorage(StorageKey.customVercelURL) private var customDeploymentURLString = ""

    @State private var customDeploymentDraft = ""
    @State private var isDestinationPickerOpen = false
    @State private var validationMessage: String?

    private var destinations: [ThingtimeWebDestination.Destination] {
        ThingtimeWebDestination.availableDestinations(
            customDeploymentURLString: customDeploymentURLString
        )
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
                    .ignoresSafeArea(.container, edges: [.top, .bottom])

                if isDestinationPickerOpen {
                    Color.black.opacity(0.2)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture(perform: closeDestinationPicker)
                        .transition(.opacity)
                }

                DestinationPickerDrawer(
                    destinations: destinations,
                    selectedDestinationID: selectedDestination.id,
                    customDeploymentDraft: $customDeploymentDraft,
                    validationMessage: $validationMessage,
                    safeAreaInsets: proxy.safeAreaInsets,
                    onSelect: select,
                    onSaveCustomDeployment: saveCustomDeployment,
                    onClose: closeDestinationPicker
                )
                .frame(width: max(drawerWidth, 280))
                .frame(maxHeight: .infinity)
                .offset(x: isDestinationPickerOpen ? 0 : -max(drawerWidth, 280))
                .gesture(closeDrawerGesture)
                .ignoresSafeArea(.container, edges: [.top, .bottom, .leading])

                if !isDestinationPickerOpen {
                    Color.clear
                        .frame(width: 32)
                        .contentShape(Rectangle())
                        .gesture(openDrawerGesture)
                        .accessibilityHidden(true)
                }
            }
            .animation(.easeOut(duration: 0.22), value: isDestinationPickerOpen)
            .onAppear(perform: prepareDestinationState)
            .onChange(of: selectedDestinationID) { _, _ in
                ensureSelectedDestinationIsAvailable()
            }
            .onChange(of: customDeploymentURLString) { _, newValue in
                customDeploymentDraft = newValue
                ensureSelectedDestinationIsAvailable()
            }
        }
    }

    private var openDrawerGesture: some Gesture {
        DragGesture(minimumDistance: 18)
            .onEnded { value in
                guard value.translation.width > 56 else { return }
                openDestinationPicker()
            }
    }

    private var closeDrawerGesture: some Gesture {
        DragGesture(minimumDistance: 18)
            .onEnded { value in
                guard value.translation.width < -56 else { return }
                closeDestinationPicker()
            }
    }

    private func prepareDestinationState() {
        if customDeploymentDraft.isEmpty {
            customDeploymentDraft = customDeploymentURLString
        }

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
        validationMessage = nil

        withAnimation(.easeOut(duration: 0.22)) {
            isDestinationPickerOpen = true
        }
    }

    private func closeDestinationPicker() {
        withAnimation(.easeOut(duration: 0.22)) {
            isDestinationPickerOpen = false
        }
    }

    private func select(_ destination: ThingtimeWebDestination.Destination) {
        selectedDestinationID = destination.id
        validationMessage = nil
        closeDestinationPicker()
    }

    private func saveCustomDeployment() {
        guard let destination = ThingtimeWebDestination.customVercelDestination(from: customDeploymentDraft) else {
            validationMessage = "Use a valid https://*.vercel.app URL."
            return
        }

        customDeploymentURLString = destination.url.absoluteString
        customDeploymentDraft = destination.url.absoluteString
        selectedDestinationID = destination.id
        validationMessage = nil
        closeDestinationPicker()
    }
}

private struct DestinationPickerDrawer: View {
    let destinations: [ThingtimeWebDestination.Destination]
    let selectedDestinationID: String

    @Binding var customDeploymentDraft: String
    @Binding var validationMessage: String?

    let safeAreaInsets: EdgeInsets
    let onSelect: (ThingtimeWebDestination.Destination) -> Void
    let onSaveCustomDeployment: () -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(spacing: 12) {
                Text("Web destination")
                    .font(.headline)

                Spacer()

                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(width: 34, height: 34)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close destination picker")
            }

            VStack(spacing: 8) {
                ForEach(destinations) { destination in
                    destinationRow(destination)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Label("Vercel deployment", systemImage: "paperplane")
                    .font(.subheadline.weight(.semibold))

                HStack(spacing: 8) {
                    TextField("https://branch.vercel.app", text: $customDeploymentDraft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .submitLabel(.done)
                        .onSubmit(onSaveCustomDeployment)

                    Button(action: onSaveCustomDeployment) {
                        Image(systemName: "checkmark")
                            .font(.system(size: 15, weight: .bold))
                            .frame(width: 38, height: 38)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Save Vercel deployment")
                }

                if let validationMessage {
                    Text(validationMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.top, safeAreaInsets.top + 18)
        .padding(.horizontal, 16)
        .padding(.bottom, safeAreaInsets.bottom + 20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(.regularMaterial)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(.primary.opacity(0.08))
                .frame(width: 1)
        }
    }

    private func destinationRow(_ destination: ThingtimeWebDestination.Destination) -> some View {
        Button {
            onSelect(destination)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: iconName(for: destination))
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

                if destination.id == selectedDestinationID {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .accessibilityLabel("Selected")
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground(for: destination))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(destination.title), \(destination.subtitle)")
    }

    private func rowBackground(for destination: ThingtimeWebDestination.Destination) -> Color {
        destination.id == selectedDestinationID ? Color.primary.opacity(0.1) : Color.primary.opacity(0.04)
    }

    private func iconName(for destination: ThingtimeWebDestination.Destination) -> String {
        switch destination.source {
        case .production:
            return "globe"
        case .configured:
            return "shippingbox"
        case .customVercel:
            return "paperplane"
        }
    }
}

#Preview {
    ThingtimeWebView()
}
