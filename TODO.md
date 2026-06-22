# TODO

1. **URGENT HIGH PRIORITY: Make true `hydrateRoot(document, ...)` merge-ready.**

   True `hydrateRoot(document, ...)` is not merge-ready yet. Local testing caused full-document hydration mismatch and unstyled output because the server-injected Emotion `<head>` styles are not represented in the client React document tree.

   The current PR fix is safer for stability: it avoids stale Emotion style-node insertion failures while preserving styling. A deeper hydrate migration should make Emotion's SSR styles part of the client-rendered document contract before switching the app back to true document hydration.
