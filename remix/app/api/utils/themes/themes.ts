import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

import { resolveTheme, THINGTIME_THEME, TtTheme } from '../../../theme/tokens';
// theme is a PROTECTED system kind: theme things stay on the home deployment
// DB even while a data-plane endpoint override is active (see endpoint.ts).
import { getHomeThingsCollection as getThingsCollection, getThemesCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { ACL_ALL, ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { clearUserActiveTheme } from '../auth/users';
import { StorageMutationError, USER_STORAGE_ACCOUNTING_VERSION, currentContentStorageSizeBytes, thingStorageSizeBytes } from '../storage/storageCore';
import { applyUserStorageDelta, markUserStorageNeedsReconcile, readyUserStorageMatch } from '../storage/userStorage';

// Themes are THINGS now (thingtime ["theme"], see
// TODO/claude-todo/22-everything-is-a-thing-collections.md): the resolved,
// sanitized token document (see app/theme/tokens.ts) lives in crystal as
// { name, theme }, and the legacy visibility enum maps onto the acl
// (public → ['tt:all'], private → ['tt:user']). This module keeps the LEGACY
// ThemeDoc shape as its interchange format — every read adapts the thing back
// to it, so the four /api/v1/themes* routes and the PublicTheme wire shape are
// byte-identical to before. Reads are dual-era (things first, legacy themes
// collection fallback) until the themes-to-things admin migration converts old
// docs; new themes are always written to things, and updates target whichever
// store holds the doc.

// Canonical legacy theme document (thingtime.themes) — now also the adapter
// output shape for theme things. Themes are stored as the fully resolved,
// sanitized token document so a shared theme is always self-contained plain
// data — never functions or raw CSS.
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

// legacy visibility → theme-thing acl. Themes only ever use the two-value
// subset: public is world-readable, everything else is owner-only. Exported so
// the themes-to-things admin migration maps visibility identically.
export const themeAcl = (visibility: 'private' | 'public'): string[] => (visibility === 'public' ? [ACL_ALL] : [ACL_OWNER]);

// thing → legacy ThemeDoc view. Visibility is DERIVED from the acl (tt:all
// grants everyone → public; anything narrower is private — the same coercion
// toPublicTheme has always applied), so routes and wire shapes stay unchanged.
const themeThingToDoc = (thing: any): any => ({
  _id: thing._id,
  shareId: thing.shareId,
  ownerId: thing.ownerId,
  name: thing.crystal?.name,
  theme: thing.crystal?.theme,
  visibility: Array.isArray(thing.acl) && thing.acl.includes(ACL_ALL) ? 'public' : 'private',
  schemaVersion: thing.schemaVersion,
  createdAt: thing.createdAt,
  updatedAt: thing.updatedAt
});

const findThemeThing = async (filter: Record<string, unknown>) => (await getThingsCollection()).findOne({ thingtime: 'theme', ...filter } as any);

type SaveThemeInput = {
  id?: unknown;
  name?: unknown;
  theme?: unknown;
  visibility?: unknown;
};

type SaveResult = { ok: false; status: number; error: string } | { ok: true; theme: PublicTheme };

type ThemeFail = Extract<SaveResult, { ok: false }>;

const storageFail = (error: unknown): ThemeFail | null =>
	error instanceof StorageMutationError ? { ok: false, status: error.status, error: error.message } : null;

const storedThemeSizeBytes = (thing: any): number => {
	const canonical = currentContentStorageSizeBytes(thing || {});
	if (canonical === null) {
		throw new StorageMutationError(409, 'storage_conflict', 'This theme requires the current storage migration before it can be changed');
	}
	return canonical;
};

const themeStorageCas = (thing: any): Record<string, unknown> => ({
	updatedAt: thing.updatedAt,
	storageClass: 'content',
	storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
	sizeBytes: thing.sizeBytes
});

const assertLegacyThemeMutationAllowed = async (ownerId: string, things: any, session: any): Promise<void> => {
	const ready = await things.findOne(readyUserStorageMatch(ownerId), { projection: { _id: 1 }, session });
	if (ready) {
		throw new StorageMutationError(409, 'storage_conflict', 'This theme is still in legacy storage and must be migrated before it can be changed');
	}
};

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
	const explicitVisibility = input.visibility === 'public' ? 'public' : input.visibility === 'private' ? 'private' : null;

  const things = await getThingsCollection();
  const themes = await getThemesCollection();
  const now = new Date();

  if (typeof input.id === 'string' && input.id) {
    // Update whichever store holds the doc: things first, legacy fallback.
    // Unknown ids and not-owned ids both 404 so existence isn't revealed.
    const existingThing = await findThemeThing({ shareId: input.id });
    if (existingThing) {
      if (String(existingThing.ownerId) !== ownerId) {
        return { ok: false, status: 404, error: 'Theme not found' };
      }
			let updatedThing: any;
			try {
				await withHomeMongoTransaction(async (session) => {
					const before = await things.findOne({ _id: existingThing._id, ownerId, thingtime: 'theme' } as any, { session });
					if (!before) {
						throw new StorageMutationError(409, 'storage_conflict', 'Theme changed while it was being updated — try again');
					}
					const visibility = explicitVisibility ?? (Array.isArray(before.acl) && before.acl.includes(ACL_ALL) ? 'public' : 'private');
					const crystal = { ...(before.crystal || {}), name, theme };
					const extended = before.extended ?? null;
					const tags = Array.isArray(before.tags) ? before.tags : [];
					const sizeBytes = thingStorageSizeBytes({ crystal, extended, tags });
					const deltaBytes = sizeBytes - storedThemeSizeBytes(before);
					if (deltaBytes !== 0) await applyUserStorageDelta(ownerId, deltaBytes, session);

					const write = await things.updateOne(
						{ _id: before._id, ownerId, thingtime: 'theme', ...themeStorageCas(before) } as any,
        {
          $set: {
								crystal,
								extended,
								tags,
            acl: themeAcl(visibility),
            schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
								storageClass: 'content',
								sizeBytes,
								storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
            updatedAt: now
          }
						},
						{ session }
      );
					if (write.matchedCount === 0) {
						throw new StorageMutationError(409, 'storage_conflict', 'Theme changed while it was being updated — try again');
					}
					updatedThing = {
						...before,
						crystal,
						extended,
						tags,
						acl: themeAcl(visibility),
						schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
						storageClass: 'content',
						sizeBytes,
						storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION,
						updatedAt: now
					};
				});
			} catch (error) {
				const projected = storageFail(error);
				if (projected) return projected;
				throw error;
			}
			return { ok: true, theme: toPublicTheme(themeThingToDoc(updatedThing)) };
    }

    const existing = await themes.findOne({ shareId: input.id });
    if (!existing || String(existing.ownerId) !== ownerId) {
      return { ok: false, status: 404, error: 'Theme not found' };
    }
    // Legacy docs stay legacy-shaped: updates never migrate in place, so the
    // admin themes-to-things migration remains the ONE conversion path.
    const visibility = explicitVisibility ?? (existing.visibility === 'public' ? 'public' : 'private');
		try {
			await withHomeMongoTransaction(async (session) => {
				await assertLegacyThemeMutationAllowed(ownerId, things, session);
				const write = await themes.updateOne(
					{ _id: new ObjectId(existing._id), ownerId, updatedAt: existing.updatedAt },
					{ $set: { name, theme, visibility, schemaVersion: COLLECTION_SCHEMA_VERSIONS.themes, updatedAt: now } },
					{ session }
    );
				if (write.matchedCount === 0) {
					throw new StorageMutationError(409, 'storage_conflict', 'Theme changed while it was being updated — try again');
				}
			});
		} catch (error) {
			const projected = storageFail(error);
			if (projected) return projected;
			throw error;
		}
    return { ok: true, theme: toPublicTheme({ ...existing, name, theme, visibility, updatedAt: now }) };
  }

  const visibility = explicitVisibility ?? 'private';

  // The 100-theme cap must span BOTH eras — counting one store would let
  // users near the cap double their quota during the dual-era window.
  const [thingCount, legacyCount] = await Promise.all([
    things.countDocuments({ thingtime: 'theme', ownerId } as any),
    themes.countDocuments({ ownerId })
  ]);
  if (thingCount + legacyCount >= MAX_THEMES_PER_USER) {
    return { ok: false, status: 400, error: `Theme limit reached (${MAX_THEMES_PER_USER})` };
  }

  // New themes are theme things. shareId keeps its caller-visible randomUUID
  // semantics (share links, users.meta.activeThemeId pointers), and the things
  // unique shareId index enforces the same uniqueness the legacy themes index
  // did.
  const thing = {
    shareId: randomUUID(),
    schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
    thingtime: ['theme'],
    crystal: { name, theme },
		extended: null,
    ownerId,
    acl: themeAcl(visibility),
    targetId: null,
    tags: [],
    createdAt: now,
    updatedAt: now
  };
	const sizeBytes = thingStorageSizeBytes(thing);
	Object.assign(thing, {
		storageClass: 'content',
		sizeBytes,
		storageAccountingVersion: USER_STORAGE_ACCOUNTING_VERSION
	});
	try {
		await withHomeMongoTransaction(async (session) => {
			await applyUserStorageDelta(ownerId, sizeBytes, session);
			await things.insertOne(thing as any, { session });
		});
	} catch (error) {
		const projected = storageFail(error);
		if (projected) return projected;
		throw error;
	}
  return { ok: true, theme: toPublicTheme(themeThingToDoc(thing)) };
};

// merge things-era + legacy results newest-updated first, dedup by shareId
// (the admin migration upserts, so a converted doc can transiently exist in
// both stores — things wins because that's where writes land now).
const mergeThemeDocs = (thingDocs: any[], legacyDocs: any[]): any[] => {
  const seen = new Set<string>();
  const merged: any[] = [];
  for (const doc of [...thingDocs, ...legacyDocs]) {
    const id = String(doc.shareId);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(doc);
  }
	return merged.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, MAX_THEMES_PER_USER);
};

export const listThemesForUser = async (ownerId: string): Promise<PublicTheme[]> => {
  const things = await getThingsCollection();
  const thingDocs = (
    await things
      .find({ thingtime: 'theme', ownerId } as any)
      .sort({ updatedAt: -1 })
      .limit(MAX_THEMES_PER_USER)
      .toArray()
  ).map(themeThingToDoc);
  const themes = await getThemesCollection();
  const legacyDocs = await themes.find({ ownerId }).sort({ updatedAt: -1 }).limit(MAX_THEMES_PER_USER).toArray();
  return mergeThemeDocs(thingDocs, legacyDocs).map(toPublicTheme);
};

// Public shared read — only returns public themes; 'not found' for private
// ones so their existence isn't revealed.
export const getSharedTheme = async (shareId: string): Promise<PublicTheme | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  // acl containment IS the public gate at the DB level (array match on
  // 'tt:all'), mirroring the legacy visibility:'public' filter — a private
  // theme thing (acl ['tt:user']) can never match this query.
  const thing = await findThemeThing({ shareId: shareId.trim(), acl: ACL_ALL });
  if (thing) return toPublicTheme(themeThingToDoc(thing));
  const themes = await getThemesCollection();
  const doc = await themes.findOne({ shareId: shareId.trim(), visibility: 'public' });
  return doc ? toPublicTheme(doc) : null;
};

// Owner read — a user can always fetch their own theme by id (any visibility).
export const getOwnedTheme = async (ownerId: string, shareId: string): Promise<PublicTheme | null> => {
  if (typeof shareId !== 'string' || !shareId.trim()) return null;
  const thing = await findThemeThing({ shareId: shareId.trim(), ownerId });
  if (thing) return toPublicTheme(themeThingToDoc(thing));
  const themes = await getThemesCollection();
  const doc = await themes.findOne({ shareId: shareId.trim(), ownerId });
  return doc ? toPublicTheme(doc) : null;
};

export const deleteTheme = async (ownerId: string, shareId: unknown): Promise<{ ok: false; status: number; error: string } | { ok: true }> => {
  if (typeof shareId !== 'string' || !shareId.trim()) {
    return { ok: false, status: 400, error: 'Theme id is required' };
  }
  const id = shareId.trim();
  // Delete from BOTH stores (owner-scoped, so someone else's shareId 404s like
	// an unknown one). A Thing deletion refunds its exact before-image in the
	// same transaction. A ready account is never allowed to mutate a leftover
	// legacy twin: that would bypass the canonical ledger and must be repaired by
	// the migration instead.
  const things = await getThingsCollection();
	const themes = await getThemesCollection();
	let deletedThing = false;
	let deletedLegacy = false;
	try {
		await withHomeMongoTransaction(async (session) => {
			const legacy = await themes.findOne({ shareId: id, ownerId }, { projection: { _id: 1 }, session });
			if (legacy) await assertLegacyThemeMutationAllowed(ownerId, things, session);
			const before = await things.findOneAndDelete({ thingtime: 'theme', shareId: id, ownerId } as any, { session });
			const legacyRes = await themes.deleteOne({ shareId: id, ownerId }, { session });
			if (before) {
				const exactBytes = currentContentStorageSizeBytes(before);
				if (exactBytes === null) await markUserStorageNeedsReconcile(ownerId, session);
				else await applyUserStorageDelta(ownerId, -exactBytes, session);
			}
			deletedThing = !!before;
			deletedLegacy = legacyRes.deletedCount > 0;
		});
	} catch (error) {
		const projected = storageFail(error);
		if (projected) return projected;
		throw error;
	}
	if (!deletedThing && !deletedLegacy) {
    return { ok: false, status: 404, error: 'Theme not found' };
  }
  // Don't leave the owner's active theme dangling at a deleted shareId. The
  // pointer lives on the user doc — and users are dual-era things themselves
  // now — so the users store owns the conditional clear.
  await clearUserActiveTheme(ownerId, id);
  return { ok: true };
};
