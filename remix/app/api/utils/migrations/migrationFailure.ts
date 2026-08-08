import { safeErrorText } from '../errors/safeError';
import { StorageMutationError } from '../storage/storageCore';

const safeMigrationId = (value: unknown): string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value) ? value : 'requested-migration';

export type MigrationFailure = { ok: false; status: number; error: string; outcome: 'rejected' | 'unknown' };

export type MigrationOperatorCode =
  | 'lease_lost'
  | 'legacy_source_changed'
  | 'subscription_envelope_invalid'
  | 'subscription_envelope_changed'
  | 'lease_required'
  | 'prerequisite_unresolved'
  | 'prerequisite_reappeared'
  | 'orphan_billable_thing'
  | 'invalid_sandbox_marker'
  | 'schema_prerequisite'
  | 'unknown_owner_change'
  | 'billable_thing_churn'
  | 'app_counter_owner_invalid'
  | 'subscription_init_failed'
  | 'pending_storage_records';

type MigrationOperatorOptions = {
  internalMessage?: string;
  prerequisiteId?: string;
  pending?: number;
};

const safeCount = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

const operatorPresentation = (
  code: MigrationOperatorCode,
  options: MigrationOperatorOptions
): { status: number; message: string } => {
  const prerequisite = safeMigrationId(options.prerequisiteId);
  const pending = safeCount(options.pending);
  switch (code) {
    case 'lease_lost':
      return {
        status: 409,
        message:
          'The migration lease expired before completion. No ledger was published ready. Refresh migration status and rerun the migration.'
      };
    case 'legacy_source_changed':
      return {
        status: 409,
        message:
          'Legacy relational data changed during migration. Its transaction was rolled back and the source was kept. Rerun the migration.'
      };
    case 'subscription_envelope_invalid':
      return {
        status: 409,
        message:
          'A protected subscription ledger has an invalid envelope. Storage ledgers remain fenced. Inspect server logs to locate and repair the conflicting record, then rerun the migration.'
      };
    case 'subscription_envelope_changed':
      return {
        status: 409,
        message:
          'A protected subscription ledger changed while it was being upgraded. Storage ledgers remain fenced. Refresh status and retry after concurrent writes settle; inspect server logs if it repeats.'
      };
    case 'lease_required':
      return {
        status: 500,
        message:
          'Storage accounting was invoked without its required global migration lease. No ledger was published. Inspect server logs before retrying.'
      };
    case 'prerequisite_unresolved':
      return {
        status: 409,
        message: `Storage prerequisite ${prerequisite} still has ${pending} unresolved record(s). Ledgers remain fenced. Refresh migration status and rerun backfill-user-storage-accounting.`
      };
    case 'prerequisite_reappeared':
      return {
        status: 409,
        message: `Storage prerequisite ${prerequisite} became pending again (${pending} unresolved record(s)). Ledgers remain fenced. Wait for concurrent writes to settle, then rerun backfill-user-storage-accounting.`
      };
    case 'orphan_billable_thing':
      return {
        status: 409,
        message:
          'A billable Thing belongs to no current user. Ledgers remain fenced. Inspect server logs to locate and repair the orphaned record, then rerun backfill-user-storage-accounting.'
      };
    case 'invalid_sandbox_marker':
      return {
        status: 409,
        message:
          'A billable Thing has an invalid sandbox marker. Ledgers remain fenced. Inspect server logs to locate and repair the malformed record, then rerun backfill-user-storage-accounting.'
      };
    case 'schema_prerequisite':
      return {
        status: 409,
        message:
          'A billable Thing still requires its schema migration. Ledgers remain fenced. Run the pending schema migration, then rerun backfill-user-storage-accounting.'
      };
    case 'unknown_owner_change':
      return {
        status: 409,
        message:
          'A billable Thing changed to an owner that is not a current user. Ledgers remain fenced. Inspect server logs and repair its ownership, then rerun backfill-user-storage-accounting.'
      };
    case 'billable_thing_churn':
      return {
        status: 409,
        message:
          'A billable Thing kept changing during storage migration. Ledgers remain fenced. Retry after concurrent writes settle.'
      };
    case 'app_counter_owner_invalid':
      return {
        status: 409,
        message:
          'A reserved app-storage counter has an invalid owner. Ledgers remain fenced. Inspect server logs to locate and repair the conflicting counter, then rerun backfill-user-storage-accounting.'
      };
    case 'subscription_init_failed':
      return {
        status: 409,
        message:
          'A subscription ledger could not be initialized. Storage ledgers remain fenced. Refresh status and retry; inspect server logs if it repeats.'
      };
    case 'pending_storage_records':
      return {
        status: 409,
        message: `Storage accounting still has ${pending} pending record(s). Ledgers remain fenced. Refresh migration status and rerun backfill-user-storage-accounting.`
      };
  }
};

// The public copy is selected from a closed taxonomy. Error.message keeps the
// private diagnostic so server logs retain the throw-site stack and exact ids.
export class MigrationOperatorError extends Error {
  readonly code: MigrationOperatorCode;
  readonly status: number;
  readonly publicMessage: string;

  constructor(code: MigrationOperatorCode, options: MigrationOperatorOptions = {}) {
    const presentation = operatorPresentation(code, options);
    super(options.internalMessage || presentation.message);
    this.name = 'MigrationOperatorError';
    this.code = code;
    this.status = presentation.status;
    this.publicMessage = presentation.message;
  }
}

// Migrations are admin-only, but caught database messages can still contain
// document ids, hosts, or connection details. Preserve explicitly authored
// storage failures; summarize every other exception by safe class/code while
// keeping the full original in server logs.
export const migrationFailureResult = (
  migrationId: unknown,
  error: unknown,
  outcome: MigrationFailure['outcome'] = 'unknown'
): MigrationFailure => {
  if (error instanceof StorageMutationError) {
    return { ok: false, status: error.status, error: error.message, outcome };
  }

  const id = safeMigrationId(migrationId);
  if (error instanceof MigrationOperatorError) {
    console.error(`[migration ${id}]`, error);
    return {
      ok: false,
      status: error.status,
      error: `Migration ${id} stopped before completion: ${error.publicMessage}`,
      outcome
    };
  }
  const detail = safeErrorText(error, `migration ${id}`, 'Unexpected migration error');
  return {
    ok: false,
    status: 500,
    error: `Migration ${id} stopped before completion: ${detail}. Refresh migration status before retrying.`,
    outcome
  };
};
