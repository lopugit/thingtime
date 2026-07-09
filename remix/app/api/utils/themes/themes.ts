import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import { resolveTheme, THINGTIME_THEME, TtTheme } from '../../../theme/tokens';
import { ensureIndexes, getThemesCollection, getUsersCollection } from '../mongodb/collections';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

// Canonical theme document (thingtime.themes). Themes are stored as the fully
// resolved, sanitized token document (see app/theme/tokens.ts) so a shared
// theme is always self-contained plain data — never functions or raw CSS.
export type ThemeDoc = {
  _id?: any;
  shareId: string; // public shareable id — the only id ever exposed
  ownerId: string; // users._id as string
  name: string;
  theme: TtTheme;
  visibility: 'private' | 'public';
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

// Safe shape returned to clients — never exposes _id/ownerId.
export type PublicTheme = {
  id: string;
  name: string;
  theme: TtTheme;
  visibility: 'private' | 'public';
  createdAt: string;
  updatedAt: string;
};

export const toPublicTheme = (doc: any): PublicTheme => ({
  id: doc.shareId,
  name: doc.name,
  theme: doc.theme,
  visibility: doc.visibility === 'public' ? 'public' : 'private',
  createdAt: new Date(doc.createdAt).toISOString(),
  updatedAt: new Date(doc.updatedAt).toISOString()
});

const MAX_THEMES_PER_USER = 100;

type SaveThemeInput = {
  id?: unknown;
  name?: unknown;
  theme?: unknown;
  visibility?: unknown;
};

type SaveResult =
  | { ok: false; status: number; error: string }
  | { ok: true; theme: PublicTheme };

// Create or update (when `id` is an owned theme's shareId) a saved theme.
export const saveTheme = async (ownerId: string, input: SaveThemeInput): Promise<SaveResult> => {
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 60) : '';
  if (!name) {
    return { ok: false, status: 400, error: 'Theme name is required' };
  }
  if (!input.theme || typeof input.theme !== 'object') {
    return { ok: false, status: 400, error: 'Theme tokens are required' };
  }

  // Sanitize by resolving the patch against the default theme — drops any
  // non-allowlisted keys and rejects unsafe CSS values.
  const theme = resolveTheme(THINGTIME_THEME, { ...(input.theme as object), name });
  // Only an explicit 'public' publishes; anything else stays/becomes private
  // (and updates that omit the field keep the existing visibility).
  const explicitVisibility =
    input.visibility === 'public' ? 'public' : input.visibility === 'private' ? 'private' : null;

  await ensureIndexes();
  const themes = await getThemesCollection();
  const now = new Date();

  if (typeof input.id === 'string' && input.id) {
    const existing = await themes.findOne({ shareId: input.id });
    if (!existing || String(existing.ownerId) !== ownerId) {
      return { ok: false, status: 404, error: 'Theme not found' };
    }
    const visibility = explicitVisibility ?? (existing.visibility === 'public' ? 'public' : 'private');
    await themes.updateOne(
      { _id: new ObjectId(existing._id) },
      { $set: { name, theme, visibility, schemaVersion: COLLECTION_SCHEMA_VERSIONS.themes, updatedAt: now } }
    );
    return { ok: true, theme: toPublicTheme({ ...existing, name, theme, visibility, updatedAt: now }) };
  }

  const visibility = explicitVisibility ?? 'private';

  const count = await themes.countDocuments({ ownerId });
  if (count >= MAX_THEMES_PER_USER) {
    return { ok: false, status: 400, error: `Theme limit reached (${MAX_THEMES_PER_USER})` };
  }

  const doc: ThemeDoc = {
    shareId: randomUUID(),
    ownerId,
    name,
    theme,
    visibility,
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.themes,
    createdAt: now,
    updatedAt: now
  };
  await themes.insertOne(doc as any);
  return { ok: true, theme: toPublicTheme(doc) };
};

export const listThemesForUser = async (ownerId: string): Promise<PublicTheme[]> => {
  const themes = await getThemesCollection();
  const docs = await themes.find({ ownerId }).sort({ updatedAt: -1 }).limit(MAX_THEMES_PER_USER).toArray();
  return docs.map(toPublicTheme);
};

// Public shared read — only returns public themes; 'not found' for private
// ones so their existence isn't revealed.
export const getSharedTheme = async (shareId: string): Promise<PublicTheme | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const themes = await getThemesCollection();
  const doc = await themes.findOne({ shareId: shareId.trim(), visibility: 'public' });
  return doc ? toPublicTheme(doc) : null;
};

// Owner read — a user can always fetch their own theme by id (any visibility).
export const getOwnedTheme = async (ownerId: string, shareId: string): Promise<PublicTheme | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const themes = await getThemesCollection();
  const doc = await themes.findOne({ shareId: shareId.trim(), ownerId });
  return doc ? toPublicTheme(doc) : null;
};

export const deleteTheme = async (
  ownerId: string,
  shareId: unknown
): Promise<{ ok: false; status: number; error: string } | { ok: true }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) {
    return { ok: false, status: 400, error: 'Theme id is required' };
  }
  const id = shareId.trim();
  const themes = await getThemesCollection();
  const res = await themes.deleteOne({ shareId: id, ownerId });
  if (!res.deletedCount) {
    return { ok: false, status: 404, error: 'Theme not found' };
  }
  // Don't leave the owner's active theme dangling at a deleted shareId.
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(ownerId), 'meta.activeThemeId': id },
    { $set: { 'meta.activeThemeId': null, updatedAt: new Date() } }
  );
  return { ok: true };
};
