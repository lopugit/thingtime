import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, unlinkSync } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { isAbsolute, join, resolve } from 'node:path';
import {
	buildAuthorizationUrl,
	exchangeAuthorization,
	refreshCredentials,
	listModels,
	revokeCredentials,
	ChatGPTPlanError,
	PLAN_SCOPE,
	RESOURCE,
	type ChatGPTAuthorizationAttempt,
	type ChatGPTCredentials,
	type ChatGPTModel,
	validateChatGPTIdentity,
	ISSUER
} from './chatgptPlanProtocol';

import { createMongoChatGPTPlanStorage, type ChatGPTPlanStorage, type ChatGPTStorageRecord } from './chatgptPlanStorage';
import {
	createTransferRecipient,
	validateTransferRecipient,
	validateTransferBundle,
	sealTransfer,
	openTransfer,
	type ChatGPTTransferRecipient,
	type ChatGPTTransferBundle
} from './chatgptPlanTransfer';

export interface ChatGPTPlanScope {
	ownerId: string;
	origin: string;
	sessionId: string;
}
interface Account {
	id: string;
	scope: string;
	clientId?: string;
	subject?: string;
	email?: string;
	credentials?: ChatGPTCredentials;
	models: ChatGPTModel[];
	model: string | null;
}
interface Store {
	version: 1;
	hostId: string;
	accounts: Account[];
	recipients?: Array<{ id: string; scope: string; session: string; descriptor: ChatGPTTransferRecipient; privateKey: string }>;
	outbound?: Array<{ id: string; scope: string; accountId: string; descriptor: ChatGPTTransferRecipient; bundle: ChatGPTTransferBundle }>;
	receipts?: Array<{ id: string; scope: string; session: string; bundleHash: string; accountId: string }>;
}
interface Attempt {
	id: string;
	scope: string;
	session: string;
	accountId: string;
	protocol: ChatGPTAuthorizationAttempt;
	status: 'pending' | 'connecting' | 'connected' | 'cancelled' | 'failed';
	error?: string;
	server: Server;
	timer: ReturnType<typeof setTimeout>;
	revalidate: () => Promise<boolean>;
}
export interface ChatGPTPlanAccount {
	id: string;
	label: string;
	email?: string;
	connected: boolean;
	model: string | null;
	models: ChatGPTModel[];
}
export class ChatGPTPlanRuntimeError extends Error {
	constructor(readonly code: string, message: string, readonly status = 400) {
		super(message);
		this.name = 'ChatGPTPlanRuntimeError';
	}
}
interface Dependencies {
	exchange: typeof exchangeAuthorization;
	refresh: typeof refreshCredentials;
	models: typeof listModels;
	revoke: typeof revokeCredentials;
	now: () => number;
	attemptTimeoutMs: number;
	storage?: ChatGPTPlanStorage;
	identity: typeof validateChatGPTIdentity;
	allowLoopbackAuthorization?: boolean;
}
const defaults: Dependencies = {
	exchange: exchangeAuthorization,
	refresh: refreshCredentials,
	models: listModels,
	revoke: revokeCredentials,
	now: Date.now,
	attemptTimeoutMs: 10 * 60_000,
	identity: validateChatGPTIdentity
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (a: string, b: string) => {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
};
export const isChatGPTPlanProviderId = (id: unknown): id is string => typeof id === 'string' && id.startsWith('chatgpt-plan-');
function scopeKey(scope: ChatGPTPlanScope) {
	let origin: URL;
	try {
		origin = new URL(scope.origin);
	} catch {
		throw new ChatGPTPlanRuntimeError('invalid_scope', 'A verified Thingtime origin is required.');
	}
	if (!scope.ownerId || !scope.sessionId || !['http:', 'https:'].includes(origin.protocol) || origin.origin !== scope.origin) {
		throw new ChatGPTPlanRuntimeError('invalid_scope', 'A verified Thingtime account and origin are required.');
	}
	return digest(JSON.stringify([scope.ownerId, origin.origin]));
}
function safeFailure(error: unknown) {
	return error instanceof ChatGPTPlanError || error instanceof ChatGPTPlanRuntimeError
		? error.message
		: 'ChatGPT connection could not be completed. Try again.';
}

/** One explicitly configured runtime owns refresh-token rotation. Never clone runtime identity or run multiple refresh owners; move credentials explicitly. */
export class ChatGPTPlanRuntime {
	private readonly deps: Dependencies;
	private readonly directory: string;
	private readonly lockPath: string;
	private readonly storePath: string;
	private store!: Store;
	private ready?: Promise<void>;
	private queue: Promise<unknown> = Promise.resolve();
	private attempts = new Map<string, Attempt>();
	private controllers = new Map<string, AbortController>();
	private closed = false;
	private ownsLock = false;
	private storageFailed = false;
	private storageReady = false;
	private readonly onExit = () => {
		if (this.ownsLock) {
			try {
				unlinkSync(this.lockPath);
			} catch {
				/* fail closed on next startup */
			}
		}
	};
	constructor(directory: string, dependencies: Partial<Dependencies> = {}) {
		if (!isAbsolute(directory)) throw new ChatGPTPlanRuntimeError('invalid_directory', 'ChatGPT plan storage requires an absolute local directory.');
		this.directory = resolve(directory);
		this.lockPath = join(this.directory, '.runtime.lock');
		this.storePath = join(this.directory, dependencies.storage ? 'identity.json' : 'accounts.json');
		this.deps = { ...defaults, ...dependencies };
	}
	private async initialize() {
		if (this.storageFailed)
			throw new ChatGPTPlanRuntimeError(
				'storage_failed',
				'ChatGPT plan storage failed. Restart the runtime after repairing its private storage.',
				503
			);
		if (this.closed) throw new ChatGPTPlanRuntimeError('runtime_closed', 'ChatGPT plan runtime is unavailable.', 503);
		if (!this.ready)
			this.ready = (async () => {
				await mkdir(this.directory, { recursive: true, mode: 0o700 });
				const stat = await lstat(this.directory);
				if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid()))
					throw new ChatGPTPlanRuntimeError('unsafe_directory', 'ChatGPT plan storage must be a private directory with mode 0700.', 503);
				let lock;
				try {
					lock = await open(this.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
				} catch {
					throw new ChatGPTPlanRuntimeError(
						'runtime_locked',
						'Another runtime owns ChatGPT plan storage. Stop it before starting this runtime; after a crash, remove only its stale .runtime.lock.',
						503
					);
				}
				this.ownsLock = true;
				await lock.writeFile(String(process.pid));
				await lock.close();
				process.once('exit', this.onExit);
				try {
					const file = await open(this.storePath, constants.O_RDONLY | constants.O_NOFOLLOW);
					try {
						const stat = await file.stat();
						if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('permissions');
						const value = JSON.parse(await file.readFile('utf8')) as Store;
						if (value.version !== 1 || !/^urn:uuid:[0-9a-f-]{36}$/.test(value.hostId) || !Array.isArray(value.accounts)) throw new Error('store');
						this.store = value;
					} finally {
						await file.close();
					}
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
						throw new ChatGPTPlanRuntimeError('invalid_store', 'ChatGPT plan storage could not be opened securely.', 503);
					this.store = { version: 1, hostId: `urn:uuid:${randomUUID()}`, accounts: [] };
					await this.persist();
				}
				if (this.deps.storage) {
					// DB mode never silently copies a live file credential store into a second refresh authority.
					try {
						const legacy = await open(join(this.directory, 'accounts.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
						try {
							const value = JSON.parse(await legacy.readFile('utf8')) as Store;
							if (value.accounts.some((account) => account.credentials))
								throw new ChatGPTPlanRuntimeError(
									'migration_required',
									'Move existing file-based ChatGPT accounts explicitly before enabling database storage.',
									503
								);
						} finally {
							await legacy.close();
						}
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
					}
					const rows = await this.deps.storage.load(this.store.hostId);
					this.store.accounts = rows.filter((row) => row.type === 'account').map((row) => row.value as Account);
					this.store.recipients = rows.filter((row) => row.type === 'recipient').map((row) => row.value as NonNullable<Store['recipients']>[number]);
					this.store.outbound = rows.filter((row) => row.type === 'outbound').map((row) => row.value as NonNullable<Store['outbound']>[number]);
					this.store.receipts = rows.filter((row) => row.type === 'receipt').map((row) => row.value as NonNullable<Store['receipts']>[number]);
					this.storageReady = true;
				}
			})();
		await this.ready;
	}
	private async persist() {
		try {
			if (this.deps.storage && this.storageReady) {
				const records: ChatGPTStorageRecord[] = [
					...this.store.accounts.map((value) => ({ type: 'account' as const, id: value.id, scope: value.scope, value })),
					...(this.store.recipients ?? []).map((value) => ({ type: 'recipient' as const, id: value.id, scope: value.scope, value })),
					...(this.store.outbound ?? []).map((value) => ({ type: 'outbound' as const, id: value.id, scope: value.scope, value })),
					...(this.store.receipts ?? []).map((value) => ({ type: 'receipt' as const, id: value.id, scope: value.scope, value }))
				];
				await this.deps.storage.save(records);
				return;
			}
			const temp = join(this.directory, `.${randomUUID()}.tmp`);
			const file = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
			try {
				await file.writeFile(JSON.stringify(this.store));
				await file.sync();
			} finally {
				await file.close();
			}
			try {
				await rename(temp, this.storePath);
				const directory = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
				try {
					await directory.sync();
				} finally {
					await directory.close();
				}
			} finally {
				await unlink(temp).catch(() => undefined);
			}
		} catch {
			this.storageFailed = true;
			throw new ChatGPTPlanRuntimeError(
				'storage_failed',
				'ChatGPT credentials could not be saved securely. Restart after repairing local storage.',
				503
			);
		}
	}
	private exclusive<T>(work: () => Promise<T>): Promise<T> {
		const result = this.queue.then(async () => {
			await this.initialize();
			if (this.deps.storage) await this.deps.storage.assertAuthority();
			return work();
		});
		this.queue = result.catch(() => undefined);
		return result;
	}
	private account(key: string, id: string) {
		const account = this.store.accounts.find((value) => value.scope === key && value.id === id);
		if (!account) throw new ChatGPTPlanRuntimeError('account_missing', 'The selected ChatGPT account is unavailable. Connect it again.', 404);
		return account;
	}
	private controller(key: string, id: string) {
		const leaseKey = `${key}:${id}`;
		let controller = this.controllers.get(leaseKey);
		if (!controller) {
			controller = new AbortController();
			this.controllers.set(leaseKey, controller);
		}
		return controller;
	}
	private abortAccount(key: string, id: string) {
		this.controller(key, id).abort();
	}

	private projection(account: Account): ChatGPTPlanAccount {
		return {
			id: account.id,
			label: account.email ?? 'ChatGPT plan',
			...(account.email ? { email: account.email } : {}),
			connected: !!account.credentials?.scopes.includes(PLAN_SCOPE) && account.credentials.scopes.includes('resource.invoke'),
			model: account.model,
			models: account.models.map(({ slug, displayName }) => ({ slug, displayName }))
		};
	}
	async list(scope: ChatGPTPlanScope) {
		const key = scopeKey(scope);
		return this.exclusive(async () => ({
			accounts: this.store.accounts.filter((value) => value.scope === key).map((value) => this.projection(value))
		}));
	}
	private canAuthorize(scope: ChatGPTPlanScope) {
		return this.deps.allowLoopbackAuthorization === true || ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(scope.origin).hostname);
	}
	async status(scope: ChatGPTPlanScope) {
		const key = scopeKey(scope);
		const session = digest(scope.sessionId);
		const { accounts } = await this.list(scope);
		for (const [id, attempt] of this.attempts)
			if (!['pending', 'connecting'].includes(attempt.status) && (attempt.protocol.expiresAt ?? 0) < this.deps.now()) this.attempts.delete(id);
		return {
			accounts,
			canAuthorize: this.canAuthorize(scope),
			storageMode: this.deps.storage ? ('mongodb' as const) : ('file' as const),
			attempts: [...this.attempts.values()]
				.filter((value) => value.scope === key && value.session === session)
				.map(({ id, status, error }) => ({ id, status, ...(error ? { error } : {}) }))
		};
	}
	async begin(scope: ChatGPTPlanScope, revalidate: () => Promise<boolean>, accountId?: string) {
		const key = scopeKey(scope);
		if (!this.canAuthorize(scope))
			throw new ChatGPTPlanRuntimeError(
				'local_callback_required',
				'Connect ChatGPT in the local Thingtime app, then move the connection to this API.',
				409
			);
		const session = digest(scope.sessionId);
		return this.exclusive(async () => {
			if (!(await revalidate())) throw new ChatGPTPlanRuntimeError('session_expired', 'Sign in to Thingtime again.', 401);
			for (const attempt of this.attempts.values())
				if (attempt.scope === key && attempt.session === session && ['pending', 'connecting'].includes(attempt.status))
					this.stop(attempt, 'cancelled');
			const account = accountId ? this.account(key, accountId) : undefined;
			const id = randomUUID();
			const expiresAt = this.deps.now() + this.deps.attemptTimeoutMs;
			const server = createServer((request, response) => {
				const attempt = this.attempts.get(id);
				response.setHeader('Content-Type', 'text/plain; charset=utf-8');
				response.setHeader('Cache-Control', 'no-store');
				response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
				let url: URL;
				try {
					url = new URL(request.url ?? '/', 'http://127.0.0.1');
				} catch {
					response.statusCode = 400;
					response.end('Invalid callback.');
					return;
				}
				if (
					request.method !== 'GET' ||
					url.pathname !== '/auth/callback' ||
					!attempt ||
					attempt.status !== 'pending' ||
					request.headers.host !== new URL(attempt.protocol.redirectUri).host ||
					url.searchParams.getAll('state').length !== 1 ||
					!same(url.searchParams.get('state') ?? '', attempt.protocol.state)
				) {
					response.statusCode = 400;
					response.end('This sign-in request is invalid or expired.');
					return;
				}
				attempt.status = 'connecting'; // Consume before awaiting any external work.
				void this.complete(attempt, url.searchParams)
					.then((ok) => {
						response.statusCode = ok ? 200 : 400;
						response.end(ok ? 'ChatGPT connected. Return to Thingtime.' : 'ChatGPT was not connected. Return to Thingtime for details.');
					})
					.catch(() => {
						response.statusCode = 500;
						response.end('ChatGPT was not connected. Return to Thingtime.');
					});
			});
			await new Promise<void>((resolve, reject) => {
				server.once('error', reject);
				server.listen(0, '127.0.0.1', resolve);
			});
			const address = server.address();
			if (!address || typeof address === 'string') {
				server.close();
				throw new ChatGPTPlanRuntimeError('listener_failed', 'The local sign-in listener could not start.');
			}
			const protocol: ChatGPTAuthorizationAttempt = {
				hostId: this.store.hostId,
				redirectUri: `http://127.0.0.1:${address.port}/auth/callback`,
				state: randomBytes(32).toString('base64url'),
				nonce: randomBytes(32).toString('base64url'),
				codeVerifier: randomBytes(48).toString('base64url'),
				expiresAt,
				...(account?.clientId ? { clientId: account.clientId, expectedSubject: account.subject } : {})
			};
			const timer = setTimeout(() => {
				const attempt = this.attempts.get(id);
				if (attempt && ['pending', 'connecting'].includes(attempt.status)) this.stop(attempt, 'failed', 'ChatGPT sign-in expired. Start again.');
			}, this.deps.attemptTimeoutMs);
			timer.unref();
			server.unref();
			this.attempts.set(id, {
				id,
				scope: key,
				session,
				accountId: account?.id ?? `chatgpt-plan-${randomUUID()}`,
				protocol,
				status: 'pending',
				server,
				timer,
				revalidate
			});
			return { attemptId: id, authorizationUrl: buildAuthorizationUrl(protocol) };
		});
	}
	private stop(attempt: Attempt, status: Attempt['status'], error?: string) {
		attempt.status = status;
		attempt.error = error;
		clearTimeout(attempt.timer);
		attempt.server.close();
	}
	private async complete(attempt: Attempt, params: URLSearchParams) {
		return this.exclusive(async () => {
			const active = () => attempt.status === 'connecting' && this.deps.now() < (attempt.protocol.expiresAt ?? 0) && !this.closed;
			let credentials: ChatGPTCredentials | undefined;
			let previous: Account | undefined;
			let committedIndex: number | undefined;
			try {
				if (!active() || !(await attempt.revalidate())) throw new ChatGPTPlanRuntimeError('session_expired', 'Sign in to Thingtime again.', 401);
				let account = this.store.accounts.find((value) => value.id === attempt.accountId && value.scope === attempt.scope);
				// Keep the issued registration if exchange fails, while keeping an existing session untouched.
				const issued = params.get('client_id');
				if (!account && !params.has('error') && params.getAll('client_id').length === 1 && /^oaiapp_[A-Za-z0-9_-]+$/.test(issued ?? '')) {
					account = { id: attempt.accountId, scope: attempt.scope, clientId: issued!, models: [], model: null };
					this.store.accounts.push(account);
					await this.persist();
				}
				credentials = await this.deps.exchange(attempt.protocol, params);
				if (!active() || !(await attempt.revalidate()))
					throw new ChatGPTPlanRuntimeError('session_expired', 'The connection was cancelled or the Thingtime session ended.', 401);
				// A reconnect is a separate candidate until its identity, plan models and requesting session are verified.
				const models = await this.deps.models(credentials);
				if (!active() || !(await attempt.revalidate()))
					throw new ChatGPTPlanRuntimeError('session_expired', 'The connection was cancelled or the Thingtime session ended.', 401);
				previous = account;
				const candidate: Account = {
					id: attempt.accountId,
					scope: attempt.scope,
					clientId: credentials.clientId,
					subject: credentials.subject,
					email: credentials.email,
					credentials,
					models,
					model: models.some((model) => model.slug === account?.model) ? account!.model : models[0]?.slug ?? null
				};
				const index = account ? this.store.accounts.indexOf(account) : this.store.accounts.length;
				this.store.accounts[index] = candidate;
				committedIndex = index;
				await this.persist();
				if (!active() || !(await attempt.revalidate())) throw new ChatGPTPlanRuntimeError('cancelled', 'The ChatGPT connection was cancelled.');
				// Replacement commits cancel old inference leases; cancelled/failed attempts never invalidate them.
				this.abortAccount(attempt.scope, attempt.accountId);
				this.controllers.set(`${attempt.scope}:${attempt.accountId}`, new AbortController());
				this.stop(attempt, 'connected');
				return true;
			} catch (error) {
				if (committedIndex !== undefined) {
					if (previous) this.store.accounts[committedIndex] = previous;
					else this.store.accounts.splice(committedIndex, 1);
					await this.persist().catch(() => undefined); // Storage failure already fences every subsequent operation.
				}
				if (this.storageFailed) this.abortAccount(attempt.scope, attempt.accountId);
				if (credentials) await this.deps.revoke(credentials).catch(() => undefined);
				if (['pending', 'connecting'].includes(attempt.status)) this.stop(attempt, 'failed', safeFailure(error));
				return false;
			}
		});
	}

	async cancel(scope: ChatGPTPlanScope, attemptId: string) {
		const key = scopeKey(scope);
		const attempt = this.attempts.get(attemptId);
		if (attempt && attempt.scope === key && attempt.session === digest(scope.sessionId) && ['pending', 'connecting'].includes(attempt.status))
			this.stop(attempt, 'cancelled');
	}
	private async refreshed(account: Account) {
		if (!account.credentials) throw new ChatGPTPlanRuntimeError('connection_required', 'Reconnect this ChatGPT account before sending.', 401);
		let credentials = account.credentials;
		if (credentials.expiresAt <= this.deps.now() + 60_000 && (!credentials.earliestRefreshAt || credentials.earliestRefreshAt <= this.deps.now())) {
			try {
				credentials = await this.deps.refresh(credentials);
				account.credentials = credentials;
				await this.persist();
			} catch (error) {
				if (error instanceof ChatGPTPlanError && error.reauthenticate) {
					this.abortAccount(account.scope, account.id);
					delete account.credentials;
					account.models = [];
					account.model = null;
					await this.persist();
				}
				throw error;
			}
		}
		if (credentials.expiresAt <= this.deps.now())
			throw new ChatGPTPlanRuntimeError('token_expired', 'ChatGPT authorization is temporarily unavailable. Try again later.', 503);
		if (!credentials.scopes.includes(PLAN_SCOPE) || !credentials.scopes.includes('resource.invoke'))
			throw new ChatGPTPlanError('plan_permission_missing', 403);
		return credentials;
	}
	async selectModel(scope: ChatGPTPlanScope, id: string, model: string) {
		const key = scopeKey(scope);
		return this.exclusive(async () => {
			const account = this.account(key, id);
			const credentials = await this.refreshed(account);
			account.models = await this.deps.models(credentials);
			if (!account.models.some((value) => value.slug === model))
				throw new ChatGPTPlanRuntimeError('model_unavailable', 'This model is unavailable for the selected ChatGPT account.');
			account.model = model;
			await this.persist();
			return this.projection(account);
		});
	}
	async disconnect(scope: ChatGPTPlanScope, id: string) {
		const key = scopeKey(scope);
		this.abortAccount(key, id);
		for (const attempt of this.attempts.values()) if (attempt.scope === key && attempt.accountId === id) this.stop(attempt, 'cancelled');
		return this.exclusive(async () => {
			const account = this.account(key, id);
			const credentials = account.credentials;
			delete account.credentials;
			account.models = [];
			account.model = null;
			await this.persist();
			let remoteRevoked = !credentials;
			if (credentials) {
				try {
					await this.deps.revoke(credentials);
					remoteRevoked = true;
				} catch {
					remoteRevoked = false;
				}
			}
			return { remoteRevoked };
		});
	}
	async resolveProvider(scope: ChatGPTPlanScope, id: string) {
		const key = scopeKey(scope);
		return this.exclusive(async () => {
			const account = this.account(key, id);
			const credentials = await this.refreshed(account);
			if (!account.model || !account.models.some((value) => value.slug === account.model))
				throw new ChatGPTPlanRuntimeError('model_required', 'Choose an available model for this ChatGPT account.');
			return {
				id: account.id,
				name: `${account.email ?? 'ChatGPT'} plan`,
				provider: 'openai' as const,
				endpoint: RESOURCE,
				model: account.model,
				token: credentials.accessToken,
				authMode: 'chatgpt-plan' as const,
				authSignal: this.controller(key, id).signal
			};
		});
	}
	private async requireSession(revalidate?: () => Promise<boolean>) {
		if (revalidate && !(await revalidate())) throw new ChatGPTPlanRuntimeError('session_expired', 'Sign in to Thingtime again.', 401);
	}
	async prepareImport(scope: ChatGPTPlanScope, revalidate?: () => Promise<boolean>) {
		const key = scopeKey(scope);
		return this.exclusive(async () => {
			await this.requireSession(revalidate);
			const created = createTransferRecipient(scope.origin, scope.ownerId, this.deps.now());
			this.store.recipients ??= [];
			this.store.recipients = this.store.recipients.filter((recipient) => recipient.descriptor.expiresAt > this.deps.now());
			this.store.recipients.push({
				id: created.descriptor.id,
				scope: key,
				session: digest(scope.sessionId),
				descriptor: created.descriptor,
				privateKey: created.privateKey
			});
			await this.persist();
			return created.descriptor;
		});
	}
	async moveAccount(scope: ChatGPTPlanScope, id: string, input: unknown, revalidate?: () => Promise<boolean>): Promise<ChatGPTTransferBundle> {
		const key = scopeKey(scope);
		return this.exclusive(async () => {
			await this.requireSession(revalidate);
			const recipientId = input && typeof input === 'object' ? (input as { id?: unknown }).id : undefined;
			const receipt = this.store.outbound?.find((entry) => entry.id === recipientId && entry.scope === key);
			const recipient = validateTransferRecipient(input, receipt ? Math.min(this.deps.now(), receipt.descriptor.expiresAt - 1) : this.deps.now());
			if (receipt) {
				if (receipt.accountId !== id || JSON.stringify(receipt.descriptor) !== JSON.stringify(recipient))
					throw new ChatGPTPlanRuntimeError('transfer_mismatch', 'This transfer recipient belongs to a different move.', 409);
				return receipt.bundle;
			}
			if (recipient.targetOrigin === scope.origin && recipient.targetOwnerId === scope.ownerId)
				throw new ChatGPTPlanRuntimeError('same_destination', 'Choose a different account or API as the destination.');
			const account = this.account(key, id);
			const credentials = await this.refreshed(account);
			await this.deps.identity(credentials.idToken, credentials.clientId, { subject: credentials.subject });
			await this.requireSession(revalidate);
			validateTransferRecipient(recipient, this.deps.now());
			const bundle = sealTransfer(recipient, scope.origin, {
				version: 1,
				clientId: account.clientId,
				subject: account.subject,
				credentials,
				model: account.model
			});
			if (Buffer.byteLength(JSON.stringify({ action: 'import-account', bundle }), 'utf8') > 128 * 1024)
				throw new ChatGPTPlanRuntimeError('transfer_too_large', 'This connection is too large to transfer. Your source remains connected.', 413);
			// One transaction/file replacement removes refresh authority before ciphertext can leave this API.
			for (const attempt of this.attempts.values())
				if (attempt.scope === key && attempt.accountId === id && ['pending', 'connecting'].includes(attempt.status)) this.stop(attempt, 'cancelled');
			this.abortAccount(key, id);
			delete account.credentials;
			account.models = [];
			account.model = null;
			this.store.outbound ??= [];
			this.store.outbound.push({ id: recipient.id, scope: key, accountId: id, descriptor: recipient, bundle });
			await this.persist();
			return bundle;
		});
	}
	async importAccount(scope: ChatGPTPlanScope, input: unknown, revalidate?: () => Promise<boolean>): Promise<ChatGPTPlanAccount> {
		const key = scopeKey(scope);
		return this.exclusive(async () => {
			await this.requireSession(revalidate);
			const bundle = validateTransferBundle(input);
			const bundleHash = digest(JSON.stringify(bundle));
			const receipt = this.store.receipts?.find((entry) => entry.id === bundle.recipientId && entry.scope === key);
			if (receipt) {
				if (receipt.bundleHash !== bundleHash || receipt.session !== digest(scope.sessionId))
					throw new ChatGPTPlanRuntimeError('transfer_mismatch', 'This transfer was already consumed by another session.', 409);
				return this.projection(this.account(key, receipt.accountId));
			}
			const pending = this.store.recipients?.find(
				(entry) => entry.id === bundle.recipientId && entry.scope === key && entry.session === digest(scope.sessionId)
			);
			if (!pending || pending.descriptor.targetOrigin !== scope.origin || pending.descriptor.targetOwnerId !== scope.ownerId)
				throw new ChatGPTPlanRuntimeError('transfer_missing', 'Prepare a transfer in this account and API first.', 404);
			validateTransferRecipient(pending.descriptor, this.deps.now());
			const value = openTransfer(pending.descriptor, pending.privateKey, bundle) as {
				version?: unknown;
				clientId?: unknown;
				subject?: unknown;
				credentials?: ChatGPTCredentials;
				model?: unknown;
			};
			const credentials = value?.credentials;
			if (
				value?.version !== 1 ||
				!credentials ||
				credentials.issuer !== ISSUER ||
				!/^oaiapp_[A-Za-z0-9_-]+$/.test(credentials.clientId) ||
				credentials.clientId !== value.clientId ||
				!credentials.subject ||
				credentials.subject !== value.subject ||
				credentials.tokenType !== 'Bearer' ||
				![credentials.accessToken, credentials.refreshToken, credentials.idToken].every((token) => typeof token === 'string' && token.length > 0) ||
				!Number.isFinite(credentials.expiresAt) ||
				!Array.isArray(credentials.scopes) ||
				!credentials.scopes.every((scope) => typeof scope === 'string') ||
				!credentials.scopes.includes(PLAN_SCOPE) ||
				!credentials.scopes.includes('resource.invoke') ||
				(value.model !== null && typeof value.model !== 'string')
			)
				throw new ChatGPTPlanRuntimeError('invalid_transfer', 'The encrypted transfer does not contain a valid ChatGPT plan connection.');
			const identity = await this.deps.identity(credentials.idToken, credentials.clientId, { subject: credentials.subject });
			await this.requireSession(revalidate);
			const account: Account = {
				id: `chatgpt-plan-${randomUUID()}`,
				scope: key,
				clientId: credentials.clientId,
				subject: identity.subject,
				email: identity.email,
				credentials: {
					clientId: credentials.clientId,
					hostId: this.store.hostId,
					issuer: ISSUER,
					subject: identity.subject,
					email: identity.email,
					idToken: credentials.idToken,
					accessToken: credentials.accessToken,
					refreshToken: credentials.refreshToken,
					tokenType: 'Bearer',
					scopes: credentials.scopes,
					expiresAt: credentials.expiresAt,
					...(typeof credentials.earliestRefreshAt === 'number' ? { earliestRefreshAt: credentials.earliestRefreshAt } : {})
				},
				models: [],
				model: typeof value.model === 'string' ? value.model : null
			};
			this.store.accounts.push(account);
			this.store.receipts ??= [];
			this.store.receipts.push({ id: bundle.recipientId, scope: key, session: digest(scope.sessionId), bundleHash, accountId: account.id });
			this.store.recipients = this.store.recipients!.filter((entry) => entry !== pending);
			await this.persist(); // Consume the recipient and own credentials before any refresh can rotate them.
			try {
				account.models = await this.deps.models(await this.refreshed(account));
				if (!account.models.some((model) => model.slug === account.model)) account.model = account.models[0]?.slug ?? null;
				await this.persist();
			} catch {
				/* The imported account is durable; Refresh models can recover a provider outage. */
			}
			return this.projection(account);
		});
	}
	async refreshModels(scope: ChatGPTPlanScope, id: string, revalidate?: () => Promise<boolean>) {
		const key = scopeKey(scope);
		return this.exclusive(async () => {
			const account = this.account(key, id);
			await this.requireSession(revalidate);
			const models = await this.deps.models(await this.refreshed(account));
			await this.requireSession(revalidate);
			account.models = models;
			if (!models.some((model) => model.slug === account.model)) account.model = models[0]?.slug ?? null;
			await this.persist();
			return this.projection(account);
		});
	}

	async close() {
		this.closed = true;
		for (const controller of this.controllers.values()) controller.abort();
		for (const attempt of this.attempts.values()) this.stop(attempt, 'cancelled');
		await this.queue;
		await this.deps.storage?.close();
		process.removeListener('exit', this.onExit);
		if (this.ownsLock) {
			await unlink(this.lockPath);
			this.ownsLock = false;
		}
	}
}
let singleton: ChatGPTPlanRuntime | undefined;
export function getChatGPTPlanRuntime(): ChatGPTPlanRuntime | null {
	// This filesystem/loopback adapter requires one durable process. Serverless
	// execution needs a database-backed credential and refresh-lease adapter.
	const directory = process.env.THINGTIME_CHATGPT_PLAN_DIR;
	if (!directory || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY || process.env.CF_PAGES) return null;
	return (singleton ??= new ChatGPTPlanRuntime(directory, {
		...(process.env.THINGTIME_CHATGPT_PLAN_STORAGE === 'mongodb' ? { storage: createMongoChatGPTPlanStorage() } : {}),
		allowLoopbackAuthorization: process.env.THINGTIME_CHATGPT_PLAN_ALLOW_LOOPBACK_AUTHORIZATION === '1'
	}));
}

export async function closeChatGPTPlanRuntime() {
	const runtime = singleton;
	singleton = undefined;
	if (runtime) await runtime.close();
}
