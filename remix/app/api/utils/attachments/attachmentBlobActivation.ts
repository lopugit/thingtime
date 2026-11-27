import { getSettingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';

const key = 'attachment-content-blobs:home-rollout';
const version = 1;

/** Reading and cleanup always support existing shared content. Writing new
 * shared refs is opt-in for the whole home database, after every deployment
 * sharing it has upgraded to compatible readers and deleters. */
export async function syncAttachmentDedupActive(): Promise<boolean> {
  if (isCustomMongoEndpointActive()) return false;
  const row = await (await getSettingsCollection()).findOne({ key }, { projection: { activationVersion: 1 } });
  return row?.activationVersion === version;
}

/** Invoked only by the confirmed admin migration; no automatic activation. */
export async function activateSyncAttachmentDedup(options: { dryRun: boolean; assertLease?: () => Promise<void> }) {
  if (isCustomMongoEndpointActive()) throw Error('Sync attachment deduplication requires home storage');
  const active = await syncAttachmentDedupActive();
  const matched = active ? 0 : 1;
  if (!active && !options.dryRun) {
    await options.assertLease?.();
    await (await getSettingsCollection()).updateOne({ key }, { $set: { activationVersion: version, activatedAt: new Date() } }, { upsert: true });
  }
  return { dryRun: options.dryRun, matched, migrated: options.dryRun ? 0 : matched, created: 0, skipped: 0,
    notes: ['Activation requires compatible attachment readers, quota and cleanup on every origin sharing this home database. Never roll back to code that cannot resolve or delete shared references.'] };
}
