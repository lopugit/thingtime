# Account mail settings native acceptance

One opt-in scenario passed with zero skips in 297.3 seconds on the isolated Linux
browser/backend package `e7427480e802ad274df4f1167443702e7e9534f2f05bc340a79691b513e9970c`.
The mail settings implementation was unchanged by subsequent file-copy and linked
attachment work. `build.json` pins the tested package; `isolation-verification.json`
records real browser/backend network denial and absence of host configuration.
A fresh generated server vault key enabled encrypted settings without inherited
credentials. The key, browser profile and database are excluded from these files.

The normal Email settings UI saved and cold-reloaded a synthetic account offline.
The test held a successful real server reply while a newer local edit completed,
then lost that reply and reloaded offline. The durable retry used the identical
write ID and request hash; the newer intent then produced the next server revision.
A second authenticated browser created a real stale-revision conflict. Both
reviewed conflict choices and guest read/write refusal were exercised. Screenshots
cover 1440, 390 and 320 pixels; the 320-pixel images were visually reviewed.

`final/verification.json` records responses 200, 200, 200 and 409, server revisions
1, 2 and 3, zero offline writes and zero page errors. No provider synchronization,
mail delivery or external provider connection was attempted. The first attempt
failed because the fixture targeted a hidden checkbox input; it is retained under
`first-attempt`. The passing fixture clicks the ordinary visible label and checks
the resulting state, without forced clicks or product changes.
