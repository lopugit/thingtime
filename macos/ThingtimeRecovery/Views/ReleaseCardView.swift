import SwiftUI
import ThingtimeRecoveryCore

struct RecoveryBadge: View {
    let title: String
    var icon: String? = nil
    var color: Color = .secondary
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon) }
            Text(title)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, 7).padding(.vertical, 4)
        .background(color.opacity(0.12), in: Capsule())
        .fixedSize()
    }
}

struct ReleaseCardView: View {
    let component: RecoveryComponent
    let release: RecoveryRelease
    var isSelected = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label(component.title, systemImage: component == .recovery ? "cross.case.fill" : (component == .commander ? "command" : "desktopcomputer"))
                    .font(.headline)
                Spacer(minLength: 4)
                Text(release.metadata.version?.components(separatedBy: CharacterSet(charactersIn: "+-")).first ?? "Release")
                    .font(.subheadline.monospaced())
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 5) { trustBadge; channelBadge }
                VStack(alignment: .leading, spacing: 5) { trustBadge; channelBadge }
            }
            HStack(spacing: 6) {
                Text(release.metadata.buildNumber.map { "Build \($0)" } ?? "Release #\(release.id)")
                if let sha = release.metadata.shortCommit { Text("· \(sha)").monospaced() }
            }
            .font(.caption).foregroundStyle(isSelected ? Color.white.opacity(0.85) : Color.secondary)
            HStack(spacing: 6) {
                if let date = release.publishedAt { Text(date, format: .dateTime.day().month(.abbreviated).year()) }
                Text("· \(release.architectureLabel)")
                if let size = release.sizeLabel { Text("· \(size)") }
            }
            .font(.caption2).foregroundStyle(isSelected ? Color.white.opacity(0.85) : Color.secondary)
            .lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 10))
        .padding(.vertical, 3)
        .help(release.version ?? release.tag)
        .accessibilityElement(children: .combine)
    }
    private var trustBadge: some View {
        RecoveryBadge(title: release.unavailableReason != nil ? "Unavailable" : (release.isUnsigned ? "Unsigned" : "Signed release"), icon: release.unavailableReason != nil ? "xmark.circle.fill" : (release.isUnsigned ? "exclamationmark.triangle.fill" : "checkmark.seal.fill"), color: isSelected ? .white : (release.unavailableReason != nil ? .secondary : (release.isUnsigned ? .orange : .green)))
    }
    private var channelBadge: some View {
        RecoveryBadge(title: release.metadata.pullRequest.map { "PR #\($0)" } ?? (release.isPrerelease ? "Prerelease" : "Stable"), icon: "arrow.triangle.branch", color: isSelected ? .white : (release.isPrerelease ? .purple : .blue))
    }
}
