# Independent posting and drafts — final integrated package

The native fixture passed both directions on package
`2f0710ac20e67675e56271dd5607a7a32c2e038853e40ebd62dbf40c9e310e59`.
The [report](integrated-final/verification.json), [browser log](integrated-final/browser.log),
[build](integrated-final/build.json) and [isolation proof](integrated-final/isolation.json)
record one actual browser test, zero skips, with screenshots at 1440/390/320px.

- An offline private draft survives cold reload. Its actual account save is held;
  a private post reaches the real API before the draft response is released as 503.
  Draft retirement later converges and a separate template remains intact.
- A second private post is held while a different working draft saves through the
  normal composer and reaches the real API. Releasing the post with 503 triggers
  an identical request retry; owner listing finds exactly one post with that ID.
  The working draft remains exact after retry and cold reload. Guest reads fail.

No browser errors or offline mutation requests occurred. The first integrated
attempt is preserved in `integrated-first-attempt/`: its 40-second retirement
wait ended while the existing 60-second durable draft claim could still be live.
Only that fixture wait was raised to a bounded 90 seconds; product timing and
queue behavior were unchanged. Earlier core evidence remains in `final-core/`.
