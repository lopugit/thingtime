# PR #1447 — Shared image presentation and standards inspector

The upload-first picker now opens an image editor for profile avatars and banners
and subspace icons and banners. Its framing controls and shared CSS and HTML
attribute inspector save presentation beside the source, leaving the original
bytes untouched. A presentation-only save or reset from the UI carries the
effective image URL that the editor saw; a replacement returns a 409 instead of
receiving the stale edit. The image renderer clips to its own frame, and only the
existing validated source may load media.

Builder uses the same property and attribute inputs. Standards suggestions are
generated from the pinned inventory, with free typing for declarations and HTML
markup. Ordinary authored CSS is present in initial markup. CSSOM applies
priority and complex values without interpolating additional declarations.
Passive HTML attributes, default values, and multiple-select Action inputs
retain their normal rendering and validation boundaries.

- The final source passed 167 focused profile, subspace, Builder, renderer, and
  sharing tests and 164 capability tests. TypeScript, changed-file lint, and
  the client and Nitro server builds also passed.
- Desktop and phone acceptance exercised actual profile, Settings, subspace and
  Builder saves and reloads against isolated replicas. It verified stale-source
  refusal, source-preserving resets, raw CSS Apply, byte-identical uploaded PNG
  content, independent public rendering, post and Messenger avatars, and exact
  account roster readback.
- Run the disposable profile fixture with
  `IMAGE_PRESENTATION_EVIDENCE_DIR=<outside-checkout> node remix/scripts/image-presentation-acceptance.mjs`
  after a node-server Nitro build. It checks the exact replica identity before
  writing fixtures. See [TESTING](../TESTING.md#profile-avatar-and-banner-media-remixappcomponentsprofile)
  for the manual checklist.

The branch also integrates authored selection, keyed collections, and owner
library archive from main. Things 1.61.0, Things-update 1.26.0, and Webpages
resolve 1.18.0 distinguish expanded authoring from the source input reference
contracts now available to the Agent overview.
Things Search 1.6.0 adds optional avatar presentation alongside archive
filtering. Existing archive callers still accept their original minimum
versions. The selection merge passed 104 renderer, schema, Action, and
isolated Chrome regression tests.

The required build check exposed missing initial wrapping styles in the custom
drawer. The existing wrapping assertions now pass, and a new renderer test
covers ordinary and Unicode declarations, vendor names, and exclusion of
unsafe style attribute content. The continued CI suite also caught a change
to the object shape returned by CSS validation. The validator preserves plain
CSS records so authored demos and behavior suites round trip unchanged.
The workspace renderer test fixture now implements the same child and sibling
traversal as the browser DOM, retaining its live versus inert assertions.
The shared image renderer screens URL schemes at the image boundary and encodes
literal angle brackets and double quotes without changing stored sources,
existing URL escapes, or signed query parameters.

The portable Graphify snapshot was refreshed structurally. The local semantic
proxy did not finish the scoped document refresh within the task budget, so
changed documentation was not semantically reindexed.
