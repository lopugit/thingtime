import type { MailWorkspace } from './workspace.client';
import { readMailLocal, updateMailLocal, type LocalMail } from './localStore';
import { publicMailAccount, validateMailAccount, validateMailInbox, type MailAccount, type MailInbox } from './model';

export type MailSettingsKind = 'mail-account' | 'mail-inbox';
type Value = MailAccount | MailInbox;
export type MailSettingsIntent = { value: Value; localRevision: number } | { remove: true; localRevision: number };
export type MailSettingsWrite = {
	kind: MailSettingsKind;
	id: string;
	name: string;
	desired: MailSettingsIntent;
	attempt?: { writeId: string; revision: number; intent: MailSettingsIntent };
	claim?: { token: string; until: number };
	status?: number;
	retryAt?: number;
};
export const mailSettingsKey = (kind: MailSettingsKind, id: string) => `${kind}:${id}`;
export const mailSettingsPending = (local: LocalMail, kind: MailSettingsKind, id: string) => local.settingsWrites[mailSettingsKey(kind, id)];
export const mailRemoteRevision = (local: LocalMail, kind: MailSettingsKind, record: Value) =>
	local.settingsRemoteRevisions[mailSettingsKey(kind, record.id)] ?? record.revision;
const canonical = (kind: MailSettingsKind, value: Value) =>
	kind === 'mail-account' ? publicMailAccount(validateMailAccount(value)) : validateMailInbox(value);
const same = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	const ak = Object.keys(a).sort(),
		bk = Object.keys(b).sort();
	return ak.length === bk.length && ak.every((k, i) => k === bk[i] && same((a as any)[k], (b as any)[k]));
};
/** Coalesce only unsent intent. Once dispatched, an attempt is immutable until
 * its original receipt arrives; newer device edits live beside it. */
export function queueMailSettings(
	local: LocalMail,
	scope: MailWorkspace['scope'],
	kind: MailSettingsKind,
	id: string,
	name: string,
	desired: MailSettingsIntent,
	remoteRevision: number
): LocalMail {
	if (scope.kind !== 'account') throw new Error('Anonymous mail never queues account changes.');
	const key = mailSettingsKey(kind, id),
		previous = local.settingsWrites[key];
	return {
		...local,
		settingsRemoteRevisions: { ...local.settingsRemoteRevisions, [key]: local.settingsRemoteRevisions[key] ?? remoteRevision },
		settingsWrites: { ...local.settingsWrites, [key]: { ...previous, kind, id, name, desired: structuredClone(desired) } }
	};
}
/** Keep the device edit counter monotonic, independent of the server token. */
export function mergeMailSettings(local: LocalMail, kind: MailSettingsKind, remote: Value[]) {
	const current: Value[] = kind === 'mail-account' ? local.state.accounts : local.state.inboxes;
	const localIds = kind === 'mail-account' ? local.localAccountIds : local.localInboxIds;
	const revisions = { ...local.settingsRemoteRevisions },
		values: Value[] = [];
	for (const raw of remote) {
		const value = canonical(kind, raw),
			old = current.find((item) => item.id === value.id),
			key = mailSettingsKey(kind, value.id);
		if (local.settingsWrites[key] || localIds.includes(value.id)) continue;
		if (value.revision < (local.settingsRemoteRevisions[key] ?? -1)) {
			if (old) values.push(old);
			continue;
		}
		revisions[key] = value.revision;
		const revision = old ? (same({ ...old, revision: 0 }, { ...value, revision: 0 }) ? old.revision : old.revision + 1) : value.revision;
		values.push({ ...value, revision });
	}
	for (const value of current) if (localIds.includes(value.id) || local.settingsWrites[mailSettingsKey(kind, value.id)]) values.push(value);
	return { values, revisions };
}
export function removeMailSettings(local: LocalMail, kind: MailSettingsKind, id: string): LocalMail {
	const account = kind === 'mail-account',
		credentials = { ...local.credentials };
	if (account) delete credentials[id];
	return {
		...local,
		credentials,
		composeDrafts: account ? local.composeDrafts.filter((draft) => draft.accountId !== id) : local.composeDrafts,
		localAccountIds: account ? local.localAccountIds.filter((value) => value !== id) : local.localAccountIds,
		localInboxIds: account ? local.localInboxIds : local.localInboxIds.filter((value) => value !== id),
		state: {
			...local.state,
			accounts: account ? local.state.accounts.filter((row) => row.id !== id) : local.state.accounts,
			folders: account ? local.state.folders.filter((row) => row.accountId !== id) : local.state.folders,
			messages: account ? local.state.messages.filter((row) => row.accountId !== id) : local.state.messages,
			inboxes: account ? local.state.inboxes : local.state.inboxes.filter((row) => row.id !== id)
		}
	};
}
export function mailSettingsBody(write: MailSettingsWrite): Record<string, unknown> {
	const attempt = write.attempt!;
	if ('remove' in attempt.intent) return { operation: 'delete', kind: write.kind, id: write.id, revision: attempt.revision };
	return {
		operation: write.kind === 'mail-account' ? 'save-account' : 'save-inbox',
		[write.kind === 'mail-account' ? 'account' : 'inbox']: { ...attempt.intent.value, revision: attempt.revision },
		writeId: attempt.writeId
	};
}
const refused = (status?: number) => !!status && [400, 403, 404, 409, 410, 413, 422].includes(status);
export const mailSettingsStatus = (write: MailSettingsWrite) =>
	refused(write.status) ? 'Account sync needs review. Your device changes are kept.' : 'Saved on this device. Waiting to sync account settings.';
/** Each record has a durable claim. Network work never owns the local editing
 * lock. A lost receipt retries the same body; other records can still progress. */
export async function synchronizeMailSettings(
	workspace: MailWorkspace,
	transport: (body: Record<string, unknown>, signal: AbortSignal) => Promise<any>,
	signal: AbortSignal,
	changed: (value: LocalMail) => void = () => {},
	now = Date.now
) {
	if (workspace.scope.kind !== 'account' || !workspace.canSync()) return;
	const active = () => {
		workspace.lease.assertCurrent();
		signal.throwIfAborted();
		if (!workspace.canSync()) throw new Error('Mail account sync is offline.');
	};
	const initial = await readMailLocal(workspace.scope, workspace.lease);
	for (const key of Object.keys(initial.settingsWrites)) {
		active();
		const token = crypto.randomUUID();
		const claimed = await updateMailLocal(workspace.scope, workspace.lease, (local) => {
			const write = local.settingsWrites[key];
			if (!write || refused(write.status) || (write.claim?.until ?? 0) > now() || (write.retryAt ?? 0) > now()) return local;
			const attempt = write.attempt ?? {
				writeId: crypto.randomUUID(),
				revision: local.settingsRemoteRevisions[key],
				intent: structuredClone(write.desired)
			};
			if (!Number.isSafeInteger(attempt.revision) || attempt.revision < 0)
				throw new Error('Mail sync revision is unavailable. Device changes are kept.');
			return { ...local, settingsWrites: { ...local.settingsWrites, [key]: { ...write, attempt, claim: { token, until: now() + 60_000 } } } };
		});
		const write = claimed.settingsWrites[key];
		if (write?.claim?.token !== token) continue;
		changed(claimed);
		try {
			active();
			const response = await transport(mailSettingsBody(write), signal);
			active();
			const attempt = write.attempt!;
			if (!('remove' in attempt.intent)) {
				const record = canonical(write.kind, response[write.kind === 'mail-account' ? 'account' : 'inbox']);
				const expected = canonical(write.kind, { ...attempt.intent.value, revision: attempt.revision + 1 });
				if (!same(record, expected)) throw new Error('Mail save receipt did not match. Device changes are kept.');
			}
			const adopted = await updateMailLocal(workspace.scope, workspace.lease, (local) => {
				const current = local.settingsWrites[key];
				if (current?.claim?.token !== token) return local;
				const pending = { ...local.settingsWrites };
				if (current.desired.localRevision === attempt.intent.localRevision) delete pending[key];
				else pending[key] = { kind: current.kind, id: current.id, name: current.name, desired: current.desired };
				return { ...local, settingsWrites: pending, settingsRemoteRevisions: { ...local.settingsRemoteRevisions, [key]: attempt.revision + 1 } };
			});
			changed(adopted);
		} catch (error) {
			active();
			const status = Number((error as any)?.status);
			const retained = await updateMailLocal(workspace.scope, workspace.lease, (local) => {
				const current = local.settingsWrites[key];
				if (current?.claim?.token !== token) return local;
				return {
					...local,
					settingsWrites: {
						...local.settingsWrites,
						[key]: {
							...current,
							claim: undefined,
							status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined,
							retryAt: now() + 60_000
						}
					}
				};
			});
			changed(retained);
		}
	}
}
/** Explicit review binds replacement to the entire saved intent. An uncertain
 * request cannot be discarded: obtain its receipt first. */
export function adoptRemoteMailSettings(local: LocalMail, reviewed: MailSettingsWrite, remote: Value | null): LocalMail {
	const key = mailSettingsKey(reviewed.kind, reviewed.id),
		current = local.settingsWrites[key];
	if (!current || !same(current, reviewed) || !refused(current.status) || current.claim)
		throw new Error('These settings changed or a save is still uncertain. Review them again.');
	const settingsWrites = { ...local.settingsWrites };
	delete settingsWrites[key];
	let next = { ...local, settingsWrites };
	if (!remote) return removeMailSettings(next, reviewed.kind, reviewed.id);
	const value = canonical(reviewed.kind, remote);
	if (value.id !== reviewed.id || value.revision < (local.settingsRemoteRevisions[key] ?? 0))
		throw new Error('The account returned different or older mail settings.');
	const field = reviewed.kind === 'mail-account' ? 'accounts' : 'inboxes';
	const records: Value[] = local.state[field];
	const revision = Math.max(current.desired.localRevision, records.find((item) => item.id === value.id)?.revision ?? 0) + 1;
	next = {
		...next,
		settingsRemoteRevisions: { ...next.settingsRemoteRevisions, [key]: value.revision },
		state: { ...next.state, [field]: [...records.filter((item) => item.id !== value.id), { ...value, revision }] }
	};
	return next;
}

export function editMailAccount(local: LocalMail, scope: MailWorkspace['scope'], raw: MailAccount): LocalMail {
	const account = validateMailAccount(raw),
		previous = local.state.accounts.find((item) => item.id === account.id);
	if (scope.kind === 'anonymous' && (account.sync.cloud || account.provider === 'gmail' || account.sync.transport === 'relay'))
		throw new Error('Anonymous mail uses this device or a paired connector. Sign in for cloud, API relay or Google authorization.');
	if (!previous && mailSettingsPending(local, 'mail-account', account.id))
		throw new Error('This account has a pending removal. Create a new account instead.');
	if ((previous?.revision ?? 0) !== account.revision) throw new Error('These settings changed elsewhere. Reopen the editor.');
	if (previous && (previous.provider !== account.provider || (previous.provider === 'gmail' && previous.address !== account.address)))
		throw new Error('Connect a new account to change its Google identity.');
	if (!previous && account.provider === 'gmail') throw new Error('Connect this account with Google first.');
	const credentials = structuredClone(local.credentials[account.id] || {});
	// A newly supplied cloud password may live only in the encrypted pending save.
	const waiting = mailSettingsPending(local, 'mail-account', account.id)?.desired;
	const pendingServers = waiting && 'value' in waiting && 'servers' in waiting.value ? waiting.value.servers : {};
	for (const protocol of ['imap', 'pop3'] as const) {
		const server = account.servers[protocol];
		if (!server) {
			delete credentials[protocol];
			continue;
		}
		const old = credentials[protocol] ?? pendingServers[protocol];
		if (
			!server.password &&
			old?.host === server.host &&
			old.port === server.port &&
			old.username === server.username &&
			old.security === server.security
		)
			server.password = old.password;
		if (account.sync.local && !server.password) throw new Error('Enter an app password to enable local sync.');
		credentials[protocol] = { ...server };
	}
	const remote = account.provider === 'gmail' || account.sync.cloud || (previous && !local.localAccountIds.includes(account.id));
	const saved = { ...account, revision: account.revision + 1 };
	let next: LocalMail = {
		...local,
		localAccountIds: remote ? local.localAccountIds.filter((id) => id !== account.id) : [...new Set([...local.localAccountIds, account.id])],
		credentials: { ...local.credentials, [account.id]: account.sync.local ? credentials : {} },
		state: { ...local.state, accounts: [...local.state.accounts.filter((item) => item.id !== account.id), publicMailAccount(saved)] }
	};
	if (remote)
		next = queueMailSettings(
			next,
			scope,
			'mail-account',
			account.id,
			account.name,
			{ value: account.sync.cloud ? saved : publicMailAccount(saved), localRevision: saved.revision },
			previous && !local.localAccountIds.includes(account.id) ? mailRemoteRevision(local, 'mail-account', previous) : 0
		);
	return next;
}
export function editMailInbox(local: LocalMail, scope: MailWorkspace['scope'], raw: MailInbox): LocalMail {
	const inbox = validateMailInbox(raw),
		previous = local.state.inboxes.find((item) => item.id === inbox.id);
	if (!previous && mailSettingsPending(local, 'mail-inbox', inbox.id))
		throw new Error('This inbox has a pending removal. Create a new inbox instead.');
	if ((previous?.revision ?? 0) !== inbox.revision) throw new Error('This inbox changed elsewhere. Reopen the editor.');
	if (inbox.folderIds.some((id) => !local.state.folders.some((folder) => folder.id === id)))
		throw new Error('Select folders from your connected accounts.');
	const localOnly =
		scope.kind === 'anonymous' ||
		local.localInboxIds.includes(inbox.id) ||
		inbox.folderIds.some((id) => {
			const accountId = local.state.folders.find((folder) => folder.id === id)!.accountId;
			return local.localAccountIds.includes(accountId) || !local.state.accounts.find((account) => account.id === accountId)?.sync.cloud;
		});
	if (localOnly && previous && !local.localInboxIds.includes(inbox.id))
		throw new Error('Create a new proxy inbox to include device-only folders. This saved view syncs across devices.');
	const saved = { ...inbox, revision: inbox.revision + 1 };
	let next: LocalMail = {
		...local,
		localInboxIds: localOnly ? [...new Set([...local.localInboxIds, inbox.id])] : local.localInboxIds.filter((id) => id !== inbox.id),
		state: { ...local.state, inboxes: [...local.state.inboxes.filter((item) => item.id !== inbox.id), saved] }
	};
	if (!localOnly)
		next = queueMailSettings(
			next,
			scope,
			'mail-inbox',
			inbox.id,
			inbox.name,
			{ value: saved, localRevision: saved.revision },
			previous ? mailRemoteRevision(local, 'mail-inbox', previous) : 0
		);
	return next;
}
export function deleteMailSettings(local: LocalMail, scope: MailWorkspace['scope'], kind: MailSettingsKind, id: string): LocalMail {
	const account = kind === 'mail-account',
		record = (account ? local.state.accounts : local.state.inboxes).find((row) => row.id === id);
	if (!record) return local;
	let next = removeMailSettings(local, kind, id);
	const key = mailSettingsKey(kind, id),
		pending = local.settingsWrites[key];
	if (pending && !pending.attempt && local.settingsRemoteRevisions[key] === 0) {
		const settingsWrites = { ...next.settingsWrites };
		delete settingsWrites[key];
		return { ...next, settingsWrites };
	}
	if (!(account ? local.localAccountIds : local.localInboxIds).includes(id))
		next = queueMailSettings(
			next,
			scope,
			kind,
			id,
			record.name,
			{ remove: true, localRevision: record.revision + 1 },
			mailRemoteRevision(local, kind, record)
		);
	return next;
}
