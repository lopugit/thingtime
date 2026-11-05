import { WorkspaceError, type WorkspaceTransaction } from './storage';

/** Scoped aliases are navigation/lookup metadata. They never rewrite signed or
 * hashed History events, operation bodies, ownership or remote receipts. */
export const ACCOUNT_SUITE_ALIASES = 'account-suite-aliases';
export async function accountSuiteAliases(tx: WorkspaceTransaction): Promise<Map<string, string>> {
	const aliases = new Map((await tx.list<{ id: string; canonicalId: string }>(ACCOUNT_SUITE_ALIASES)).map(({ id, value }) => [id, value.canonicalId]));
	for (const id of aliases.keys()) {
		const seen = new Set<string>(); let next = id;
		while (aliases.has(next)) {
			if (seen.has(next)) throw new WorkspaceError('SUITE_IDENTITY_CONFLICT', 'Suite identity aliases are cyclic.', 409);
			seen.add(next); next = aliases.get(next)!;
		}
		aliases.set(id, next);
	}
	return aliases;
}
export async function resolveAccountSuiteId(tx: WorkspaceTransaction, id: string): Promise<string> {
	return (await accountSuiteAliases(tx)).get(id) || id;
}
