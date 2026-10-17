import React from 'react';
import type { LocalGmailDraft } from './googleModel';
import { nativeMailRequest } from './native';
import { mailRequest, localMailRequest, relayMailRequest } from './client';
import { emptyLocalMail, readMailLocal, writeMailLocal, type LocalMail } from './localStore';
import {
	mergeMailRows,
	localSyncAccount,
	publicMailAccount,
	validateMailAccount,
	validateMailInbox,
	type MailAccount,
	type MailBatch,
	type MailFolder,
	type MailInbox,
	type MailProtocol
} from './model';
const memory = new Map<string, LocalMail>();
const changes = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('thingtime-mail-changed') : null;
// Auth transitions clear the synchronous first-paint tier. Device records are
// separately encrypted and scoped to the signed-in owner.
if (typeof window !== 'undefined') window.addEventListener('thingtime:root-data-refresh', () => memory.clear());
export function useMail(ownerId: string) {
	const scope = `${location.origin}:${ownerId}`;
	const [data, setData] = React.useState(() => memory.get(scope) || emptyLocalMail());
	const current = React.useRef(data),
		live = React.useRef(true),
		controller = React.useRef(new AbortController());
	const [ready, setReady] = React.useState(memory.has(scope)),
		[busy, setBusy] = React.useState(false),
		[error, setError] = React.useState('');
	const working = React.useRef(false),
		epoch = React.useRef(0);
	const retry = React.useRef<{ payload: string; writeId: string } | null>(null);
	const publish = React.useCallback(
		(next: LocalMail) => {
			if (!live.current) return;
			current.current = next;
			memory.set(scope, { ...next, credentials: {}, connectorToken: '' });
			setData(next);
		},
		[scope]
	);
	const persist = async (next: LocalMail) => {
		if (!live.current) throw new Error('Mail closed.');
		const version = epoch.current;
		// Keep a bounded reading cache; accounts and proxy definitions are retained.
		const sorted = [...next.state.messages].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
		next = { ...next, state: { ...next.state, messages: sorted.slice(0, 2000) } };
		next = await writeMailLocal(ownerId, next);
		if (!live.current || epoch.current !== version) return;
		publish(next);
		window.dispatchEvent(new CustomEvent('thingtime:mail-changed', { detail: scope }));
		changes?.postMessage(scope);
	};
	const run = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
		if (working.current || !ready) return;
		working.current = true;
		setBusy(true);
		setError('');
		try {
			return await work();
		} catch (cause) {
			if (live.current) {
				setError(cause instanceof Error ? cause.message : 'Mail is unavailable.');
				if (cause instanceof Error && cause.message.includes('another tab')) {
					const saved = await readMailLocal(ownerId);
					if (live.current) publish(saved);
				}
			}
			return undefined;
		} finally {
			working.current = false;
			if (live.current) setBusy(false);
		}
	};
	const refresh = async (signal = controller.current.signal) => {
		const remote = {
			accounts: [] as MailAccount[],
			folders: [] as MailFolder[],
			messages: [] as LocalMail['state']['messages'],
			inboxes: [] as MailInbox[]
		};
		for (const [key, kind] of [
			['accounts', 'mail-account'],
			['folders', 'mail-folder'],
			['messages', 'mail-message'],
			['inboxes', 'mail-inbox']
		] as const) {
			let cursor: string | null = null;
			do {
				const page = await mailRequest(ownerId, undefined, { kind, ...(cursor ? { cursor } : {}) }, signal);
				remote[key].push(...page.records);
				cursor = page.nextCursor;
				// Message history is paged on the server; keep only this device's bounded cache.
				if (key === 'messages' && remote.messages.length >= 2000) break;
			} while (cursor && live.current);
		}
		if (!live.current || signal.aborted) return;
		const local = current.current;
		const accounts = mergeMailRows(
			remote.accounts,
			local.state.accounts.filter((account) => local.localAccountIds.includes(account.id))
		);
		const ids = new Set(accounts.map((account) => account.id));
		const localSyncIds = new Set(accounts.filter((account) => account.sync.local).map((account) => account.id));
		await persist({
			...local,
			state: {
				accounts,
				folders: mergeMailRows(
					remote.folders,
					local.state.folders.filter((folder) => local.localAccountIds.includes(folder.accountId) || localSyncIds.has(folder.accountId))
				).filter((folder) => ids.has(folder.accountId)),
				messages: mergeMailRows(
					local.state.messages.filter((message) => ids.has(message.accountId)),
					remote.messages
				),
				inboxes: mergeMailRows(
					remote.inboxes,
					local.state.inboxes.filter((inbox) => local.localInboxIds.includes(inbox.id))
				)
			}
		});
	};
	React.useEffect(() => {
		live.current = true;
		epoch.current++;
		controller.current = new AbortController();
		const signal = controller.current.signal;
		const receive = async (event: Event) => {
			const changedScope = event instanceof MessageEvent ? event.data : (event as CustomEvent).detail;
			if (changedScope !== scope || working.current) return;
			try {
				const saved = await readMailLocal(ownerId);
				if (!signal.aborted && !working.current && saved.storageRevision >= current.current.storageRevision) publish(saved);
			} catch {
				/* An explicit refresh reports unavailable device storage. */
			}
		};
		window.addEventListener('thingtime:mail-changed', receive);
		changes?.addEventListener('message', receive);
		working.current = true;
		setBusy(true);
		(async () => {
			try {
				const saved = await readMailLocal(ownerId);
				if (!live.current || signal.aborted) return;
				publish(saved);
				setReady(true);
			} catch {
				if (live.current && !signal.aborted) {
					setError('Device mail could not be opened. Reload before changing settings.');
					working.current = false;
					setBusy(false);
				}
				return;
			}
			try {
				await refresh(signal);
			} catch (cause) {
				if (live.current && !signal.aborted) setError(cause instanceof Error ? cause.message : 'Cloud mail is unavailable.');
			} finally {
				if (!signal.aborted) {
					working.current = false;
					setBusy(false);
				}
			}
		})();
		return () => {
			live.current = false;
			epoch.current++;
			controller.current.abort();
			window.removeEventListener('thingtime:mail-changed', receive);
			changes?.removeEventListener('message', receive);
		};
	}, [ownerId, publish, scope]); // Account-keyed parent remounts fence every pending callback.
	const saveAccount = (raw: MailAccount) =>
		run(async () => {
			let account = validateMailAccount(raw);
			const local = current.current,
				previous = local.state.accounts.find((item) => item.id === account.id);
			if (previous && previous.revision !== account.revision) throw new Error('These settings changed elsewhere. Reopen the editor.');
			const credentials = structuredClone(local.credentials[account.id] || {});
			for (const protocol of ['imap', 'pop3'] as const) {
				const server = account.servers[protocol];
				if (!server) {
					delete credentials[protocol];
					continue;
				}
				const old = credentials[protocol];
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
			if (remote) {
				const submitted = account.sync.cloud ? structuredClone(account) : publicMailAccount(account);
				if (local.localAccountIds.includes(account.id)) submitted.revision = 0;
				const payload = JSON.stringify(submitted);
				if (retry.current?.payload !== payload) retry.current = { payload, writeId: crypto.randomUUID() };
				const result = await mailRequest(
					ownerId,
					{ operation: 'save-account', account: submitted, writeId: retry.current.writeId },
					{},
					controller.current.signal
				);
				account = result.account;
				retry.current = null;
			} else account.revision++;
			const next = current.current;
			await persist({
				...next,
				localAccountIds: remote ? next.localAccountIds.filter((id) => id !== account.id) : [...new Set([...next.localAccountIds, account.id])],
				credentials: { ...next.credentials, [account.id]: account.sync.local ? credentials : {} },
				state: { ...next.state, accounts: mergeMailRows(next.state.accounts, [publicMailAccount(account)]) }
			});
			return true;
		});
	const saveInbox = (raw: MailInbox) =>
		run(async () => {
			const inbox = validateMailInbox(raw),
				local = current.current;
			if (inbox.folderIds.some((id) => !local.state.folders.some((folder) => folder.id === id)))
				throw new Error('Select folders from your connected accounts.');
			// Proxy inboxes containing local folders remain device-local. Cloud-only
			// definitions can be shared across the owner's devices through the API.
			const localOnly =
				local.localInboxIds.includes(inbox.id) ||
				inbox.folderIds.some((id) => {
					const accountId = local.state.folders.find((folder) => folder.id === id)!.accountId;
					return local.localAccountIds.includes(accountId) || !local.state.accounts.find((account) => account.id === accountId)?.sync.cloud;
				});
			const previous = local.state.inboxes.find((value) => value.id === inbox.id);
			if (previous && previous.revision !== inbox.revision) throw new Error('This inbox changed elsewhere. Reopen the editor.');
			if (localOnly && previous && !local.localInboxIds.includes(inbox.id))
				throw new Error('Create a new proxy inbox to include device-only folders. This saved view syncs across devices.');
			let saved = { ...inbox, revision: inbox.revision + 1 };
			if (!localOnly) {
				const payload = JSON.stringify(inbox);
				if (retry.current?.payload !== payload) retry.current = { payload, writeId: crypto.randomUUID() };
				saved = (await mailRequest(ownerId, { operation: 'save-inbox', inbox, writeId: retry.current.writeId }, {}, controller.current.signal)).inbox;
				retry.current = null;
			}
			await persist({
				...local,
				localInboxIds: localOnly ? [...new Set([...local.localInboxIds, inbox.id])] : local.localInboxIds.filter((id) => id !== inbox.id),
				state: { ...local.state, inboxes: mergeMailRows(local.state.inboxes, [saved]) }
			});
			return true;
		});
	const remove = (kind: 'mail-account' | 'mail-inbox', id: string) =>
		run(async () => {
			const local = current.current,
				account = kind === 'mail-account';
			const record = (account ? local.state.accounts : local.state.inboxes).find((row) => row.id === id);
			if (!record) return;
			if (!(account ? local.localAccountIds : local.localInboxIds).includes(id))
				await mailRequest(ownerId, { operation: 'delete', kind, id, revision: record.revision }, {}, controller.current.signal);
			const credentials = { ...local.credentials };
			delete credentials[id];
			await persist({
				...local,
				credentials,
				composeDrafts: account ? local.composeDrafts.filter((draft) => draft.accountId !== id) : local.composeDrafts,
				localAccountIds: local.localAccountIds.filter((value) => value !== id),
				localInboxIds: local.localInboxIds.filter((value) => value !== id),
				state: {
					...local.state,
					accounts: local.state.accounts.filter((row) => row.id !== id),
					folders: local.state.folders.filter((row) => row.accountId !== id),
					messages: local.state.messages.filter((row) => row.accountId !== id),
					inboxes: local.state.inboxes.filter((row) => row.id !== id)
				}
			});
			return true;
		});
	async function syncOne(account: MailAccount, protocol: MailProtocol, request: Record<string, unknown>, target: 'cloud' | 'local') {
		const local = current.current;
		const batch: MailBatch =
			account.provider === 'gmail'
				? await mailRequest(
						ownerId,
						{ operation: target === 'cloud' ? 'sync' : 'google-relay', id: account.id, protocol, ...request },
						{},
						controller.current.signal
				  )
				: target === 'cloud'
				? await mailRequest(ownerId, { operation: 'sync', id: account.id, protocol, ...request }, {}, controller.current.signal)
				: account.sync.transport === 'native'
				? await nativeMailRequest(localSyncAccount(account, local.credentials[account.id] || {}), { protocol, ...request }, controller.current.signal)
				: account.sync.transport === 'relay'
				? await relayMailRequest(
						ownerId,
						localSyncAccount(account, local.credentials[account.id] || {}),
						{ protocol, ...request },
						controller.current.signal
				  )
				: await localMailRequest(
						localSyncAccount(account, local.credentials[account.id] || {}),
						local.connectorToken,
						{ protocol, ...request },
						controller.current.signal
				  );
		const next = current.current;
		const folders = mergeMailRows(next.state.folders, batch.folders);
		const cursors = { ...next.cursors };
		if (!request.discover)
			batch.folders.forEach((folder) => {
				cursors[`${folder.id}:${target}`] = batch.nextCursor;
			});
		await persist({ ...next, cursors, state: { ...next.state, folders, messages: mergeMailRows(next.state.messages, batch.messages) } });
		return batch;
	}
	const sync = (selection: string, older = false) =>
		run(async () => {
			publish(await readMailLocal(ownerId));
			const state = current.current.state;
			const proxy = state.inboxes.find((inbox) => inbox.id === selection);
			const selectedFolders = proxy ? new Set(proxy.folderIds) : null;
			const failures: string[] = [];
			for (const account of state.accounts) {
				if (
					selection !== 'all' &&
					!proxy &&
					selection !== account.id &&
					!state.folders.some((folder) => folder.id === selection && folder.accountId === account.id)
				)
					continue;
				for (const target of ['cloud', 'local'] as const) {
					if (!account.sync[target]) continue;
					for (const protocol of (account.provider === 'gmail' ? ['gmail'] : ['imap', 'pop3']) as MailProtocol[]) {
						if (protocol !== 'gmail' && !account.servers[protocol]) continue;
						try {
							const discovered = await syncOne(account, protocol, { discover: true }, target);
							const folders = discovered.folders.filter((folder) =>
								selectedFolders
									? selectedFolders.has(folder.id)
									: selection === 'all'
									? folder.inbox
									: selection === account.id || selection === folder.id
							);
							for (const folder of folders) {
								const cursor = current.current.cursors[`${folder.id}:${target}`];
								if (older && !cursor) continue;
								await syncOne(account, protocol, { path: folder.path, ...(older ? { cursor } : {}) }, target);
							}
						} catch (cause) {
							failures.push(`${account.name} (${target}, ${protocol.toUpperCase()}): ${cause instanceof Error ? cause.message : 'Sync failed.'}`);
						}
					}
				}
			}
			if (failures.length) throw new Error(failures.join('\n'));
			return true;
		});
	const gmailAttempt = React.useRef<{ payload: string; writeId: string } | null>(null);
	const googleAction = (accountId: string, mutation: Record<string, unknown>) =>
		run(async () => {
			const account = current.current.state.accounts.find((item) => item.id === accountId);
			if (!account || account.provider !== 'gmail') throw new Error('Choose a connected Gmail account.');
			const payload = JSON.stringify({ id: accountId, mutation });
			if (gmailAttempt.current?.payload !== payload) gmailAttempt.current = { payload, writeId: crypto.randomUUID() };
			const result = await mailRequest(
				ownerId,
				{ operation: 'google-action', id: accountId, revision: account.revision, mutation, writeId: gmailAttempt.current.writeId },
				{},
				controller.current.signal
			);
			gmailAttempt.current = null;
			if (result.remoteId && Array.isArray(result.labelIds)) {
				const next = current.current;
				const allowed = new Set(
					next.state.folders.filter((folder) => folder.accountId === accountId && result.labelIds.includes(folder.path)).map((folder) => folder.id)
				);
				await persist({
					...next,
					state: {
						...next.state,
						messages: next.state.messages
							.filter((message) => message.accountId !== accountId || message.remoteId !== result.remoteId || allowed.has(message.folderId))
							.map((message) =>
								message.accountId === accountId && message.remoteId === result.remoteId ? { ...message, unread: result.unread } : message
							)
					}
				});
			}
			return result;
		});
	const saveCompose = async (draft: LocalGmailDraft, remove = false) => {
		const next = await readMailLocal(ownerId);
		const previous = next.composeDrafts.find((item) => item.id === draft.id);
		if ((previous?.localRevision || 0) !== draft.localRevision) throw new Error('This draft changed in another tab. Reopen it before editing.');
		if (!previous && next.composeDrafts.length >= 30) throw new Error('Keep at most 30 device drafts. Send or close an existing draft first.');
		const saved = { ...draft, localRevision: draft.localRevision + 1 };
		await persist({ ...next, composeDrafts: [...next.composeDrafts.filter((item) => item.id !== draft.id), ...(remove ? [] : [saved])] });
		return saved;
	};
	return {
		data,
		googleAction,
		saveCompose,
		discover: (id: string) =>
			run(async () => {
				const account = current.current.state.accounts.find((account) => account.id === id);
				if (!account || account.provider !== 'gmail' || (!account.sync.cloud && !account.sync.local)) return;
				return syncOne(account, 'gmail', { discover: true }, account.sync.cloud ? 'cloud' : 'local');
			}),
		ready,
		busy,
		error,
		saveAccount,
		saveInbox,
		remove,
		sync,
		refresh: () =>
			run(async () => {
				publish(await readMailLocal(ownerId));
				return refresh();
			}),
		pair: (connectorToken: string) =>
			run(async () => {
				if (connectorToken.length < 32) throw new Error('Enter the connector pairing token (at least 32 characters).');
				await persist({ ...current.current, connectorToken });
				return true;
			})
	};
}
