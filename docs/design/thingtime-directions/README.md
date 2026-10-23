# 🧭 Thingtime — landing directions

Design exploration canvas: 8 landing-page directions (layout · hero · copy ·
demo idea), each with lettered options (1a, 1b, …).

## 1. `index.html` (recommended — zero setup)
Single self-contained file, works offline via `file://`. Built with
`../inline-dc.py`. No script logic in this design, so it renders fully even
in strict-CSP previews.

## 2. `Thingtime Directions.dc.html` (editable source)
Must be served with `support.js` and `ds/` from the same directory
(web server, not `file://`).
