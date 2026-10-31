import React from 'react';
import type { MailWorkspace } from './workspace.client';
import type { WorkspaceLease } from '../local-workspace/storage';
import { subscribeWorkspaceBinding } from '../local-workspace/runtime.client';
import type { LocalGmailDraft } from './googleModel';
import { nativeMailRequest } from './native';
import { mailRequest, localMailRequest, relayMailRequest } from './client';
import { emptyLocalMail, readMailLocal, writeMailLocal, updateMailLocal, type LocalMail } from './localStore';
import {
	editMailAccount,
	editMailInbox,
	deleteMailSettings,
	mergeMailSettings,
	mailSettingsPending,
	mailRemoteRevision,
	synchronizeMailSettings,
	adoptRemoteMailSettings,
	type MailSettingsWrite
} from './settingsSync';
import { mergeMailRows, localSyncAccount, type MailAccount, type MailBatch, type MailFolder, type MailInbox, type MailProtocol } from './model';
const memory = new Map<string, LocalMail>();
const changes = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('thingtime-mail-changed') : null;
// Auth transitions clear the synchronous first-paint tier. Device records are
// separately encrypted and scoped to the signed-in owner.
if (typeof window !== 'undefined') window.addEventListener('thingtime:root-data-refresh', () => memory.clear());
export function useMail(workspace: MailWorkspace) {
	const scope = workspace.key;
	const cloudAvailable = React.useSyncExternalStore(subscribeWorkspaceBinding, workspace.canSync, () => false);
	const ownerId = workspace.scope.kind === 'account' ? workspace.scope.ownerId : '';
	const allowCloud = () => {
		workspace.lease.assertCurrent();
		if (!workspace.canSync()) throw new Error('Sign in and reconnect to use Thingtime mail services.');
	};

	const [data, setData] = React.useState(() => memory.get(scope) || emptyLocalMail());
	const current = React.useRef(data),
		live = React.useRef(true),
		controller = React.useRef(new AbortController());
	const [ready, setReady] = React.useState(false),
		[busy, setBusy] = React.useState(false),
		[error, setError] = React.useState('');
	const storageLease = React.useCallback((): WorkspaceLease => {
		const signal = controller.current.signal;
		return {
			assertCurrent: () => {
				workspace.lease.assertCurrent();
				signal.throwIfAborted();
				if (!live.current) throw new Error('Mail closed.');
			},
			onInvalidate: (callback) => {
				signal.addEventListener('abort', callback, { once: true });
				const unsubscribe = workspace.lease.onInvalidate(callback);
				return () => {
					unsubscribe();
					signal.removeEventListener('abort', callback);
				};
			}
		};
	}, [workspace]);

	const working = React.useRef(false),
		epoch = React.useRef(0);

	const publish = React.useCallback(
		(next: LocalMail, reset = false) => {
			try {
				storageLease().assertCurrent();
			} catch {
				return;
			}
			if (!reset && next.storageRevision < current.current.storageRevision) return;
			current.current = next;
			memory.set(scope, { ...next, credentials: {}, connectorToken: '', settingsWrites: {} });
			setData(next);
		},
		[scope, storageLease]
	);
	const persist = React.useCallback(
		async (next: LocalMail) => {
			storageLease().assertCurrent();
			const version = epoch.current;
			next = await writeMailLocal(workspace.scope, next, storageLease());
			if (!live.current || epoch.current !== version) return;
			publish(next);
			window.dispatchEvent(new CustomEvent('thingtime:mail-changed', { detail: scope }));
			changes?.postMessage(scope);
		},
		[workspace, publish, scope, storageLease]
	);
	const run = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
		if (working.current || !ready) return;
		working.current = true;
		setBusy(true);
		setError('');
		try {
			storageLease().assertCurrent();
			return await work();
		} catch (cause) {
			if (live.current) {
				setError(cause instanceof Error ? cause.message : 'Mail is unavailable.');
				if (cause instanceof Error && cause.message.includes('another tab')) {
					const saved = await readMailLocal(workspace.scope, storageLease());
					if (live.current) publish(saved);
				}
			}
			return undefined;
		} finally {
			working.current = false;
			if (live.current) setBusy(false);
		}
	};
	const refresh = React.useCallback(
		async (signal = controller.current.signal, background = false) => {
			storageLease().assertCurrent();
			if (!workspace.canSync()) return;
			const revision = current.current.storageRevision;
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
				} while (cursor && live.current);
			}
			if (!live.current || signal.aborted || current.current.storageRevision !== revision || (background && working.current)) return;
			const local = current.current;
			const mergedAccounts = mergeMailSettings(local, 'mail-account', remote.accounts);
			const mergedInboxes = mergeMailSettings({ ...local, settingsRemoteRevisions: mergedAccounts.revisions }, 'mail-inbox', remote.inboxes);
			const accounts = mergedAccounts.values as MailAccount[];
			const ids = new Set(accounts.map((account) => account.id));
			const localSyncIds = new Set(accounts.filter((account) => account.sync.local).map((account) => account.id));
			await persist({
				...local,
				settingsRemoteRevisions: mergedInboxes.revisions,
				state: {
					accounts,
					folders: mergeMailRows(
						remote.folders,
						local.state.folders.filter((folder) => local.localAccountIds.includes(folder.accountId) || localSyncIds.has(folder.accountId))
					).filter((folder) => ids.has(folder.accountId)),
					messages: mergeMailRows(
						local.state.messages.filter((message) => ids.has(message.accountId)),
						remote.messages.filter((message) => ids.has(message.accountId))
					),
					inboxes: mergedInboxes.values as MailInbox[]
				}
			});
		},
		[ownerId, workspace, storageLease, persist]
	);
	React.useEffect(() => {
		const generation = epoch;
		live.current = true;
		generation.current++;
		controller.current = new AbortController();
		const signal = controller.current.signal;
		const unsubscribe = workspace.lease.onInvalidate(() => {
			controller.current.abort();
			memory.delete(scope);
			setData(emptyLocalMail());
			setReady(false);
		});
		const receive = async (event: Event) => {
			const changedScope = event instanceof MessageEvent ? event.data : (event as CustomEvent).detail;
			if (changedScope !== scope || working.current) return;
			try {
				const saved = await readMailLocal(workspace.scope, storageLease());
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
				const saved = await readMailLocal(workspace.scope, storageLease());
				if (!live.current || signal.aborted) return;
				publish(saved, true);
				setReady(true);
				working.current = false;
				setBusy(false);
			} catch {
				if (live.current && !signal.aborted) {
					setError('Device mail could not be opened. Reload before changing settings.');
					working.current = false;
					setBusy(false);
				}
				return;
			}
			try {
				await refresh(signal, true);
			} catch (cause) {
				if (live.current && !signal.aborted) setError(cause instanceof Error ? cause.message : 'Cloud mail is unavailable.');
			}
		})();
		return () => {
			unsubscribe();
			live.current = false;
			generation.current++;
			controller.current.abort();
			window.removeEventListener('thingtime:mail-changed', receive);
			changes?.removeEventListener('message', receive);
		};
	}, [workspace, publish, scope, storageLease, refresh]); // Account-keyed parent remounts fence every pending callback.
	const notify = React.useCallback(
		(next: LocalMail) => {
			publish(next);
			window.dispatchEvent(new CustomEvent('thingtime:mail-changed', { detail: scope }));
			changes?.postMessage(scope);
		},
		[publish, scope]
	);
	const syncingSettings = React.useRef(false);
	const syncSettings = React.useCallback(async () => {
		if (syncingSettings.current || !workspace.canSync()) return;
		syncingSettings.current = true;
		const signal = controller.current.signal;
		try {
			await synchronizeMailSettings(
				{ ...workspace, lease: storageLease() },
				(body, signal) => mailRequest(ownerId, body, {}, signal),
				signal,
				notify
			);
		} catch (cause) {
			if (live.current && !signal.aborted) setError(cause instanceof Error ? cause.message : 'Mail settings sync is unavailable.');
		} finally {
			syncingSettings.current = false;
		}
	}, [workspace, storageLease, ownerId, notify]);
	React.useEffect(() => {
		if (!ready || !cloudAvailable) return;
		void syncSettings();
		const timer = window.setInterval(() => void syncSettings(), 60_000);
		return () => window.clearInterval(timer);
	}, [ready, cloudAvailable, syncSettings]);
	const editSettings = (update: (local: LocalMail) => LocalMail) =>
		run(async () => {
			notify(await updateMailLocal(workspace.scope, storageLease(), update));
			void syncSettings();
			return true;
		});
	const saveAccount = (raw: MailAccount) => editSettings((local) => editMailAccount(local, workspace.scope, raw));
	const saveInbox = (raw: MailInbox) => editSettings((local) => editMailInbox(local, workspace.scope, raw));
	const remove = (kind: 'mail-account' | 'mail-inbox', id: string) => editSettings((local) => deleteMailSettings(local, workspace.scope, kind, id));
	const useAccountSettings = (reviewed: MailSettingsWrite) =>
		run(async () => {
			allowCloud();
			let cursor: string | null = null,
				remote: MailAccount | MailInbox | null = null;
			do {
				const page = await mailRequest(ownerId, undefined, { kind: reviewed.kind, ...(cursor ? { cursor } : {}) }, controller.current.signal);
				remote = page.records.find((item: MailAccount | MailInbox) => item.id === reviewed.id) ?? null;
				cursor = page.nextCursor;
			} while (!remote && cursor);
			notify(await updateMailLocal(workspace.scope, storageLease(), (local) => adoptRemoteMailSettings(local, reviewed, remote)));
			return true;
		});
	const remoteAccount = async (accountId: string): Promise<MailAccount> => {
		storageLease().assertCurrent();
		const local = await readMailLocal(workspace.scope, storageLease()),
			account = local.state.accounts.find((item) => item.id === accountId);
		if (!account) throw new Error('Choose a connected mail account.');
		if (mailSettingsPending(local, 'mail-account', accountId))
			throw new Error('Account settings are saved on this device. Sync or review them before using cloud mail.');
		return { ...account, revision: mailRemoteRevision(local, 'mail-account', account) };
	};
	async function syncOne(account: MailAccount, protocol: MailProtocol, request: Record<string, unknown>, target: 'cloud' | 'local') {
		storageLease().assertCurrent();
		if (target === 'cloud' || account.provider === 'gmail' || account.sync.transport === 'relay') allowCloud();
		if (target === 'cloud' || account.provider === 'gmail') await remoteAccount(account.id);
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
			publish(await readMailLocal(workspace.scope, storageLease()));
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
			const account = await remoteAccount(accountId);
			if (account.provider !== 'gmail') throw new Error('Choose a connected Gmail account.');
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
		let saved!: LocalGmailDraft;
		const next = await updateMailLocal(workspace.scope, storageLease(), (local) => {
			if (!local.state.accounts.some((account) => account.id === draft.accountId && account.provider === 'gmail'))
				throw new Error('This draft’s Gmail account is no longer connected.');
			const previous = local.composeDrafts.find((item) => item.id === draft.id);
			if ((previous?.localRevision || 0) !== draft.localRevision) throw new Error('This draft changed in another tab. Reopen it before editing.');
			saved = { ...draft, localRevision: draft.localRevision + 1 };
			return { ...local, composeDrafts: [...local.composeDrafts.filter((item) => item.id !== draft.id), ...(remove ? [] : [saved])] };
		});
		notify(next);
		return saved;
	};
	return {
		data,
		remoteAccount,
		syncSettings,
		useAccountSettings,
		cloudAvailable,
		anonymous: workspace.scope.kind === 'anonymous',
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
				publish(await readMailLocal(workspace.scope, storageLease()));
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
