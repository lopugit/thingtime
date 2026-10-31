import Foundation
import ThingtimeRecoveryCore

func fail(_ message: String) -> Never {
    fputs("Thingtime Recovery installer: \(message)\n", stderr)
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("usage: ThingtimeRecoveryInstaller <handoff-plan.json>")
}

let planURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
var failure: Error?
var recoveryAppURL: URL?
do {
    let data = try Data(contentsOf: planURL)
    let plan = try JSONDecoder().decode(RecoveryInstallPlan.self, from: data)
    // This executable lives at Contents/Helpers, which Foundation treats as a
    // small non-bundle directory. Derive the enclosing signed .app explicitly
    // rather than asking Bundle.main for the helper's container.
    let helperExecutable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
    let contentsDirectory = helperExecutable.deletingLastPathComponent().deletingLastPathComponent()
    guard contentsDirectory.lastPathComponent == "Contents" else { throw RecoveryError.operationFailed("the signed recovery installer is not inside an app bundle") }
    let currentApp = contentsDirectory.deletingLastPathComponent()
    recoveryAppURL = currentApp
    // An ad-hoc Recovery app has no Apple team identity. It may still launch
    // and install explicitly acknowledged unsigned cache entries, while the
    // core installer retains strict team verification for the signed lane.
    let currentTrust = try BundleVerifier.distribution(for: currentApp, component: .recovery)
    let context: SigningContext?
    switch currentTrust {
    case .signed:
        context = try BundleVerifier.signingContext(for: currentApp)
    case .unsigned:
        context = nil
    }
    try RecoveryInstaller.execute(plan: plan, signingContext: context)
} catch {
    failure = error
}
try? FileManager.default.removeItem(at: planURL)
if let failure {
    try? RecoveryInstallNotice(message: failure.localizedDescription, isError: true).save()
    if let recoveryAppURL { try? ProcessExecution.launchApplication(recoveryAppURL) }
    fail(failure.localizedDescription)
}
