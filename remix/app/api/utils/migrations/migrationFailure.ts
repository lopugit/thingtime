import { captureAdminErrorDiagnostic, type AdminErrorDiagnostic } from '../errors/adminDiagnostic';
import { safeErrorText } from '../errors/safeError';
import { StorageMutationError } from '../storage/storageCore';

const safeMigrationId = (value: unknown): string =>
  typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value) ? value : 'requested-migration';

export type MigrationFailure = {
	ok: false;
	status: number;
	error: string;
	outcome: 'rejected' | 'unknown';
	// Non-enumerable: runMigration returns this source only after its finally
	// has released the lease. The route captures/persists it afterward, while
	// spreading/JSON-stringifying a failure can never leak the original error.
	diagnosticSource?: unknown;
};

const withDiagnosticSource = (failure: Omit<MigrationFailure, 'diagnosticSource'>, error: unknown): MigrationFailure => {
	Object.defineProperty(failure, 'diagnosticSource', {
		value: error,
		enumerable: false,
		configurable: false,
		writable: false
	});
	return failure;
};

export const captureMigrationFailureDiagnostic = (failure: MigrationFailure): AdminErrorDiagnostic | null =>
	Object.prototype.hasOwnProperty.call(failure, 'diagnosticSource')
		? captureAdminErrorDiagnostic(
				failure.diagnosticSource,
				failure.diagnosticSource instanceof MigrationOperatorError
					? failure.diagnosticSource.diagnosticRevealContext()
					: undefined
		  )
		: null;

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
  | 'invalid_attachment_envelope'
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
	diagnosticObjectIds?: readonly string[];
};

const safeCount = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

const operatorPresentation = (code: MigrationOperatorCode, options: MigrationOperatorOptions): { status: number; message: string } => {
  const prerequisite = safeMigrationId(options.prerequisiteId);
  const pending = safeCount(options.pending);
  switch (code) {
    case 'lease_lost':
      return {
        status: 409,
				message: 'The migration lease expired before completion. No ledger was published ready. Refresh migration status and rerun the migration.'
      };
    case 'legacy_source_changed':
      return {
        status: 409,
				message: 'Legacy relational data changed during migration. Its transaction was rolled back and the source was kept. Rerun the migration.'
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
					'A billable Thing belongs to no current user. Ledgers remain fenced. Use the private diagnostic when provided to reveal and repair the orphaned record; server logs remain the fallback. Then rerun backfill-user-storage-accounting.'
      };
    case 'invalid_sandbox_marker':
      return {
        status: 409,
        message:
					'A billable Thing has an invalid sandbox marker. Ledgers remain fenced. Use the private diagnostic when provided to reveal and repair the malformed record; server logs remain the fallback. Then rerun backfill-user-storage-accounting.'
      };
    case 'invalid_attachment_envelope':
      return {
        status: 409,
        message:
					'An attachment has an invalid protected storage envelope. Ledgers remain fenced. Use the private diagnostic when provided to reveal and repair the malformed record; server logs remain the fallback. Then rerun backfill-user-storage-accounting.'
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
					'A billable Thing changed to an owner that is not a current user. Ledgers remain fenced. Use the private diagnostic when provided to reveal and repair the record; server logs remain the fallback. Then rerun backfill-user-storage-accounting.'
      };
    case 'billable_thing_churn':
      return {
        status: 409,
				message: 'A billable Thing kept changing during storage migration. Ledgers remain fenced. Retry after concurrent writes settle.'
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
	readonly #diagnosticObjectIds: readonly string[];

  constructor(code: MigrationOperatorCode, options: MigrationOperatorOptions = {}) {
    const presentation = operatorPresentation(code, options);
    super(options.internalMessage || presentation.message);
    this.name = 'MigrationOperatorError';
    this.code = code;
    this.status = presentation.status;
    this.publicMessage = presentation.message;
		this.#diagnosticObjectIds = Array.isArray(options.diagnosticObjectIds)
			? [...new Set(options.diagnosticObjectIds.filter((value) => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)).map((value) => value.toLowerCase()))].slice(
					0,
					32
			  )
			: [];
  }

	diagnosticRevealContext(): { mongodbObjectIds: readonly string[] } {
		return { mongodbObjectIds: this.#diagnosticObjectIds };
	}
}

const storageMutationPresentation = (error: StorageMutationError): { status: number; message: string } => {
	const status = Number.isSafeInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
	switch (error.code) {
		case 'quota_exceeded':
			return { status, message: 'Storage quota was exceeded while the migration was running.' };
		case 'accounting_unavailable':
			return { status, message: 'Storage accounting is unavailable or still being initialized. Refresh status before retrying.' };
		case 'storage_conflict':
			return { status, message: 'Stored data changed while the migration was running. Refresh status before retrying.' };
		case 'storage_invariant':
			return { status, message: 'Storage accounting found an invalid protected record. Inspect the private diagnostic before retrying.' };
	}
};

// Migrations are admin-only, but caught database messages can still contain
// document ids, hosts, or connection details. Map storage failures through a
// closed code catalogue; summarize every other exception by safe class/code
// while keeping the full original in server logs.
export const migrationFailureResult = (migrationId: unknown, error: unknown, outcome: MigrationFailure['outcome'] = 'unknown'): MigrationFailure => {
	const id = safeMigrationId(migrationId);
  if (error instanceof StorageMutationError) {
		console.error(`[migration ${id}]`, error);
		const presentation = storageMutationPresentation(error);
		return withDiagnosticSource(
			{
				ok: false,
				status: presentation.status,
				error: `Migration ${id} stopped before completion: ${presentation.message}`,
				outcome
			},
			error
		);
  }

  if (error instanceof MigrationOperatorError) {
    console.error(`[migration ${id}]`, error);
		return withDiagnosticSource(
			{
      ok: false,
      status: error.status,
      error: `Migration ${id} stopped before completion: ${error.publicMessage}`,
      outcome
			},
			error
		);
  }
  const detail = safeErrorText(error, `migration ${id}`, 'Unexpected migration error');
	return withDiagnosticSource(
		{
    ok: false,
    status: 500,
    error: `Migration ${id} stopped before completion: ${detail}. Refresh migration status before retrying.`,
    outcome
		},
		error
	);
};
