# Feature maps

One short page per domain: where the code lives, which authorization helper
every read and write must go through, where the UI hooks in, what has to be
registered when you add something, and which tests prove it. Read the map for
the domain you are about to change **before** broad `graphify`/`rg`
exploration; update it in the same PR when you add a route, service module,
menu action, settings surface or test script.

Maps point at the canonical sources instead of repeating them:

- Non-negotiables and the data model: [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md)
- Manual regression checklists: [`TESTING.md`](../../TESTING.md)
- Endpoint contracts: the registry in `remix/app/docs/apiDocs.ts`, rendered at
  `/docs/api` and `/api/docs`; each entry's `-docs` twin serves it as JSON
- Owner decisions: [`DECISIONS.md`](../../DECISIONS.md)
- Repository AI instructions: [`AI_ALL.md`](../../AI_ALL.md)

| Domain | Map |
| --- | --- |
| Attachments, media pages, download-all archives, local storage stand-in | [attachments-and-media.md](attachments-and-media.md) |
| ACLs, hidden/unlisted links, custom audiences, shared compositions | [sharing-and-audiences.md](sharing-and-audiences.md) |
| Things CRUD, folders, `/things` page, transfer/export/import | [things-and-folders.md](things-and-folders.md) |
| Posts, comments, feed, reactions, PostCard | [posts-comments-and-feed.md](posts-comments-and-feed.md) |
| Adding or changing an API endpoint, capability manifests, rate limits | [api-endpoints-and-capabilities.md](api-endpoints-and-capabilities.md) |
| Thing context menu, PersistedThingMenu, Lopu toasts, icons, layering | [ui-shell-menus-and-design-system.md](ui-shell-menus-and-design-system.md) |
| Sessions, register/login, account roster, admins, upload approval | [auth-accounts-and-admin.md](auth-accounts-and-admin.md) |
| Worktrees, ports, PM2, env files, tests, Graphify, fixtures | [local-development-and-worktrees.md](local-development-and-worktrees.md) |

## Conventions used in every map

- Paths are relative to the repository root unless they start with `app/`,
  which means `remix/app/`.
- "Authorization helper" names the exact function a route or service must call;
  UI visibility is never authorization.
- "Registration" lists every place a new piece must be wired, in order.
- "Tests" lists the `npm --prefix remix run <script>` entry points and the
  `TESTING.md` section to extend.
