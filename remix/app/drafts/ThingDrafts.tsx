import React from 'react';
import { Flex } from '@chakra-ui/react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { parseThingtime, stringifyThingtimeForStorage } from '~/Providers/thingtimeSerialization';
import { readLocalCache, clearLocalCache } from '~/hooks/localCache';
import { useLopu } from '~/components/Lopu/useLopu';
import { DraftPicker, DraftSaveStatus } from './DraftPicker';
import { createDraftSession, type DraftSaveState } from './draftSession';
import { draftRequest } from './draftClient';
import type { AccountDraft } from './draftCore';

const RESERVED = new Set(['tmp', 'settings', 'timemachine', 'set', 'get', '__proto__', 'prototype', 'constructor']);
const DraftContext = React.createContext<{
	load: (draft: AccountDraft) => Promise<void>;
	flush: () => Promise<void>;
	forget: (id: string) => Promise<void>;
	retry: () => Promise<void>;
	status: DraftSaveState;
	error: string;
} | null>(null);
export function ThingDraftsProvider({ children }: { children: React.ReactNode }) {
	const user = useCurrentUser(),
		{ events, setThingtime } = useThingtime(),
		lopu = useLopu();
	const sessions = React.useRef(new Map<string, ReturnType<typeof createDraftSession>>());
	const warned = React.useRef(false);
	const active = React.useRef(true);
	const failures = React.useRef(new Map<string, DraftSaveState>());
	const [status, setStatus] = React.useState<DraftSaveState>('idle'),
		[error, setError] = React.useState('');
	const sessionFor = React.useCallback(
		(context: string) => {
			if (!user?.id) return null;
			if (sessions.current.has(context)) return sessions.current.get(context)!;
			const key = `tt-account-draft:${location.origin}:${user.id}:${context}`;
			const session = createDraftSession({
				seed: readLocalCache(key),
				uuid: () => crypto.randomUUID(),
				save: async (input) => (await draftRequest(user.id, { operation: 'save', ...input })).draft,
				copy: async (input) => (await draftRequest(user.id, { operation: 'recover', ...input })).draft,
				persist: (value) => {
					if (!value) {
						clearLocalCache(key);
						return;
					}
					try {
						localStorage.setItem(key, JSON.stringify(value));
					} catch {
						if (!warned.current) {
							warned.current = true;
							lopu({
								title: 'Device draft storage is full',
								description: 'Keep this page open until your account draft has synced.',
								status: 'error'
							});
						}
					}
				},
				changed: (status, error) => {
					failures.current.set(context, status);
					if (active.current) {
						setStatus(status);
						setError(error || '');
					}
					if ((status === 'offline' || status === 'conflict') && !warned.current) {
						warned.current = true;
						lopu({ title: 'Your Thing draft is waiting to sync', description: error, status: 'info' });
					}
				}
			});
			sessions.current.set(context, session);
			return session;
		},
		[lopu, user?.id]
	);
	React.useEffect(() => {
		active.current = true;
    const activeSessions = sessions.current;
		const subscription = events?.subscribe((event: any) => {
			if (event?.type !== 'draft-edit' || !user) return;
			const path = event.path as string[];
			if (!path?.length || RESERVED.has(path[0])) return;
			try {
				const serialized = stringifyThingtimeForStorage(event.value);
				sessionFor(`thing:${path.join('.')}`)?.capture({
					name: path.join('.').slice(0, 160),
					surface: 'thing',
					context: `thing:${path.join('.')}`,
					snapshot: JSON.stringify({ path, serialized }),
					attachmentIds: []
				});
			} catch {
				lopu({ title: 'This Thing could not be saved as a draft', status: 'error' });
			}
		});
		const flush = () => {
			for (const session of sessions.current.values()) void session.flush().catch(() => {});
		};
		const retry = () => {
			for (const session of sessions.current.values()) void session.retry().catch(() => {});
		};
		window.addEventListener('pagehide', flush);
		window.addEventListener('online', retry);
		return () => {
			subscription?.unsubscribe();
			window.removeEventListener('pagehide', flush);
			window.removeEventListener('online', retry);
			active.current = false;
			queueMicrotask(() => {
				if (!active.current) for (const session of activeSessions.values()) session.dispose();
			});
		};
	}, [events, lopu, sessionFor, user]);
	const load = async (draft: AccountDraft) => {
		if (draft.surface !== 'thing') throw new Error('Open this draft in its original editor');
		const value = JSON.parse(draft.snapshot);
		if (
			!Array.isArray(value.path) ||
			value.path.length !== 1 ||
			typeof value.path[0] !== 'string' ||
			RESERVED.has(value.path[0]) ||
			['tt', 'thingtime'].includes(value.path[0])
		)
			throw new Error('Invalid Thing draft');
		const session = sessionFor(`thing:${value.path[0]}`);
		await session?.load(draft);
		const latest = JSON.parse(session?.current()?.content.snapshot || draft.snapshot);
		setThingtime(latest.path, parseThingtime(latest.serialized), { namespace: 'user' });
	};
	const flush = async () => {
		await Promise.all([...sessions.current.values()].map((session) => session.flush()));
	};
	const forget = async (id: string) => {
		for (const session of sessions.current.values()) if (session.current()?.id === id) await session.clear(async () => {});
	};
	const retry = async () => {
		await Promise.all(
			[...sessions.current.entries()].map(([key, session]) => (failures.current.get(key) === 'conflict' ? session.saveCopy() : session.retry()))
		);
	};
	return <DraftContext.Provider value={{ load, flush, forget, retry, status, error }}>{children}</DraftContext.Provider>;
}
export function ThingDraftPicker() {
	const user = useCurrentUser(),
		drafts = React.useContext(DraftContext);
	return user && drafts ? (
		<Flex px={3} py={2} gap={3} justify="flex-end" flexWrap="wrap">
			<DraftSaveStatus status={drafts.status} error={drafts.error} retry={drafts.retry} />
			<DraftPicker actor={user.id} surface="thing" onLoad={drafts.load} beforeOpen={drafts.flush} onDeleted={drafts.forget} />
		</Flex>
	) : null;
}
