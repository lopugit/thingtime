import Foundation
@main struct DocumentFenceTests {
 static func main() {
  let url=URL(string:"http://127.0.0.1:29741/things")!
  let native=URL(string:"http://127.0.0.1:29741")!
  let remote=URL(string:"https://thingtime.com/things")!
  precondition(ThingtimeLocalWorkspaceFence.allowsOrigin(nativeOrigin:native,selectedRoot:native,currentURL:url,frameURL:url))
  precondition(!ThingtimeLocalWorkspaceFence.allowsOrigin(nativeOrigin:native,selectedRoot:remote,currentURL:remote,frameURL:remote))
  precondition(!ThingtimeLocalWorkspaceFence.allowsOrigin(nativeOrigin:native,selectedRoot:native,currentURL:url,frameURL:remote))
  var fence=ThingtimeLocalWorkspaceFence()
  let first=fence.capture(url:url)
  precondition(fence.allowsInitialization(first,currentURL:url,expectedVersion:"1.0.0",expectedDocumentId:first.documentId))
  var mutations=0
  func commitIfAllowed(_ captured:ThingtimeLocalWorkspaceFence.Snapshot,version:String) {
   if fence.allowsInitialization(captured,currentURL:url,expectedVersion:version,expectedDocumentId:captured.documentId){mutations += 1}
  }
  commitIfAllowed(first,version:"2.0.0");precondition(mutations==0)
  fence.navigationStarted() // Same URL/origin, different live document after await.
  commitIfAllowed(first,version:"1.0.0");precondition(mutations==0)
  let second=fence.capture(url:url)
  precondition(!fence.isCurrent(second,currentURL:URL(string:"http://127.0.0.1:29741/other")!))
  precondition(!fence.allowsInitialization(second,currentURL:url,expectedVersion:"1.0.0",expectedDocumentId:first.documentId))
  commitIfAllowed(second,version:"1.0.0");precondition(mutations==1)
  print("Native origin/document fence: remote selected/current/frame refused; unsupported major, stale same-origin navigation, changed live URL and old token refused before mutation; current document accepted")
 }
}
