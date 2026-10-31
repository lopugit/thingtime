import { randomInt } from 'node:crypto';

import { hashPassword, verifyPassword } from '../auth/passwords';
import { physicalCollectionName } from '../mongodb/collectionNames';

// Password hasher for the /crypto toolbox: turn a password into the exact
// bcrypt hash Thingtime stores, plus a paste-ready mongosh snippet that writes
// it into a user — the manual recovery path when you're locked out of a
// database you own (a forgotten local dev password) and the emailed reset flow
// isn't available.
//
// Why this is safe to expose unauthenticated: hashing is a pure function of
// its input (no DB reads, no account lookups, nothing about who exists), and
// bcrypt is public — anyone can run it locally. The endpoint reveals nothing
// it wasn't given. The real cost is CPU (bcrypt is deliberately slow), so the
// route rate-limits it. It is deliberately NOT session-gated: being locked
// out is the whole reason to reach for it.
//
// What it does NOT do: it never touches the database. Writing the hash is a
// manual step you run yourself against a db you control — which keeps a
// "reset anyone's password" primitive out of the API surface entirely.

// Register's minimum (auth/registerUser.ts) — reported, not enforced: the
// hasher is a tool, and an existing account may predate any policy.
const REGISTER_MIN_PASSWORD_CHARS = 6;
export const HASHER_MAX_PASSWORD_CHARS = 256;
export const HASHER_MAX_USERNAME_CHARS = 64;
const GENERATED_PASSWORD_DEFAULT_CHARS = 24;
const GENERATED_PASSWORD_MIN_CHARS = 12;
const GENERATED_PASSWORD_MAX_CHARS = 64;
// Unambiguous alphabet (no O/0, l/1/I) — these get read off a screen and
// retyped, and a hash is unforgiving about a misread character.
const GENERATED_ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789-_@#%+=?';

export type HashPasswordInput = {
  password?: unknown;
  generate?: unknown;
  length?: unknown;
  username?: unknown;
};

export type HashPasswordResult = {
  algorithm: 'bcrypt';
  cost: number;
  hash: string;
  // the hash is verified against its own input before being returned, so a
  // paste that "looks right" can never be a hash of something else
  verified: boolean;
  // echoed ONLY when this endpoint generated it (otherwise the caller has it)
  password: string | null;
  generated: boolean;
  passwordLength: number;
  meetsRegisterPolicy: boolean;
  username: string | null;
  collections: { things: string; users: string };
  mongosh: string;
  notes: string[];
};

const generatePassword = (length: number): string => {
  let out = '';
  for (let index = 0; index < length; index++) {
    out += GENERATED_ALPHABET[randomInt(GENERATED_ALPHABET.length)];
  }
  return out;
};

// bcrypt encodes its cost in the hash ($2b$<cost>$…) — read it back rather
// than restating the constant, so this can't drift from auth/passwords.ts.
const costOf = (hash: string): number => {
  const parsed = Number(hash.split('$')[2]);
  return Number.isFinite(parsed) ? parsed : 0;
};

// A mongosh script that rotates ONE user's password hash across both user
// stores (FUNDAMENTALS §3): things-era users keep the hash inside the `secure`
// BinData blob, so it must be unpacked, edited and repacked — a plain
// `$set: { passwordHash }` would write a field nothing reads. secureVersion is
// bumped to match the app's CAS write (auth/users.ts mutateUserThingSecure).
const buildMongoshSnippet = ({
  username,
  hash,
  thingsCollection,
  usersCollection
}: {
  username: string;
  hash: string;
  thingsCollection: string;
  usersCollection: string;
}): string => {
  const safeUsername = JSON.stringify(username);
  return `// Thingtime — set a user's password hash by hand (manual recovery).
// Run against the database you want to change, e.g.
//   mongosh "mongodb://127.0.0.1:27017/thingtime"
const username = ${safeUsername};
const passwordHash = ${JSON.stringify(hash)};

const things = db.getCollection(${JSON.stringify(thingsCollection)});
const legacy = db.getCollection(${JSON.stringify(usersCollection)});

const thing = things.findOne({ thingtime: "user", "crystal.username": username });
if (thing) {
  // things-era user: the hash lives INSIDE the \`secure\` BinData blob, so
  // unpack -> edit -> repack (a plain $set of passwordHash writes a field
  // nothing reads). secureVersion is bumped like the app's CAS write does.
  const secure = JSON.parse(Buffer.from(thing.secure.buffer).toString("utf8"));
  secure.passwordHash = passwordHash;
  const res = things.updateOne(
    { _id: thing._id },
    {
      $set: {
        secure: BinData(0, Buffer.from(JSON.stringify(secure), "utf8").toString("base64")),
        updatedAt: new Date()
      },
      $inc: { secureVersion: 1 }
    }
  );
  print("things: matched " + res.matchedCount + ", modified " + res.modifiedCount);
} else {
  const res = legacy.updateOne({ username }, { $set: { passwordHash, updatedAt: new Date() } });
  print("legacy users: matched " + res.matchedCount + ", modified " + res.modifiedCount);
  if (!res.matchedCount) {
    print("No user named " + username + " in either store.");
    print("Usernames present: " + things
      .find({ thingtime: "user" }, { "crystal.username": 1 })
      .toArray()
      .map((d) => d.crystal && d.crystal.username)
      .join(", "));
  }
}`;
};

export const hashPasswordForStorage = async (input: HashPasswordInput): Promise<HashPasswordResult> => {
  const wantsGenerated = input.generate === true;
  const supplied = typeof input.password === 'string' ? input.password : '';

  if (!wantsGenerated && !supplied) {
    throw new Error('Provide a password to hash, or set generate: true to have one made for you.');
  }
  if (supplied.length > HASHER_MAX_PASSWORD_CHARS) {
    throw new Error(`Password must be at most ${HASHER_MAX_PASSWORD_CHARS} characters.`);
  }

  let length = GENERATED_PASSWORD_DEFAULT_CHARS;
  if (input.length !== undefined && input.length !== null && input.length !== '') {
    const parsed = Number(input.length);
    if (!Number.isFinite(parsed)) throw new Error('length must be a number.');
    length = Math.min(GENERATED_PASSWORD_MAX_CHARS, Math.max(GENERATED_PASSWORD_MIN_CHARS, Math.floor(parsed)));
  }

  const password = wantsGenerated ? generatePassword(length) : supplied;

  const rawUsername = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const username = rawUsername.slice(0, HASHER_MAX_USERNAME_CHARS);

  const hash = await hashPassword(password);
  // Prove the hash before handing it over: a hash that doesn't verify against
  // the password it was made from would strand whoever pastes it.
  const verified = await verifyPassword(password, hash);

  const notes: string[] = [];
  if (password.length < REGISTER_MIN_PASSWORD_CHARS) {
    notes.push(
      `Shorter than the ${REGISTER_MIN_PASSWORD_CHARS}-character minimum new registrations require — logging in with it still works.`
    );
  }
  notes.push('The hash is what gets stored; the password itself is never saved by this tool.');
  notes.push('Any existing sessions keep working after a manual rotation — revoke them separately if that matters.');

  return {
    algorithm: 'bcrypt',
    cost: costOf(hash),
    hash,
    verified,
    password: wantsGenerated ? password : null,
    generated: wantsGenerated,
    passwordLength: password.length,
    meetsRegisterPolicy: password.length >= REGISTER_MIN_PASSWORD_CHARS,
    username: username || null,
    collections: {
      things: physicalCollectionName('things'),
      users: physicalCollectionName('users')
    },
    mongosh: buildMongoshSnippet({
      username: username || 'your-username',
      hash,
      thingsCollection: physicalCollectionName('things'),
      usersCollection: physicalCollectionName('users')
    }),
    notes
  };
};
