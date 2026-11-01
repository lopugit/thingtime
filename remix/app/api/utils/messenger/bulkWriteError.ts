type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	typeof value === 'object' && value !== null;

const hasWriteConcernEntries = (value: unknown): boolean =>
	Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null;

const hasWriteConcernFailure = (error: UnknownRecord): boolean => {
	// MongoBulkWriteError uses `err` when the write concern is the only
	// failure. Other bulk APIs and older driver shapes expose singular/plural
	// fields directly, so keep those fail-closed compatibility checks too.
	if (error.err !== undefined && error.err !== null) return true;
	if (error.writeConcernError !== undefined && error.writeConcernError !== null) return true;
	if (hasWriteConcernEntries(error.writeConcernErrors)) return true;

	const result = isRecord(error.result) ? error.result : null;
	if (!result) return false;

	// With unordered collection writes, mongodb@6 can report duplicate-key
	// writeErrors on the error while retaining a simultaneous write-concern
	// failure only on the BulkWriteResult.
	const getWriteConcernError = result.getWriteConcernError;
	if (typeof getWriteConcernError === 'function') {
		try {
			if (getWriteConcernError.call(result) !== undefined) return true;
		} catch {
			// If the driver's result cannot be inspected, never downgrade the
			// operation to a benign duplicate race.
			return true;
		}
	}

	const rawResult = isRecord(result.result) ? result.result : null;
	return !!rawResult && hasWriteConcernEntries(rawResult.writeConcernErrors);
};

const isDuplicateWriteError = (value: unknown): boolean => {
	if (!isRecord(value)) return false;
	const nested = isRecord(value.err) ? value.err : null;
	return (value.code ?? nested?.code) === 11000;
};

/**
 * Returns true only when every reported write failure is a duplicate key and
 * the bulk result carries no write-concern failure. This intentionally fails
 * closed for unknown or uninspectable driver shapes.
 */
export const isDuplicateOnlyBulkWriteError = (value: unknown): boolean => {
	if (!isRecord(value) || hasWriteConcernFailure(value)) return false;

	const writeErrors = Array.isArray(value.writeErrors)
		? value.writeErrors
		: value.code !== undefined
			? [value]
			: [];

	return writeErrors.length > 0 && writeErrors.every(isDuplicateWriteError);
};
