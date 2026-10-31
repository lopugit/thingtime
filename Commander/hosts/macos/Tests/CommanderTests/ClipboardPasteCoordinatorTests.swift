import AppKit
import XCTest
@testable import Commander

@MainActor
final class ClipboardPasteCoordinatorTests: XCTestCase {
  private func makePasteboard() -> NSPasteboard {
    let board = NSPasteboard.withUniqueName()
    board.setString("previous clipboard", forType: .string)
    return board
  }

  func testDelayedTargetReadsEmojiBeforeClipboardIsRestored() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    let coordinator = ClipboardPasteCoordinator(pasteboard: board)
    var targetRead: Task<String?, Never>?
    let result = await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: { true }) {
      targetRead = Task { @MainActor in
        // A target reading after the old 180ms restoration deadline got stale data.
        try? await Task.sleep(for: .milliseconds(400))
        return board.string(forType: .string)
      }
      return true
    }
    let pastedValue = await targetRead?.value
    XCTAssertEqual(pastedValue, "❤️")
    XCTAssertTrue(result.pasted)
    XCTAssertFalse(result.copied)
    XCTAssertEqual(board.string(forType: .string), "previous clipboard")
  }

  func testRestorationDoesNotOverwriteANewerCopyEvenWithTheSameText() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    var copiedChangeCount = 0
    let coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: {
      board.clearContents()
      board.setString("❤️", forType: .string)
      copiedChangeCount = board.changeCount
    })
    _ = await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: { true }, sendPaste: { true })
    XCTAssertEqual(board.string(forType: .string), "❤️")
    XCTAssertEqual(board.changeCount, copiedChangeCount)
  }

  func testOverlappingPasteCannotReplaceInFlightEmoji() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    var coordinator: ClipboardPasteCoordinator!
    coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: {
      let overlapping = await coordinator.paste("🐶", preserveClipboard: false, prepareTarget: {
        XCTFail("Overlapping paste must not activate another target")
        return true
      }, sendPaste: {
        XCTFail("Overlapping paste must not send Cmd-V")
        return true
      })
      XCTAssertFalse(overlapping.pasted)
      XCTAssertFalse(overlapping.copied)
      XCTAssertEqual(board.string(forType: .string), "❤️")
    })
    let result = await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: { true }, sendPaste: { true })
    XCTAssertTrue(result.pasted)
    XCTAssertEqual(board.string(forType: .string), "previous clipboard")
  }

  func testSnapshotIsTakenAfterTargetPreparation() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    let coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: {})
    _ = await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: {
      XCTAssertEqual(board.string(forType: .string), "previous clipboard")
      board.clearContents()
      board.setString("copied during activation", forType: .string)
      return true
    }, sendPaste: { true })
    XCTAssertEqual(board.string(forType: .string), "copied during activation")
  }

  func testFailedActivationDoesNotTouchPreservedClipboard() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    let changeCount = board.changeCount
    let coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: { XCTFail("No paste was sent") })
    let result = await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: { false }, sendPaste: {
      XCTFail("Target was not ready")
      return true
    })
    XCTAssertFalse(result.pasted)
    XCTAssertFalse(result.copied)
    XCTAssertEqual(board.changeCount, changeCount)
  }

  func testFailedEventRestoresEveryClipboardRepresentation() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    board.clearContents()
    let first = NSPasteboardItem()
    first.setString("rich text", forType: .string)
    first.setData(Data([1, 2, 3]), forType: .rtf)
    let second = NSPasteboardItem()
    second.setString("file:///tmp/example", forType: .fileURL)
    board.writeObjects([first, second])
    let coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: { XCTFail("No paste was sent") })
    let result = await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: { true }, sendPaste: { false })
    XCTAssertFalse(result.pasted)
    XCTAssertEqual(board.pasteboardItems?.count, 2)
    XCTAssertEqual(board.pasteboardItems?[0].string(forType: .string), "rich text")
    XCTAssertEqual(board.pasteboardItems?[0].data(forType: .rtf), Data([1, 2, 3]))
    XCTAssertEqual(board.pasteboardItems?[1].string(forType: .fileURL), "file:///tmp/example")
  }

  func testPasteAndCopyKeepsEmojiAndWaitsForConsumption() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    var waited = false
    let coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: { waited = true })
    let result = await coordinator.paste("❤️", preserveClipboard: false, prepareTarget: { true }, sendPaste: { true })
    XCTAssertTrue(result.pasted)
    XCTAssertTrue(result.copied)
    XCTAssertTrue(waited)
    XCTAssertEqual(board.string(forType: .string), "❤️")
  }

  func testPasteAndCopyFallsBackToCopyWhenTargetIsUnavailable() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    let coordinator = ClipboardPasteCoordinator(pasteboard: board, waitForPaste: { XCTFail("No paste was sent") })
    let result = await coordinator.paste("❤️", preserveClipboard: false, prepareTarget: { false }, sendPaste: {
      XCTFail("Target was not ready")
      return true
    })
    XCTAssertTrue(result.copied)
    XCTAssertFalse(result.pasted)
    XCTAssertEqual(board.string(forType: .string), "❤️")
  }

  func testCancellationAfterSendingDoesNotRestoreBeforeTargetReads() async {
    let board = makePasteboard()
    defer { board.releaseGlobally() }
    let coordinator = ClipboardPasteCoordinator(pasteboard: board)
    var operation: Task<ClipboardPasteCoordinator.Result, Never>!
    var targetRead: Task<String?, Never>?
    operation = Task { @MainActor in
      await coordinator.paste("❤️", preserveClipboard: true, prepareTarget: { true }) {
        targetRead = Task { @MainActor in
          try? await Task.sleep(for: .milliseconds(400))
          return board.string(forType: .string)
        }
        operation.cancel()
        return true
      }
    }
    let result = await operation.value
    let pastedValue = await targetRead?.value
    XCTAssertTrue(result.pasted)
    XCTAssertEqual(pastedValue, "❤️")
    XCTAssertEqual(board.string(forType: .string), "previous clipboard")
  }
}
