import { randomUUID } from 'node:crypto';

import { isEnvAdmin } from '../auth/admin';
import { unpackSecure } from '../auth/users';
import { getHomeCollection, withHomeMongoTransaction } from '../mongodb/collections';
import { collectionVersion } from '../mongodb/collectionNames';
import { subscriptionShareId, userSubscriptionLedgerEnvelopeIsTrusted } from '../subscriptions/subscriptionIdentity';
import { exactDocumentSnapshotMatch } from './migrationCore';
import type { Migration, MigrationReport } from './migrations';
import { ACL_OWNER, SYSTEM_NOTIFICATION_ACTOR_ID } from '../../../schemas/registry';

// An incident-specific cleanup, never an arbitrary account deletion endpoint.
// Timestamp + identity + empty-account checks prevent a later signup reusing
// this name from being mistaken for the accidentally forwarded test request.
export const CATALOG_FIXTURE = {
  username: 'catalog-check',
  email: 'catalog-check@example.invalid',
  displayName: 'Catalog acceptance',
  createdAt: new Date('2026-10-18T04:11:04.533Z')
} as const;
const refuse = () => { throw new Error('Fixture cleanup refused: identity, activity or stored data differs from the confirmed incident. No account data was removed.'); };
const initialTime = (value: unknown) => value instanceof Date && value >= CATALOG_FIXTURE.createdAt && value.getTime() <= CATALOG_FIXTURE.createdAt.getTime() + 300_000;

export const assertCatalogFixtureIdentity = (user: any) => {
  const secure = unpackSecure(user.secure);
  if (user.createdAt?.getTime() !== CATALOG_FIXTURE.createdAt.getTime() ||
      user.crystal?.username !== CATALOG_FIXTURE.username || user.crystal?.displayName !== CATALOG_FIXTURE.displayName ||
      secure.email !== CATALOG_FIXTURE.email || secure.emailVerified !== false ||
      user.secureAdmin || secure.meta?.admin || isEnvAdmin(CATALOG_FIXTURE.username) ||
      secure.accountKind !== 'user' || secure.meta?.publicUploads !== false || secure.meta?.privateUploads !== false ||
      user.ownerId !== user.shareId || typeof user.shareId !== 'string' ||
      user.crystal?.avatarUrl || user.crystal?.bannerUrl || user.crystal?.bio ||
      !Array.isArray(user.thingtime) || user.thingtime.length !== 1 || user.thingtime[0] !== 'user') refuse();
};

export const assertCatalogFixtureThings = (user: any, owned: any[], sessions: any[]) => {
  const ledger = owned.find(doc => doc.shareId === subscriptionShareId('user', user.shareId));
  if (!ledger || !userSubscriptionLedgerEnvelopeIsTrusted(ledger, user.shareId) ||
      ledger.crystal.storageUsedBytes !== 0 || ledger.crystal.isDefaultAssignment !== true ||
      ledger.crystal.updatedBy !== 'system' || ledger.crystal.tier !== 'free') refuse();
  for (const doc of owned) {
    if (String(doc._id) === String(user._id) || doc === ledger) continue;
    // Logout revokes the session, then emits a second history entry. Bind that
    // entry to an actual revoked incident session rather than accepting arbitrary
    // system notifications or extending the signup time window.
    const signup = doc.crystal?.title === 'Account created successfully ✨' && initialTime(doc.createdAt);
    const logout = doc.crystal?.title === 'Signed out successfully' && doc.createdAt instanceof Date &&
      sessions.some(row => row.revokedAt instanceof Date && doc.createdAt >= row.revokedAt &&
        doc.createdAt.getTime() - row.revokedAt.getTime() <= 30_000);
    if (doc.thingtime?.length !== 1 || doc.thingtime[0] !== 'notification' || doc.ownerId !== user.shareId ||
        doc.historyOnly !== true || doc.crystal?.type !== 'system-message' ||
        doc.crystal?.actorId !== SYSTEM_NOTIFICATION_ACTOR_ID || doc.crystal?.actorName !== 'Lopu' ||
        doc.crystal?.outcome !== 'ok' || (!signup && !logout) || doc.targetId !== null ||
        doc.acl?.length !== 1 || doc.acl[0] !== ACL_OWNER || doc.tags?.length !== 0 ||
        Object.keys(doc.crystal).some(key => !['type', 'actorId', 'actorName', 'title', 'outcome'].includes(key))) refuse();
  }
};

type Dependencies = {
  collection: typeof getHomeCollection;
  transaction: typeof withHomeMongoTransaction;
};
export const cleanupAccidentalCatalogAccount = async (
  { dryRun, assertLease }: { dryRun: boolean; assertLease?: () => Promise<void> },
  deps: Dependencies = { collection: getHomeCollection, transaction: withHomeMongoTransaction }
): Promise<MigrationReport> => deps.transaction(async session => {
  const options = { session };
  const things = await deps.collection('things');
  const candidates = await things.find({ thingtime: 'user', 'crystal.username': CATALOG_FIXTURE.username }, options).toArray();
  const report: MigrationReport = { dryRun, matched: candidates.length, migrated: 0, created: 0, skipped: 0, notes: [] };
  if (!candidates.length) { report.notes.push('Incident account is absent; nothing to remove.'); return report; }
  if (candidates.length !== 1) refuse();
  const user = candidates[0];
  assertCatalogFixtureIdentity(user);
  const userId = user.shareId;
  const owned = await things.find({ ownerId: userId }, options).toArray();
  // A live session, reset/OTP, legacy account or external relationship means
  // this is no longer the idle fixture that was approved for removal.
  const sessions = await deps.collection('sessions');
  const sessionRows = await sessions.find({ userId }, options).toArray();
  if (sessionRows.some(row => !row.revokedAt || !initialTime(row.createdAt) || (row.purpose && row.purpose !== 'browser'))) refuse();
  assertCatalogFixtureThings(user, owned, sessionRows);
  for (const logical of ['users', 'passwordResets', 'authOtps', 'lopuCredentials']) {
    const collection = await deps.collection(logical);
    if (await collection.findOne({ $or: [{ userId }, { ownerId: userId }, { _id: userId }, ...(logical === 'users' ? [{ username: CATALOG_FIXTURE.username }] : [])] }, options)) refuse();
  }
  if (await things.findOne({ ownerId: { $ne: userId }, $or: [{ targetId: userId }, { parentId: userId }, { 'crystal.subjectId': userId }, { 'crystal.userId': userId }, { 'crystal.memberId': userId }, { 'crystal.actorId': userId }] }, options)) refuse();
  const verifications = await deps.collection('emailVerifications');
  const verificationRows = await verifications.find({ userId }, options).toArray();
  if (verificationRows.some(row => row.email !== CATALOG_FIXTURE.email || row.consumedAt || !initialTime(row.createdAt))) refuse();
  const rosters = await deps.collection('rosters');
  const rosterRows = await rosters.find({ 'entries.userId': userId }, options).toArray();
  report.notes.push(`Confirmed one idle incident account: ${owned.length} account Things, ${sessionRows.length} revoked sessions, ${verificationRows.length} verification records, ${rosterRows.length} roster references. Email delivery and migration audit records are retained.`);
  if (dryRun) return report;
  await assertLease?.();
  // Every delete/update uses its complete BSON preimage inside one home-DB
  // transaction. A concurrent profile/ledger/session/roster change aborts it.
  const removeExact = async (collection: any, rows: any[]) => {
    for (const row of rows) if ((await collection.deleteOne(exactDocumentSnapshotMatch(row), options)).deletedCount !== 1) refuse();
  };
  await removeExact(things, owned);
  await removeExact(sessions, sessionRows);
  await removeExact(verifications, verificationRows);
  for (const roster of rosterRows) {
    const entries = roster.entries.filter((entry: any) => entry.userId !== userId);
    if (!entries.length) await removeExact(rosters, [roster]);
    else if ((await rosters.updateOne(exactDocumentSnapshotMatch(roster), { $set: { entries, version: randomUUID(), updatedAt: new Date() } }, options)).matchedCount !== 1) refuse();
  }
  await assertLease?.();
  report.migrated = 1;
  report.notes.push('Removed the confirmed account and its disposable authentication/bootstrap records atomically.');
  return report;
});

export const accidentalCatalogAccountMigration: Migration = {
  id: 'cleanup-accidental-catalog-account-2026-10-18', collection: 'things',
  fromVersion: collectionVersion('things'), toVersion: collectionVersion('things'),
  title: 'Remove the accidental catalog acceptance account', destructive: true,
  description: 'Incident-specific cleanup of the unverified catalog-check account created on 2026-10-18 at 04:11:04.533 UTC. Refuses changed identity, live sessions, nonempty storage or unexpected content. Dry-run first; real runs require confirmation. Retains email delivery and migration audit records.',
  pending: async () => (await getHomeCollection('things')).countDocuments({ thingtime: 'user', 'crystal.username': CATALOG_FIXTURE.username, createdAt: CATALOG_FIXTURE.createdAt }),
  run: cleanupAccidentalCatalogAccount
};
