import Darwin

/// Checks the host process' Full Disk Access grant without reading user data.
/// macOS gates the system TCC database behind the SystemPolicyAllFiles service,
/// so opening its descriptor is a stable, read-only permission probe.
enum FullDiskAccessService {
  static let protectedProbePath = "/Library/Application Support/com.apple.TCC/TCC.db"

  static var isGranted: Bool {
    isGranted(probe: canOpenProtectedFile)
  }

  static func isGranted(probe: (String) -> Bool) -> Bool {
    probe(protectedProbePath)
  }

  private static func canOpenProtectedFile(_ path: String) -> Bool {
    let descriptor = Darwin.open(path, O_RDONLY | O_CLOEXEC)
    guard descriptor >= 0 else { return false }
    _ = Darwin.close(descriptor)
    return true
  }
}
