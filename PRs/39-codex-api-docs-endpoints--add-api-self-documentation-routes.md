# PR 39: Add API self-documentation routes

Branch: `codex/api-docs-endpoints`
PR: https://github.com/lopugit/thingtime/pull/39

## Summary

- Added a shared API documentation registry for the current Thingtime API endpoints.
- Exposed `GET` and `POST` docs helpers by appending `-docs` to each API endpoint, including `/api/root-data-docs`.
- Added `/docs/api` as a browsable API reference with endpoint details, steps, payload examples, response examples, and curl/wget/node/python/ruby snippets.
- Added generated Docs group smoke tests to `/tests`.
- Updated Nitro route config so the new docs routes are explicitly registered.
- Added zero-env API fallback so fresh local/sandbox runs proxy same-origin API
  calls to `https://thingtime.com` when MongoDB/auth env is absent.
- Converted `/docs/api` platform examples into a tabbed code view and made all
  docs snippets share the homepage developer-block styling.
- Added grouped `/docs/api` drawer navigation so every documented endpoint has
  a deep-linkable submenu item under its API group, with matching grouped
  sections in the page body and side index.
- Added dedicated `/docs/api/:group` category pages and
  `/docs/api/:group/:docId` endpoint pages; the copy-link icon now copies a
  route appropriate to the current view while preserving the global
  `/docs/api#api-*` deeplink behavior.

## Validation

- `corepack pnpm --dir remix exec eslint app/docs/apiDocs.ts app/routes/docs/api.tsx app/routes/docs/index.tsx app/routes/docs/DocsLayout.tsx app/routes.tsx app/tests/api/apiTestRunner.ts app/tests/api/apiTests.ts 'server/routes/api/[...].ts' server/routes/api/root-data-docs.ts nitro.config.ts`
- `corepack pnpm --dir remix run build`
- Local docs matrix: 29 documented endpoints checked over `GET` and `POST`, 58 total checks, 0 failures.
- Browser checked `/docs/api` on desktop and mobile, including full-page scroll and filtered endpoint state.
- Browser checked `/tests` Docs group; 58 passed, 0 failed.
- Zero-env fallback checks cover the env detector, Nitro proxy helper, and live
  production-backed API responses from local fallback requests.
- Browser checked the `/docs/api` tabbed examples on desktop and mobile,
  including switching the visible platform tab.
- Browser checked the grouped `/docs/api` drawer on desktop and at 390px mobile:
  endpoint links render under group headings, the service-account link updates
  the URL to `#api-auth-service-account` and scrolls to the correct card, and
  no horizontal overflow appears.
- Browser checked `/docs/api`, `/docs/api/auth`, and
  `/docs/api/auth/auth-service-account`; dynamic copy links produced the global
  hash URL, category hash URL, and dedicated endpoint URL respectively.

## Notes

- `remix/.env.auto` remained a local generated modification and was intentionally left out of the branch.
- Tailscale CLI was not available in this shell and the documented Funnel host did not resolve here, so local browser/runtime validation used `http://localhost:9999`.
