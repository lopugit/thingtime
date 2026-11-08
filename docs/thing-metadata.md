# Thing metadata

Thing pages show **File data** and **Thing data** near the top. File data counts
the verified original attachment bytes; Thing data measures the canonical
UTF-8 JSON of the editable `crystal`, `extended` and `tags` payload. System
envelope fields and generated metadata are excluded, matching logical Thing
storage accounting. These are separate measures: a multi-gigabyte scan can have
a small JSON record pointing to its large attachment. Decimal KB, MB and GB
choose the nearest useful unit; Details retains exact byte counts.

`api.things-metadata` 1.0.0 exposes `GET /api/v1/things/metadata?id=<source>`
for current authorized measurements. The same-origin, bodyless POST persists or
rebuilds a protected `thing-metadata` reference for an owning full session.
The reference has its own stable ID and explicit embedded Component. Its
source's protected reference is outside the measured payload, so rebuilding
does not change the content hash, modification time or Timeline.

SHA-256 is streamed over canonical JSON version 1, using recursively sorted
object keys and preserving array order, Unicode and the existing Thing codec.
This is a Thingtime format version, not a claim of RFC 8785 compatibility for
every extended Thing value. File sizes come from protected ready attachment
records with exact-version checks, never an arbitrary authored `size` field.
Unknown or unauthorized attachments remain explicitly unavailable. Neither
measurement recursively adds the content of referenced Things.

Ordinary Things and stable File roots support durable metadata references.
Protected services with independent deletion lifecycles currently show live
measurements only. External data planes are read-only for metadata persistence.
Saved metadata exact reads reauthorize their source and recompute current facts;
generic CRUD, discovery and Timeline cannot mutate or expose these derived rows.
Ordinary source deletion drains its metadata through the existing cascade.

The panel is composed of individually editable Builder blocks. Use **Edit
metadata layout** to change labels, controls and arrangement. There is no
additional server setup or secret. Forks use the ordinary API/database and
attachment configuration; missing capability negotiation shows an actionable
unavailable state instead of guessing support.

Validation: `test:thing-metadata` covers deterministic measurement and client
fencing; `test:thing-metadata:integration` uses real API handlers with a fresh
Mongo replica and checksum-verified local object bytes. Add `--browser` to the
runner to exercise actual Thing pages and Builder edits in isolated Chromium.
`TT_PLAYWRIGHT_MODULE` can select an installed Playwright module; no personal
browser profile, credentials or database is reused.
