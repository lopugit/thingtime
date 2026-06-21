import { ObjectId } from 'mongodb';

import { getUsersCollection } from '../mongodb/collections';

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
};

export const toPublicUser = (user: any): PublicUser => ({
  id: String(user._id),
  ttid: user.ttid,
  username: user.username,
  email: user.email,
  displayName: user.displayName ?? null,
  emailVerified: !!user.emailVerified,
  createdAt: new Date(user.createdAt).toISOString()
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
