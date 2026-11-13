import type { Migration, MigrationReport } from './migrations';
import { AclWriteFenceError } from '../mongodb/aclWriteFence';

type Dependencies = {
  customPlane: () => boolean;
  inspect: () => Promise<boolean>;
  provision: () => Promise<void>;
};

/** Home-only infrastructure preparation, never a document/grant migration. */
export const createAclWriteFenceMigration = (dependencies: Dependencies): Migration => {
  const inspect = async () => {
    // Refuse ambiguity before opening a connection or touching either plane.
    if (dependencies.customPlane()) throw new AclWriteFenceError('selection', 'wrong-plane');
    return dependencies.inspect();
  };
  return {
    id: 'provision-relational-acl-validator', homeOnly: true, collection: 'things', fromVersion: 2, toVersion: 2,
    title: 'Provision relational ACL database protection',
    description: 'Home database only. Inspect or install the canonical strict/error Things validator, preserving independent constraints. No document, grant or privilege changes. Dry run only reads collection metadata; a real run requires the existing database principal to have provisioning authority.',
    pending: async () => {
      try { return await inspect() ? 0 : 1; }
      catch (error) {
        // An unverified protection requirement remains pending. Preserve the
        // admin census so its Dry run can reveal the closed failure; never
        // misrepresent failed inspection as ready or hide the recovery UI.
        if (error instanceof AclWriteFenceError) return 1;
        throw error;
      }
    },
    run: async ({ dryRun, assertLease }) => {
      const ready = await inspect();
      const report: MigrationReport = { dryRun, matched: ready ? 0 : 1, migrated: 0, created: 0, skipped: 0,
        notes: [ready ? 'Home collection protection is ready.' : 'Home collection protection requires provisioning.',
          'Counts describe collection protection, not Thing documents. No grants, documents or database privileges are changed.'] };
      if (dryRun) {
        report.notes.push('Read-only metadata inspection; no DDL attempted. Readiness does not prove permission to provision.');
        return report;
      }
      await assertLease?.();
      // Always use canonical installation/readback, even when the initial read
      // said ready. Never publish readiness solely from a cached observation.
      await dependencies.provision();
      await assertLease?.();
      report.migrated = ready ? 0 : 1;
      report.notes.push('Canonical strict/error protection independently verified.');
      return report;
    }
  };
};
