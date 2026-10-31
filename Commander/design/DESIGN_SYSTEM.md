# Commander visual system

Source references: the three Raycast screenshots supplied with the build request and the generated Commander
concept `commander-concept.png`.

## Direction

- Recognizable launcher skeleton: prominent search field, quiet section label, full-width result rows, selected
  row, trailing command metadata, and a compact actions sheet.
- Settings uses a native desktop toolbar rhythm, shallow hierarchy, crisp grouped rows, and no dashboard cards.
- System typography: `-apple-system`, BlinkMacSystemFont, `Segoe UI`, then sans-serif.
- Neutral adaptive surfaces. Color is reserved for the Commander mark, focused controls, selection edge, and
  state confirmation.

## Tokens

- Light background `#f6f6f7`; light surface `rgba(255,255,255,.84)`; primary text `#151518`.
- Dark background `#17171a`; dark surface `rgba(35,35,39,.88)`; primary text `#f7f7f8`.
- Hairline border uses the current foreground at 9–12% opacity.
- Accent endpoints: violet `#7657ff`, cyan `#52c7ff`.
- Radius: 18px window, 12px row/panel, 8px compact control.
- Type: 30px search, 16px primary row, 13px metadata, 12px section label.
- Motion: 120–180ms; opacity/translate only; respect reduced motion.

## Interaction inventory

- Up/Down changes selection; Return runs the primary action; Escape closes the actions sheet then launcher.
- Command-K opens the actions sheet for the selected result.
- Hover and pointer selection mirror keyboard selection.
- Settings tabs are always visible and keyboard reachable.
- Compact mode reduces window height and result density, not typography legibility.
