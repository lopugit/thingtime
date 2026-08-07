import { createHash } from 'node:crypto';

import { getThingsCollection } from '../mongodb/collections';
import { ACL_OWNER, COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';

// Account-ownership links (FUNDAMENTALS.md §3: appended/child data is
// relational) — one PROTECTED `account-link` thing per (kind, user, target),
// deterministic shareId so assignment is idempotent. Many-to-many by
// construction: a user can hold links to many targets, a target can be linked
// from many users.
//
// Two link kinds:
//   • 'account' — the user OWNS another account (usually a service account):
//     it appears in their switcher's "Owned accounts" and can be assumed
//     without credentials via POST /api/v1/auth/accounts/assume.
//   • 'app' — the user co-manages a registered app (targetId = clientId):
//     the app shows up in their /apps list and update/delete accept them.
//
// Links are written ONLY by the admin endpoints (the kind is protected from
// generic CRUD — self-assigning ownership would be privilege escalation).
// The doc's ownerId is the managing user, so their links surface first-party.

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export type AccountLinkKind = 'account' | 'app';

export const isAccountLinkKind = (value: unknown): value is AccountLinkKind => value === 'account' || value === 'app';

export type AccountLink = {
  linkKind: AccountLinkKind;
  // The managing (human) account.
  userId: string;
  // The owned target: a user id for 'account' links, a clientId for 'app'.
  targetId: string;
  role: 'owner';
  createdBy: string;
  createdAt: Date | null;
};

const LINK_KIND = 'account-link';

const linkShareId = (linkKind: AccountLinkKind, userId: string, targetId: string): string =>
	`account-link-${createHash('sha256').update(linkKind).update('\0').update(userId).update('\0').update(targetId).digest('hex').slice(0, 48)}`;

const linkMatch = (linkKind: AccountLinkKind, userId: string, targetId: string) => ({
  shareId: linkShareId(linkKind, userId, targetId),
  thingtime: LINK_KIND
});

const toLink = (doc: any): AccountLink => ({
  linkKind: doc?.crystal?.linkKind === 'app' ? 'app' : 'account',
  userId: String(doc?.crystal?.userId ?? doc?.ownerId ?? ''),
  targetId: String(doc?.crystal?.targetId ?? ''),
  role: 'owner',
  createdBy: typeof doc?.crystal?.createdBy === 'string' ? doc.crystal.createdBy : '',
  createdAt: doc?.createdAt instanceof Date ? doc.createdAt : null
});

export const createAccountLink = async (input: {
  linkKind: AccountLinkKind;
  userId: string;
  targetId: string;
  createdBy: string;
}): Promise<{ ok: true; link: AccountLink } | Fail> => {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim() : '';
  if (!userId || !targetId) return fail(400, 'userId and targetId are required');
  if (input.linkKind === 'account' && userId === targetId) {
    return fail(400, 'An account cannot be linked to itself');
  }

  const now = new Date();
  const things = await getThingsCollection();
  try {
    await things.updateOne(
      linkMatch(input.linkKind, userId, targetId),
      {
        $setOnInsert: {
          schemaVersion: COLLECTION_SCHEMA_VERSIONS.things,
          thingtime: [LINK_KIND],
          crystal: {
            linkKind: input.linkKind,
            userId,
            targetId,
            role: 'owner',
            createdBy: input.createdBy
          },
          ownerId: userId,
          acl: [ACL_OWNER],
          targetId: null,
          tags: [],
          createdAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );
  } catch (err: any) {
    if (err?.code !== 11000) throw err; // lost the upsert race — link exists
  }

  const doc = await things.findOne(linkMatch(input.linkKind, userId, targetId));
  return { ok: true, link: toLink(doc) };
};

export const removeAccountLink = async (linkKind: AccountLinkKind, userId: string, targetId: string): Promise<{ ok: true; removed: boolean }> => {
  const things = await getThingsCollection();
  const res = await things.deleteOne(linkMatch(linkKind, userId, targetId));
  return { ok: true, removed: res.deletedCount > 0 };
};

// All links a user holds (ownerId = the managing user, so this rides the
// (thingtime, ownerId, createdAt) index).
export const listAccountLinksForUser = async (userId: string, linkKind?: AccountLinkKind): Promise<AccountLink[]> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: LINK_KIND, ownerId: userId, ...(linkKind ? { 'crystal.linkKind': linkKind } : {}) })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(toLink);
};

// Everyone linked to a target (admin "who owns this?" view + co-manager
// resolution) — served by the (thingtime, crystal.targetId) index.
export const listAccountLinksForTarget = async (targetId: string, linkKind?: AccountLinkKind): Promise<AccountLink[]> => {
  const things = await getThingsCollection();
  const docs = await things
    .find({ thingtime: LINK_KIND, 'crystal.targetId': targetId, ...(linkKind ? { 'crystal.linkKind': linkKind } : {}) })
    .sort({ createdAt: 1 })
    .toArray();
  return docs.map(toLink);
};

// Does this user hold an 'account' link to that account? (The assume
// endpoint's authorization check.)
export const userOwnsLinkedAccount = async (userId: string, accountId: string): Promise<boolean> => {
  const things = await getThingsCollection();
  const doc = await things.findOne(linkMatch('account', userId, accountId), { projection: { _id: 1 } });
  return !!doc;
};

// The clientIds of apps this user co-manages via links (their own apps are
// matched by ownerId and never need a link).
export const listLinkedAppClientIds = async (userId: string): Promise<string[]> => {
  const links = await listAccountLinksForUser(userId, 'app');
  return links.map((link) => link.targetId);
};

// Ownership check the apps utils use: the registering owner, or any holder of
// an 'app' link.
export const userCanManageApp = async (userId: string, appDoc: any, session?: any): Promise<boolean> => {
  if (!appDoc) return false;
  if (String(appDoc.ownerId) === userId) return true;
  const clientId = appDoc?.crystal?.clientId;
  if (typeof clientId !== 'string' || !clientId) return false;
  const things = await getThingsCollection();
	const doc = await things.findOne(linkMatch('app', userId, clientId), {
		projection: { _id: 1 },
		...(session ? { session } : {})
	});
  return !!doc;
};
