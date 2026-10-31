# PR 870 — Functional demo forms and controls

The first runtime release of the catalog functionality audit. It covers all
322 code-defined webpage demos and the 16 behavior / 2 app suites. The separate
2,800-component generator update is still in progress and is not included here.

Native forms now gather and validate values where the user sees the controls.
Actions retain confirmation, run with viewer authority, and show results in the
same component. Local scalar controls are isolated by component, page and viewer;
parent updates preserve them while identity changes reset them. Anonymous visitors
can use local controls; account operations retain their existing sign-in gate.

Site forms, site requests and catalog records create private Things. They do not
send messages, make purchases, schedule bookings or operate devices. External
effects require an owner-configured integration Action. Automatic dependency
installation uses `onlyMissing` and preserves customized Actions; explicit
installation refreshes definitions. Installed pages use the owner's component ids.

## Validation — 2026-09-21

- 201 schema tests; 114 Action tests (1 intentional skip); 72 capability tests.
- Webpage suite: 102 passes, 2 intentional skips.
- Real HTTP integration: suite install, native Action execution, private record
  visibility, customized Action preservation and explicit refresh, concrete page
  bindings, invalid option rejection and fixture cleanup all passed.
- Full production build and Vercel output/capability verification passed after
  merging main's remote integration runtime (PR 866).
- Targeted ESLint: no errors, two existing template-string warnings.
- Full TypeScript check retains baseline errors outside the changed surfaces.
- Chrome at desktop and phone widths: guestbook and contact records, invalid
  email rejection, Action confirmation, template copy, independent local controls,
  checkbox/range/counter synchronization, reset, native disclosures and real video
  playback. A nonempty-string conditional initially hid the video; its explicit
  empty-URL condition is now covered by a regression.

Native dialogs and countdowns were added during catalog acceptance: dialogs keep
Action delegation inside the component DOM and use native focus/Escape handling;
countdowns use elapsed time with bounded duration and interval cleanup. Chrome
verified desktop/mobile dialog opening, nested local Actions, Escape focus return
and countdown completion. Two clock-boundary tests passed.

## Local acceptance environment

Worktree PM2 name: `tt-wt-functional-demos-19970`, autorestart disabled.
Web: http://localhost:19970 — HMR 19971, Nitro 19972. The ignored worktree
PM2 config overrides the basename-derived ports to avoid another checkout.
Tailscale Funnel is unavailable: its installed CLI shim points to the missing
`/Applications/Tailscale.app/Contents/MacOS/tailscale` executable.

PR checks carry the current Vercel preview/deployment status. Production and
catalog seeding must be verified separately after the runtime merge.
