# PR 1413: Continue prepared iOS Photos uploads in background

The reported starting state was zero operations followed by Retry. The saved
Wi-Fi-only policy explained a potential wait on the reported cellular path;
the old scan also stopped at any original absent from local storage. The
historical TestFlight failure could not be recovered from the screenshot.

iOS now uploads the locally available originals first and records explicit gaps
for cloud-only originals, including companion resources. If the saved
connection allows cellular, a bounded PhotoKit export retrieves original bytes,
and the same journal verifies and publishes each successive batch. PhotoKit
offers no Wi-Fi-only control for this network request, so Wi-Fi-only keeps
these originals pending with recovery instructions. Limited permission covers
selected assets only. No setting changes automatically.

Once exact source and destination versions are sealed, the foreground runner
admits up to four prepared files. An iOS processing task can advance that queue
without the WebView. Each native checkpoint retains its original request ID,
reservation and confirmed parts; Pause disarms the queue, and a failed disarm
write prevents in-process scheduling until fresh verified recovery. Ready
attachments stay unbound until foreground confirmation writes folder and
Timeline receipts. Discovery, preparation and admission refill still require
the app. The local inventory is still sealed before the first planned upload.

The installed simulator run used ordinary Photos permission and a disposable
API, database and file store. After injected expiry and with WebView uploads
held, four originals (five parts, 15,218,178 bytes) reached independent
byte/hash verification, with no folder or Timeline publication. Reopen
published the exact four attachments plus five more (nine originals,
41,282,425 bytes) and retry preserved all nine revisions. This tests the native
queue and reopen path; the simulator rejected actual BGProcessing scheduling.
A physical iPhone wake or lock test and real iCloud-only provider retrieval
remain unverified. Focused tests cover scheduler refusal, Pause persistence
failure, exact multipart identity, cloud batches and grant changes.

Graphify's scoped semantic pass timed out; the portable snapshot and HTML
were refreshed structurally. New and edited Markdown was not fully indexed.
