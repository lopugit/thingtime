# 🌈 Thingtime — Claude prototype landing page

Two ways to serve it:

## 1. `index.html` (recommended — zero setup)
A single self-contained file: React, fonts, and runtime are all inlined.
Works offline, no dependencies. Drop it anywhere (e.g. `public/`, GitHub Pages,
Vercel static) and it just serves.

## 2. `source/` (editable source)
`Thingtime.dc.html` + `support.js` must be served **together from the same
directory** (open via a web server, not file://). React loads from unpkg at
runtime, so this variant needs network access.

Everything interactive is real: the Aa/`{ }` reader–developer view switch,
🎨 edit mode, the ⋯ / 🧙‍♂️ options menus, ⌘P commander (try `Total spent = 600`),
and Lopu's toasts. 🦄
