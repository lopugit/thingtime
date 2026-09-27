import Foundation
import XCTest
@testable import ThingtimeSpeechCore

final class RecognitionFailureTests: XCTestCase {
    private func failure(domain: String = "kAFAssistantErrorDomain", code: Int = 203,
                         underlyingDomain: String = "SiriSpeechErrorDomain", underlyingCode: Int = 1) -> NSError {
        NSError(domain: domain, code: code, userInfo: [
            NSUnderlyingErrorKey: NSError(domain: underlyingDomain, code: underlyingCode)
        ])
    }

    func testEmptyCaptureRetryUsesExistingNoSpeechRecovery() {
        XCTAssertEqual(recognitionFailureCode(failure(), hasTranscript: false), "no-speech")
        XCTAssertEqual(recognitionFailureCode(NSError(domain: "kAFAssistantErrorDomain", code: 1110), hasTranscript: false), "no-speech")
    }

    func testRetryAfterSpeechDoesNotHideARecognitionFailure() {
        XCTAssertEqual(recognitionFailureCode(failure(), hasTranscript: true), "service-unavailable")
    }

    func testUnrelatedErrorsRemainVisible() {
        let errors = [
            failure(domain: NSURLErrorDomain),
            failure(code: 1101),
            failure(underlyingDomain: NSURLErrorDomain),
            failure(underlyingCode: 2),
            NSError(domain: "kAFAssistantErrorDomain", code: 203)
        ]
        for error in errors {
            XCTAssertEqual(recognitionFailureCode(error, hasTranscript: false), "service-unavailable", error.description)
        }
    }
}
