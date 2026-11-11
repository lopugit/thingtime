import Foundation

public func recognitionFailureCode(_ error: NSError, hasTranscript: Bool) -> String {
    // macOS can end an empty capture with this nested "Retry" error after a
    // few seconds of silence. Treat only this observed no-input case like
    // no-speech; unrelated service failures must still reach the user.
    if !hasTranscript,
       error.domain == "kAFAssistantErrorDomain", error.code == 203,
       let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError,
       underlying.domain == "SiriSpeechErrorDomain", underlying.code == 1 {
        return "no-speech"
    }
    return error.code == 1110 ? "no-speech" : "service-unavailable"
}
