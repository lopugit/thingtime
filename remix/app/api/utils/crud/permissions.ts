import type { PublicUser } from '../auth/users';
import { fail, type Fail } from './validation';

// Operation-specific, fail-closed ACLs for kind:'record' things. Subjects are
// single strings — 'public', 'user:<id>', 'service:<id>' — so each operation
// stays one indexable Mongo array (see PLANS/codexCRUDImplementation.md).

export type RecordOperation = 'read' | 'search' | 'write' | 'admin';

export type ThingRecordAcl = {
  ownerId: string;
  // owner's subject key, kept so ACL rewrites by a non-owner admin can never
  // drop the owner's grants (internal only — never projected)
  ownerSubject: string;
  readKeys: string[];
  writeKeys: string[];
  adminKeys: string[];
  searchKeys: string[];
};

export const PUBLIC_SUBJECT = 'public';

const SUBJECT_PATTERN = /^(user|service):[a-f0-9]{24}$/;
const MAX_GRANTS_PER_OPERATION = 50;

export const subjectKeyForUser = (user: PublicUser): string =>
  `${user.accountKind === 'service' ? 'service' : 'user'}:${user.id}`;

// Anonymous callers only ever carry the public subject.
export const subjectKeysForUser = (user: PublicUser | null): string[] =>
  user ? [PUBLIC_SUBJECT, subjectKeyForUser(user)] : [PUBLIC_SUBJECT];

export const aclKeysForOperation = (operation: RecordOperation): keyof ThingRecordAcl => {
  switch (operation) {
    case 'read':
      return 'readKeys';
    case 'search':
      return 'searchKeys';
    case 'write':
      return 'writeKeys';
    case 'admin':
      return 'adminKeys';
  }
};

// Owner authority is implicit and cannot be removed from the ACL.
export const recordPermissionMatch = (
  acl: ThingRecordAcl,
  user: PublicUser | null,
  operation: RecordOperation
): boolean => {
  if (user && user.id === acl.ownerId) return true;
  const subjects = subjectKeysForUser(user);
  const granted = acl[aclKeysForOperation(operation)] as string[];
  return granted.some((key) => subjects.includes(key));
};

export const canReadRecord = (acl: ThingRecordAcl, user: PublicUser | null) =>
  recordPermissionMatch(acl, user, 'read');

export const canWriteRecord = (acl: ThingRecordAcl, user: PublicUser | null) =>
  recordPermissionMatch(acl, user, 'write');

export const canAdminRecord = (acl: ThingRecordAcl, user: PublicUser | null) =>
  recordPermissionMatch(acl, user, 'admin');

export type AclGrantsInput = {
  readKeys?: unknown;
  writeKeys?: unknown;
  searchKeys?: unknown;
  adminKeys?: unknown;
};

const sanitizeGrantList = (
  value: unknown,
  operation: RecordOperation,
  ownerSubject: string
): string[] | Fail => {
  if (value !== undefined && !Array.isArray(value)) {
    return fail(400, `${aclKeysForOperation(operation)} must be a list of subject keys`);
  }
  const keys = new Set<string>([ownerSubject]);
  for (const entry of Array.isArray(value) ? value : []) {
    if (typeof entry !== 'string') return fail(400, 'ACL subject keys must be strings');
    const key = entry.trim().toLowerCase();
    if (!key) continue;
    if (key === PUBLIC_SUBJECT) {
      // Anonymous write/admin would let anyone mutate or re-grant the record.
      if (operation === 'write' || operation === 'admin') {
        return fail(400, `public ${operation} grants are not allowed`);
      }
      keys.add(key);
      continue;
    }
    if (!SUBJECT_PATTERN.test(key)) {
      // Class-wide grants ('user', 'service') are rejected in v1 — grants must
      // target explicit subjects.
      return fail(400, `Invalid ACL subject "${entry}" (use public, user:<id> or service:<id>)`);
    }
    keys.add(key);
  }
  if (keys.size > MAX_GRANTS_PER_OPERATION) {
    return fail(400, `At most ${MAX_GRANTS_PER_OPERATION} ${aclKeysForOperation(operation)} grants are allowed`);
  }
  return [...keys];
};

// Normalize + dedupe caller-supplied grants into a full ACL. The owner subject
// is always re-added to every list so an ACL rewrite can't lock the owner out.
export const sanitizeAclInput = (
  input: AclGrantsInput,
  owner: { ownerId: string; ownerSubject: string }
): ThingRecordAcl | Fail => {
  const readKeys = sanitizeGrantList(input.readKeys, 'read', owner.ownerSubject);
  if (!Array.isArray(readKeys)) return readKeys;
  const writeKeys = sanitizeGrantList(input.writeKeys, 'write', owner.ownerSubject);
  if (!Array.isArray(writeKeys)) return writeKeys;
  const adminKeys = sanitizeGrantList(input.adminKeys, 'admin', owner.ownerSubject);
  if (!Array.isArray(adminKeys)) return adminKeys;
  // Search reveals existence, so it defaults to the read set when omitted.
  const searchKeys = sanitizeGrantList(input.searchKeys === undefined ? readKeys : input.searchKeys, 'search', owner.ownerSubject);
  if (!Array.isArray(searchKeys)) return searchKeys;

  return {
    ownerId: owner.ownerId,
    ownerSubject: owner.ownerSubject,
    readKeys,
    writeKeys,
    adminKeys,
    searchKeys
  };
};

// Projection helper — callers get capability booleans, never raw ACL arrays
// (admins get the arrays so they can manage grants).
export const projectAclFor = (acl: ThingRecordAcl, user: PublicUser | null) => {
  const permissions = {
    canRead: canReadRecord(acl, user),
    canSearch: recordPermissionMatch(acl, user, 'search'),
    canWrite: canWriteRecord(acl, user),
    canAdmin: canAdminRecord(acl, user)
  };
  if (!permissions.canAdmin) return { permissions, acl: null };
  return {
    permissions,
    acl: {
      readKeys: [...acl.readKeys],
      writeKeys: [...acl.writeKeys],
      adminKeys: [...acl.adminKeys],
      searchKeys: [...acl.searchKeys]
    }
  };
};
