import { ObjectId } from 'mongodb';

import { getUsersCollection } from '../mongodb/collections';

export const THINGTIME_ADMIN_ROLE = 'thingtime.admin';

export type UserRole = string;

// Canonical user document (thingtime.users). See FUNDAMENTALS.md §3 + the user
// schema in claude-todo/03-auth-login-register.md.
export type UserDoc = {
  _id?: any;
  ttid: string;
  username: string;
  email: string;
  passwordHash: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  accountKind?: 'user' | 'service';
  roles?: UserRole[];
  emailVerificationRequiredBy?: Date | null;
  storageAllowanceBytes?: number;
  storageUsedBytes?: number;
  meta: Record<string, any>;
};

// Safe shape returned to clients — never includes passwordHash.
export type PublicUser = {
  id: string;
  ttid: string;
  username: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  createdAt: string;
  accountKind: 'user' | 'service';
  roles: UserRole[];
  emailVerificationRequiredBy: string | null;
  storageAllowanceBytes: number | null;
  storageUsedBytes: number | null;
};

export const normalizeUserRoles = (roles: unknown): UserRole[] => {
  if (!Array.isArray(roles)) return [];

  return Array.from(
    new Set(
      roles
        .filter((role): role is string => typeof role === 'string')
        .map((role) => role.trim())
        .filter(Boolean)
    )
  );
};

export const userHasRole = (
  user: Pick<PublicUser, 'roles'> | null | undefined,
  role: UserRole
) => !!user && normalizeUserRoles(user.roles).includes(role);

export const toPublicUser = (user: any): PublicUser => ({
  id: String(user._id),
  ttid: user.ttid,
  username: user.username,
  email: user.email,
  displayName: user.displayName ?? null,
  emailVerified: !!user.emailVerified,
  createdAt: new Date(user.createdAt).toISOString(),
  accountKind: user.accountKind === 'service' ? 'service' : 'user',
  roles: normalizeUserRoles(user.roles),
  emailVerificationRequiredBy: user.emailVerificationRequiredBy
    ? new Date(user.emailVerificationRequiredBy).toISOString()
    : null,
  storageAllowanceBytes: typeof user.storageAllowanceBytes === 'number' ? user.storageAllowanceBytes : null,
  storageUsedBytes: typeof user.storageUsedBytes === 'number' ? user.storageUsedBytes : null
});

export const findUserByUsername = async (username: string) =>
  (await getUsersCollection()).findOne({ username: username.trim().toLowerCase() });

export const findUserByEmail = async (email: string) =>
  (await getUsersCollection()).findOne({ email: email.trim().toLowerCase() });

export const findUserById = async (id: string) => {
  if (!ObjectId.isValid(id)) return null;
  return (await getUsersCollection()).findOne({ _id: new ObjectId(id) });
};

export const insertUser = async (doc: UserDoc) => {
  const res = await (await getUsersCollection()).insertOne(doc);
  return { ...doc, _id: res.insertedId };
};

export const markEmailVerified = async (userId: string) => {
  if (!ObjectId.isValid(userId)) return;
  await (await getUsersCollection()).updateOne(
    { _id: new ObjectId(userId) },
    { $set: { emailVerified: true, updatedAt: new Date() } }
  );
};
