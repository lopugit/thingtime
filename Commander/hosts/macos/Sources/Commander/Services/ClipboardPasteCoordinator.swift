import AppKit

/// One coordinator is shared by every launcher because the system clipboard is global.
@MainActor
final class ClipboardPasteCoordinator {
  static let shared = ClipboardPasteCoordinator()

  struct Result {
    var copied = false
    var pasted = false
  }

  private let pasteboard: NSPasteboard
  private let waitForPaste: () async -> Void
  private var isPasting = false

  init(
    pasteboard: NSPasteboard = .general,
    waitForPaste: @escaping () async -> Void = {
      // Posting Cmd-V only enqueues an event; it does not acknowledge that the
      // target has read the clipboard. Allow busy apps time to service it.
      // Cancellation must not shorten this grace period after the event is sent.
      await Task.detached {
        try? await Task.sleep(for: .milliseconds(1500))
      }.value
    }
  ) {
    self.pasteboard = pasteboard
    self.waitForPaste = waitForPaste
  }

  func paste(
    _ text: String,
    preserveClipboard: Bool,
    prepareTarget: () async -> Bool,
    sendPaste: () -> Bool
  ) async -> Result {
    // MainActor methods can reenter at an await, including from another panel.
    guard !isPasting else { return Result() }
    isPasting = true
    defer { isPasting = false }

    let targetReady = await prepareTarget()
    guard !Task.isCancelled else { return Result() }
    guard targetReady || !preserveClipboard else { return Result() }

    // Take the snapshot after activation, immediately before the temporary write.
    let previous = preserveClipboard ? PasteboardSnapshot.capture(pasteboard) : nil
    pasteboard.clearContents()
    let wroteValue = pasteboard.setString(text, forType: .string)
    let ownedChangeCount = pasteboard.changeCount
    defer {
      // Never overwrite a copy made by the user, another app, or another native
      // clipboard action while the target was processing the paste.
      if pasteboard.changeCount == ownedChangeCount {
        previous?.restore(to: pasteboard)
      }
    }
    var result = Result(copied: wroteValue && !preserveClipboard)
    guard wroteValue, targetReady, sendPaste() else { return result }
    result.pasted = true
    // Hold the global transaction even for Paste & Copy: another paste must not
    // replace its value while the first target is still consuming the event.
    await waitForPaste()
    return result
  }
}

private struct PasteboardSnapshot {
  let items: [[NSPasteboard.PasteboardType: Data]]

  static func capture(_ pasteboard: NSPasteboard) -> PasteboardSnapshot {
    let items = pasteboard.pasteboardItems?.map { item in
      Dictionary(uniqueKeysWithValues: item.types.compactMap { type in
        item.data(forType: type).map { (type, $0) }
      })
    } ?? []
    return PasteboardSnapshot(items: items)
  }

  func restore(to pasteboard: NSPasteboard) {
    pasteboard.clearContents()
    let restored = items.map { values in
      let item = NSPasteboardItem()
      for (type, data) in values { item.setData(data, forType: type) }
      return item
    }
    if !restored.isEmpty { pasteboard.writeObjects(restored) }
  }
}
