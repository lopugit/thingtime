import ServiceManagement

final class LaunchAtLoginService {
  func update(enabled: Bool) throws {
    guard !CommanderDevelopmentEnvironment.enabled else { return }
    if enabled {
      if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
    } else if SMAppService.mainApp.status == .enabled {
      try SMAppService.mainApp.unregister()
    }
  }
}
