/** One portable key grammar for every provider; archived names are never keys. */
export function assertBackupObjectKey(key: string): void {
	if (
		!/^(chunks\/[a-f0-9]{64}|snapshots\/[0-9a-f-]{36}\/(header|plan|complete)\.json|snapshots\/[0-9a-f-]{36}\/plan\/(0|[1-9][0-9]{0,15})\.json|snapshots\/[0-9a-f-]{36}\/ranges\/(0|[1-9][0-9]{0,15})\/(0|[1-9][0-9]{0,15})\.json)$/.test(
			key
		)
	)
		throw Error('Invalid backup storage key');
}
