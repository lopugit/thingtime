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

## Validation

- `corepack pnpm --dir remix exec eslint app/docs/apiDocs.ts app/routes/docs/api.tsx app/routes/docs/index.tsx app/routes/docs/DocsLayout.tsx app/routes.tsx app/tests/api/apiTestRunner.ts app/tests/api/apiTests.ts 'server/routes/api/[...].ts' server/routes/api/root-data-docs.ts nitro.config.ts`
- `corepack pnpm --dir remix run build`
- Local docs matrix: 29 documented endpoints checked over `GET` and `POST`, 58 total checks, 0 failures.
- Browser checked `/docs/api` on desktop and mobile, including full-page scroll and filtered endpoint state.
- Browser checked `/tests` Docs group; 58 passed, 0 failed.
- Zero-env fallback checks cover the env detector, Nitro proxy helper, and live
  production-backed API responses from local fallback requests.

## Notes

- `remix/.env.auto` remained a local generated modification and was intentionally left out of the branch.
- Tailscale CLI was not available in this shell and the documented Funnel host did not resolve here, so local browser/runtime validation used `http://localhost:9999`.
