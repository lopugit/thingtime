# Synthetic HEIC fixture

`photo.HEIC` is a generated 640×480 smiley (no personal image or metadata).
Created for Thingtime regression tests from simple SVG shapes, rasterized with
Sharp and encoded by macOS `sips -s format heic`. Open the development-only
`/scripts/heic-upload.browser.html` harness to exercise the real decoder and
shared queue. HTTP/storage are fake and no test content is published.
