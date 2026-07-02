# 🎉 Thingtime — launch celebration page

Two ways to view it:

## 1. `index.html` (recommended — zero setup)
Single self-contained file: `support.js`, React, and the Thingtime DS bundle
(`tt-logo`, `tt-attention`) are all inlined. Works offline via `file://`.
Scripts load once in `<head>` (React → DS bundle → tt-elements → support.js),
which also avoids the double-React mount errors the source variant logs.

## 2. `Thingtime Launch Celebration.dc.html` (editable source)
Must be served with `support.js` and `ds/` from the same directory
(web server, not `file://`).

Click anywhere for confetti. 🦄
