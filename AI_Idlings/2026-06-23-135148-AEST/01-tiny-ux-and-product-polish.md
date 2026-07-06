# Tiny UX And Product Polish

Small changes that would make the app feel more coherent quickly.

## Lopu as the consistent narrator

- Add "Lopu noticed..." messages for recoverable problems, not just errors.
- Let Lopu offer one-click fixes for common local/dev states, such as missing
  env vars, disconnected MongoDB, stale Vercel token, or unverified email.
- Keep Lopu messages short, specific, and linked to the relevant tool page.

## Status surfaces

- Add a compact global "system health" popover: MongoDB, auth config, Vercel,
  Lopu AI quota, current user, and current deployment.
- Let each status row link to its deeper page: `/status`, `/vercel`, `/crypto`,
  `/profile`.
- Add "last checked" timestamps everywhere a status is cached.

## Crypto and identity helper polish

- Add "copy only public envs" and "copy Vercel private envs" buttons on
  `/crypto`.
- Add a JWKS preview panel and a "verify this JWT against Thingtime JWKS" mode.
- Add warnings when a private key is pasted into a public-key field.

## Vercel dashboard polish

- Cache the branch deployment list server-side and show cache age.
- Add a tiny "building now" live lane at the top when any branch is active.
- Add webhook support later so ready states do not require polling.

## Everyday user loops

- Give users a first useful "thing" on signup: a profile thing, notes thing,
  public links thing, and private scratchpad thing.
- Add a "copy public API link" affordance to any shareable thing.
- Add undo/restore for edits before adding more complex collaboration.
