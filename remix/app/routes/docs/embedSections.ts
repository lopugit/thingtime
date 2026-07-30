// The "Login with Thingtime" guide's section spine — ids, titles, and the
// searchable blurb — shared by the page (routes/docs/embed.tsx renders every
// section heading + anchor from this) and the docs search index
// (routes/docs/docsSearchIndex.ts), so titles, anchors, and search results can
// never drift apart. Section BODIES stay hand-crafted JSX in embed.tsx; when a
// section's prose meaningfully changes, update its blurb here in the same
// edit.

export type EmbedGuideSection = {
  id: string;
  title: string;
  // searchable summary of the section's on-page content
  blurb: string;
};

// Keyed for type-safe access from embed.tsx; the ordered array below feeds
// the search index.
export const embedGuideSection = {
  registerYourApp: {
    id: 'register-your-app',
    title: '1 · Register your app',
    blurb:
      'Register an app with a name and the exact https origins your site runs on; the server mints ' +
      'your public clientId. The login popup only hands tokens to origins on the allowlist. Manage ' +
      'apps with GET /api/v1/apps, /api/v1/apps/update, and /api/v1/apps/delete — deleting an app ' +
      'revokes every token it minted.'
  },
  dropInTheButton: {
    id: 'drop-in-the-button',
    title: '2 · Drop in the button',
    blurb:
      'Load the SDK script and render the styled login button, or call Thingtime.login({ clientId, ' +
      'scopes, optionalScopes }) from a click handler. While building, sandbox: true runs the full ' +
      'consent UI for any clientId and hands back a real working sandbox token against a pretend ' +
      'account. Headless (scripts, AIs, CI): POST /api/v1/oauth/sandbox mints the same token ' +
      'anonymously. Sandbox spaces: mint several tokens with the same space and distinct usernames ' +
      'to rehearse the multi-user shared feed.'
  },
  livePreview: {
    id: 'live-preview',
    title: 'Live preview',
    blurb:
      'The quick-start snippet rendered for real — pick a theme and size, click the button to open ' +
      'the sandbox login popup and walk the whole consent flow.'
  },
  permissionsScopes: {
    id: 'permissions-scopes',
    title: '3 · Permissions (scopes)',
    blurb:
      'Scopes are hierarchical dot paths over the user data: profile.username, profile.displayName, ' +
      'profile.avatar, profile.bio, profile.banner, profile, email, app-data, app-data.shared, ' +
      'things. Required scopes are a floor the user cannot untick; optionalScopes they decide on; ' +
      'unless allowExtra: false the user can volunteer more. Live catalog: GET /api/v1/oauth/scopes.'
  },
  useTheToken: {
    id: 'use-the-token',
    title: '4 · Use the token',
    blurb:
      'Identity SSO: resolve who the token belongs to via /api/v1/oauth/userinfo, from your site JS ' +
      'or your server. Shared things: read the things the user hand-picked via /oauth/shared, ' +
      'read-only. App storage: keep per-user data (settings, saves, progress) in /api/v1/app-data — ' +
      'your app can only ever see its own keys.'
  },
  securityModel: {
    id: 'security-model',
    title: 'Security model',
    blurb:
      'App tokens are revocable Thingtime sessions scoped to your app — rejected by every normal ' +
      'endpoint. The popup hands the token via postMessage locked to your registered origin; browser ' +
      'calls are CORS-bound. Grants are revocable from both sides: /api/v1/apps/delete or ' +
      '/api/v1/oauth/grants/revoke. The token is a bearer credential — treat it like a secret.'
  },
  tryIt: {
    id: 'try-it',
    title: 'Try it',
    blurb:
      'A live playground ships at /sdk/demo.html — sandbox mode out of the box; register an app ' +
      'with that origin and paste your real ttapp_ clientId to run the same loop live.'
  }
} satisfies Record<string, EmbedGuideSection>;

export const embedGuideSections: EmbedGuideSection[] = Object.values(embedGuideSection);
