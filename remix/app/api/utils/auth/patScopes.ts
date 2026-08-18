// Personal-access-token scope catalog — a PURE module (no Mongo/server
// imports) so both the server enforcement path (auth/patTokens.ts) and the
// Settings token-minter permissions selector import the same source of truth.
// Path semantics mirror apps/scopes.ts: a scope is a dot path and an ancestor
// covers every descendant ('things' covers 'things.create').

export type PatScopeDescriptor = {
  id: string; // dot path, e.g. 'things.create' — ancestors cover descendants
  title: string;
  description: string;
  emoji: string;
};

// The catalog — ordered as the settings permissions selector lists them.
// Extending the surface = adding a leaf here plus a resolveThingsActor gate in
// the route that serves it.
export const PAT_SCOPE_CATALOG: PatScopeDescriptor[] = [
  {
    id: 'things',
    title: 'Full things access',
    description: 'Everything below — read, create, update, delete, comment, react, save, share.',
    emoji: '🗝️'
  },
  {
    id: 'things.read',
    title: 'Read & scan',
    description: 'List, get, search and browse your things, feed, and recent reactions.',
    emoji: '🔍'
  },
  {
    id: 'things.create',
    title: 'Create',
    description: 'Push new things — posts, data things, anything with a crystal.',
    emoji: '✨'
  },
  {
    id: 'things.update',
    title: 'Update',
    description: 'Edit existing things (PATCH). Upserts (PUT) also need Create.',
    emoji: '✏️'
  },
  {
    id: 'things.delete',
    title: 'Delete',
    description: 'Delete owned things.',
    emoji: '🗑️'
  },
  {
    id: 'things.comment',
    title: 'Comment',
    description: 'Comment on visible things.',
    emoji: '💬'
  },
  {
    id: 'things.react',
    title: 'React',
    description: 'Add and remove reactions.',
    emoji: '❤️'
  },
  {
    id: 'things.save',
    title: 'Save',
    description: 'Toggle library saves on visible things.',
    emoji: '🔖'
  },
  {
    id: 'things.vote',
    title: 'Vote',
    description: 'Cast, move, or remove poll votes on visible polls.',
    emoji: '🗳️'
  },
  {
    id: 'things.share',
    title: 'Share',
    description: 'Repost visible things as shares.',
    emoji: '📣'
  }
];

const CATALOG_BY_ID = new Map(PAT_SCOPE_CATALOG.map((scope) => [scope.id, scope]));

export const PAT_SCOPE_IDS = PAT_SCOPE_CATALOG.map((scope) => scope.id);

export const isKnownPatScope = (value: unknown): value is string =>
  typeof value === 'string' && CATALOG_BY_ID.has(value);

// One scope covering one path: exact match or ancestor ('things' covers
// 'things.create').
const coversPath = (scope: string, path: string): boolean =>
  scope === path || path.startsWith(`${scope}.`);

export const patScopeCovers = (granted: string[], path: string): boolean =>
  granted.some((scope) => coversPath(scope, path));
