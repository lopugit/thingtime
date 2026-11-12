import Foundation
import WebKit
let folder = URL(fileURLWithPath: "/tmp/thingtime-ios-local-development-rule-test/store", isDirectory: true)
try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
let store = WKContentRuleListStore(url: folder)!
let origin = "http://127.0.0.1:29741"
let prefix = "^" + NSRegularExpression.escapedPattern(for: origin) + "/"
let rules: [[String: Any]] = [["trigger":["url-filter":"^https?://"],"action":["type":"block"]],["trigger":["url-filter":prefix],"action":["type":"ignore-previous-rules"]]]
let json = String(data: try JSONSerialization.data(withJSONObject: rules), encoding: .utf8)!
var done = false
var success = false
store.compileContentRuleList(forIdentifier: "thingtime-local-development-rule-validation", encodedContentRuleList: json) { list, error in
    if let error { print("Compilation failed: \(error)"); done = true; return }
    success = list != nil
    store.removeContentRuleList(forIdentifier: "thingtime-local-development-rule-validation") { error in
        print("{\"compiled\":\(success),\"removed\":\(error == nil),\"exactLoopbackPrefix\":\(String(data: try! JSONSerialization.data(withJSONObject: [prefix]), encoding: .utf8)!)}")
        success = success && error == nil; done = true
    }
}
let until = Date().addingTimeInterval(20)
while !done && Date() < until { RunLoop.main.run(until: Date().addingTimeInterval(0.1)) }
if !done || !success { exit(1) }
