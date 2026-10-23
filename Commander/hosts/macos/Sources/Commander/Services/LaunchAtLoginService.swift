import ServiceManagement

final class LaunchAtLoginService {
  func update(enabled: Bool) throws {
    if enabled {
      if SMAppService.mainApp.status != .enabled { try SMAppService.mainApp.register() }
    } else if SMAppService.mainApp.status == .enabled {
      try SMAppService.mainApp.unregister()
    }
  }
}
