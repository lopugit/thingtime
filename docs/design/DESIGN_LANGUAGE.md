# 🌈 Thingtime Design Language

Canonical token spec extracted from the two Claude Design mockups. This is the
single source of truth for the 2026 design refactor. Components read these as
CSS custom properties (`--tt-*`) via the runtime theme provider, so user themes
can override everything.

Sources:
- `docs/design/claude-design-mockup-v2-fable/Thingtime Landing.dc.html` — the
  **landing page** (neo-brutalist "Fable" look). The front page must match it.
- `docs/design/claude-design-mockup-v1/source/Thingtime.dc.html` — the
  **product UI** ("Prism" look: refined/premium, rainbow accents).

## Shared rainbow palette

The five-stop rainbow used everywhere (gradients, voxel logo, depth guides):

| Token | Hex | Name |
|---|---|---|
| `--tt-rainbow-1` | `#f34a4a` | red |
| `--tt-rainbow-2` | `#ffbc48` | amber |
| `--tt-rainbow-3` | `#58ca70` | green |
| `--tt-rainbow-4` | `#47b5e6` | blue |
| `--tt-rainbow-5` | `#a555e8` | purple |

- Text gradient: `linear-gradient(90deg, #f34a4a, #ffbc48, #58ca70, #47b5e6, #a555e8, #f34a4a)`
  with `background-size: 200% auto` + `animation: tt-pan 7s linear infinite`
  (v2 uses `moving-rainbow 5s` with `background-size: calc(100px + 200%)` — same effect).
- Border gradient (toasts, campaign card, commander):
  `linear-gradient(120deg, #47b5e6, #a555e8, #f34a4a, #ffbc48, #58ca70, #47b5e6)`.
- Extended accent dots (v2 demo/confetti): `#59ff9c #59bdff #00b7ef #ed1c24 #ffa3b1 #6f3198 #a8e61d #ffc20e #ff7e00 hotpink`.

## Voxel logo

3×3 grid, plus-shape, one rainbow color per filled cell:

```
       .  blue(#47b5e6)  .
 green(#58ca70) amber(#ffbc48) purple(#a555e8)
       .  red(#f34a4a)   .
```

v1 renders it as a small rounded chip (6px cells, 1.6px gap, white card,
1px `#ececef` border, radius 8, subtle shadow). v2 renders it as chunky voxels
(`voxel-size` 6–15px, no gap, square). Build one `VoxelLogo` component with
`size` + `variant`.

## Prism (v1) — product UI tokens

| Group | Token | Value |
|---|---|---|
| Ink | `--tt-ink` | `#16161a` |
| Body text | `--tt-text` | `#5a5a66` |
| Muted | `--tt-muted` | `#9a9aa6` |
| Faint | `--tt-faint` | `#b6b6c0` |
| Border | `--tt-border` | `#ececef` |
| Border light | `--tt-border-light` | `#f0f0f2` |
| Surface | `--tt-surface` | `#fafafb` |
| Surface alt | `--tt-surface-alt` | `#f5f5f7` |
| Card | `--tt-card` | `#ffffff` |
| Link/url value | | `#2f8fd6` |
| Positive | | `#2f8f4f` on `rgba(88,202,112,.14)` pill |
| Danger | | `#d6455a` |
| Dark panel | | bg `#16161c`, chrome `#1c1c22`, border `#23232b`, text `#e6e6ee`, muted `#7a7a88` |

- **Fonts**: headings/UI `'Space Grotesk'` (600/700, letter-spacing −.02…−.035em);
  body `'Hanken Grotesk'` (400–800); mono/labels/keys `'JetBrains Mono'` (400–600).
  Load via Google Fonts.
- **Radii**: chips/inputs 7–9px · cards/buttons 10–12px · panels 16–20px ·
  hero cards 23–26px · pills `999px`.
- **Shadows** (soft): card `0 1px 2px rgba(0,0,0,.05)` · panel
  `0 24px 60px -28px rgba(20,20,40,.28)` · popover `0 16px 40px -12px rgba(20,20,40,.3)` ·
  toast `0 14px 38px rgba(20,20,40,.18)`.
- **Buttons**: primary = `#16161a` bg, white text, radius 11, `0 6px 20px rgba(0,0,0,.16)`;
  secondary = white bg, `1px solid #e2e2e6`; rainbow CTA = gradient bg, radius 12.
- **Section eyebrows**: `600 12px JetBrains Mono`, `letter-spacing:.16em`, color muted.
- **Kbd chips**: mono 11px, white bg, 1px border, radius 6, `2px 6px` padding.
- **Segmented controls**: container `#f1f1f3` radius 11 pad 4; active segment white,
  1px `#ececef` border, radius 9, tiny shadow; inactive transparent + muted text.
- **Tree rows** (developer view): type chip 26×26 radius 8 bg `#f4f4f6` with emoji
  (📦 object · 📚 array · 💬 string · 💯 number · 🌗 boolean · ❓ null); key label in
  mono 13px muted; count pill mono 11.5px bg `#f6f6f8`; depth guides
  `2px solid rgba(rainbow[depth % 5], .34)` (alpha .16 subtle / .34 balanced / .6 vivid);
  hover reveals ⋯ (reader) / 🧙‍♂️ (developer) wizard menu (radius 12 popover).
- **Reader view**: keys as Space Grotesk headings (21/17/15px by depth), values as
  16px Hanken Grotesk; booleans "Yes/No"; edit mode = borderless inputs with
  `1px dashed #d0d0d8` underline; money keys (`cost|price|spent|rental|total`) get `$`.
- **Lopu toast**: 360px card, 2px rainbow-gradient border wrap (radius 18 outer/16 inner),
  🦄 + gradient-text "Lopu" + "Thingtime AI", title 13.5px/600, desc 12px muted,
  `tt-toast-in 260ms cubic-bezier(.2,.9,.3,1)`, top-center below nav.
- **Commander (⌘P)**: overlay `rgba(18,18,28,.32)` + blur(4px); panel min(560px,94vw)
  radius 16 with 3px rainbow-gradient top border wrap; 🔮 input 16.5px; results with
  emoji + mono path + preview; `esc` chip.
- **Nav**: fixed, `rgba(255,255,255,.78)` + `blur(14px)`, bottom border light;
  center search/imagine pill (`#f5f5f7`, radius 10, "Imagine…", ⌘P chip).
- **Motion**: `tt-pan` (gradient panning), `tt-pop` 180ms, `tt-toast-in` 260ms,
  `tt-bob` 2.4s, transitions ~140–160ms ease.

## Fable (v2) — landing page tokens

| Group | Value |
|---|---|
| Ink / borders | `#1a1a1a` |
| Body text | `#4b4b4b` |
| Muted | `#8a8a8a` (also `#6b6b6b`, faint `#9a9a9a`, disabled `#c9c9c9`) |
| Hairline | `#ececec` (section dividers), row hover `#fafafa` |
| Accent CTA | `hotpink` (bg) / `#fff5fa` (tint) |
| Purple accent | `#6f3198` (eyebrows, FAQ ±, leaf keys) |
| Dev section | bg `#131318`, code bg `#0b0b0f`, border `#2a2a33`/`#3a3a44`, text `#b9b9c3`, green `#59ff9c` |
| Code colors | keys `#59bdff`, strings `#59ff9c`, numbers `#ffc20e`, punctuation `#8a8a95`, prompt `hotpink` |

- **Fonts**: system stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial`),
  weights 800/900, tight letter-spacing (−0.03…−0.04em). Hero:
  `clamp(44px, 7vw, 74px)`; h2 `clamp(32px, 4vw, 44px)`; giant `clamp(40px, 6vw, 64px)`.
- **Structure**: radius **0** everywhere; borders `3px solid #1a1a1a` (2px for small
  chips/tiers); hard offset shadows `5px 5px 0 #1a1a1a` (buttons) and
  `8px 8px 0 #1a1a1a` (feature cards); button hover:
  `transform: translate(-2px,-2px)` + shadow grows to `8px 8px 0`.
- **CTAs**: hotpink bg, white 800 text, 3px ink border + hard shadow; secondary =
  white bg, ink text, 3px border (hover `#fff5fa`).
- **Sticky nav**: `rgba(255,255,255,.94)` + blur(8px), 1px `#ececec` bottom border,
  voxel logo + lowercase bold "thingtime", 14px/600 links, black "Open the app" button.
- **Sections** (in order, each `padding: 72px 24px`, 1px `#ececec` top divider):
  1. **Hero**: big voxel logo, "A *GUI for the internet*." (animated rainbow gradient
     on the phrase), sub copy, waitlist email + hotpink "Join the waitlist 🚀"
     (3px border input; success = bordered `#fff5fa` card "You're in! 💖"),
     "WORKS EVERYWHERE" chips (🌐 Web · 📱 iOS · ⌨️ Raycast · 🔌 API).
  2. **Live demo**: split; left = LIVE DEMO eyebrow (purple), "Your stuff, structured.",
     bullets with colored square dots, hotpink "Open the full app ✨"; right =
     mac-window card (3px border, 8px shadow, traffic-light squares, mono path
     `tt · user.car`) holding an editable thing tree (carets, count pills, colored
     leaf dots, purple keys, dashed-underline hover values, × delete,
     dashed "＋ add a thing…" input at the bottom → confetti burst).
  3. **Use cases**: giant headline "Everything *is a thing.*" (rainbow phrase),
     rows separated by 2px ink rules: colored square + bold 21px title (🚗 car,
     🛠️ drill, 📝 ideas) + body copy.
  4. **Ecosystem**: "One brain. Every surface." + centered cards (210px, 3px border):
     🌐 Web / 📱 iOS / [voxel logo card w/ shadow] / ⌨️ Raycast / 🔌 API.
  5. **Developers** (dark `#131318`): green eyebrow, "One API. Every shape.",
     curl→JSON code card + white "same thing, as a GUI" card, green→arrow between;
     green "Read the docs" + outlined "Get an API key" buttons.
  6. **Back us**: purple eyebrow BACK THE LAUNCH, "Help us launch the GUI for the
     internet 💖", bullets, hotpink Indiegogo + white GoFundMe buttons (confetti
     on click); right card = rainbow progress bar (animated), `$12,438 of $20,000`,
     `148 backers · 21 days left · 🦄 12 unicorns`, reward tiers ($25 stickers /
     $60 merch / $150 unicorn tier in hotpink border + `#fff5fa`).
  7. **FAQ**: "Questions 🦄", accordion rows split by 2px ink rules, ＋/− toggle in purple.
  8. **Footer**: small voxel logo, links row, `🚀 🌈 ✨ 🦄 💖`, copyright line
     "data should be open, accessible, and empowering".
- **Confetti**: full-viewport fixed canvas, square particles (7/9/11px) in the
  extended palette, gravity + sway, bursts on waitlist join / add-thing / back-us
  clicks. Respect `prefers-reduced-motion`.

## Theming system contract

Every visual property above maps to a `--tt-*` CSS custom property set by the
`ThemeProvider`. A **theme** is a JSON document:

```jsonc
{
  "name": "Fable",
  "colors": { "ink": "#1a1a1a", "text": "#4b4b4b", "muted": "#8a8a8a",
    "border": "#ececec", "surface": "#fafafb", "card": "#ffffff",
    "accent": "hotpink", "accentTint": "#fff5fa",
    "rainbow": ["#f34a4a", "#ffbc48", "#58ca70", "#47b5e6", "#a555e8"] },
  "fonts": { "heading": "Space Grotesk", "body": "Hanken Grotesk", "mono": "JetBrains Mono" },
  "general": { "radiusScale": 1, "borderWidth": 1, "shadow": "soft" | "hard",
    "motion": true, "mode": "light" }
}
```

Built-in presets: **Fable** (v2 landing look: radius 0, 3px borders, hard
shadows, system font, hotpink) and **Prism** (v1 product look: soft radii,
1px borders, soft shadows, Space Grotesk/Hanken Grotesk). Users can edit any
token, save named themes through the API, share them by id, and apply themes
from the gallery.
