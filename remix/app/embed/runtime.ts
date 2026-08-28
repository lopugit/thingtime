import { cloneJson, errorMessage, getJsonPath, sanitizeJson, setJsonPath, type JsonValue } from './json';
import { createSafeThingMount, type SafeMountOptions } from './renderer';

export const EMBED_PROTOCOL = 'thingtime-embed/v1';
export const EMBED_VERSION = '0.1.0';

export type ThingVisibility = 'public' | 'private';

export type ThingDocument = {
	id: string;
	name: string;
	value: JsonValue;
	visibility: ThingVisibility;
	version: number;
	createdAt?: string;
	updatedAt?: string;
};

export type ThingtimeEmbedConfig = {
	apiBase?: string;
	thingId?: string;
	name?: string;
	visibility?: ThingVisibility;
	initialValue?: unknown;
	editable?: boolean;
	autoLoad?: boolean;
	autoOpen?: boolean;
};

type StatusTone = 'idle' | 'working' | 'success' | 'error';
type RuntimeStatus = { tone: StatusTone; message: string };
type StateListener = (value: JsonValue, detail: { source: string }) => void;
type MountRecord = { id: string; destroy: () => void };
type BridgeMessage = {
	protocol: typeof EMBED_PROTOCOL;
	channel: string;
	type: string;
	requestId?: string;
	payload?: any;
};

const CHROME_STYLES = `
:host { color-scheme: light; }
* { box-sizing: border-box; }
.tt-launcher { align-items:center; background:#18181b; border:0; border-radius:999px; bottom:18px; box-shadow:0 14px 40px rgba(0,0,0,.24); color:#fff; cursor:pointer; display:flex; font:700 13px/1 ui-sans-serif,system-ui; gap:8px; padding:12px 15px; position:fixed; right:18px; z-index:2147483000; }
.tt-launcher:focus-visible,.tt-button:focus-visible { outline:3px solid #f9a8d4; outline-offset:3px; }
.tt-window { background:#fff; border:1px solid #e4e4e7; border-radius:18px; bottom:72px; box-shadow:0 24px 80px rgba(0,0,0,.22); color:#18181b; display:flex; flex-direction:column; font:14px/1.4 ui-sans-serif,system-ui; max-height:min(720px,calc(100vh - 96px)); overflow:hidden; position:fixed; right:18px; width:min(460px,calc(100vw - 28px)); z-index:2147482999; }
.tt-window[hidden] { display:none; }
.tt-header { align-items:center; border-bottom:1px solid #ededf0; display:flex; gap:10px; padding:14px 15px; }
.tt-brand { font-size:16px; font-weight:850; letter-spacing:-.02em; }
.tt-subtitle { color:#71717a; font-size:11px; }
.tt-spacer { flex:1; }
.tt-actions { align-items:center; display:flex; flex-wrap:wrap; gap:7px; padding:10px 14px 0; }
.tt-button { background:#f4f4f5; border:1px solid #e4e4e7; border-radius:9px; color:#27272a; cursor:pointer; font:700 12px/1 ui-sans-serif,system-ui; padding:8px 10px; }
.tt-button-primary { background:#18181b; border-color:#18181b; color:#fff; }
.tt-close { background:transparent; border:0; color:#71717a; cursor:pointer; font-size:18px; padding:4px; }
.tt-status { color:#71717a; font-size:11px; min-height:26px; padding:8px 15px 0; }
.tt-status[data-tone="error"] { color:#b42318; }
.tt-status[data-tone="success"] { color:#18794e; }
.tt-body { min-height:140px; overflow:auto; padding:10px 14px 16px; }
@media (max-width:520px) { .tt-launcher { bottom:12px; right:12px; } .tt-window { border-radius:16px 16px 0 0; bottom:0; left:0; max-height:82vh; right:0; width:100vw; } }
`;

const randomChannel = () => {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	const bytes = new Uint8Array(24);
	globalThis.crypto?.getRandomValues?.(bytes);
	return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};

const booleanAttribute = (value: string | undefined, fallback: boolean) => {
	if (value === undefined) return fallback;
	return !['false', '0', 'no', 'off'].includes(value.toLowerCase());
};

const apiEndpoint = (apiBase: string) => new URL('/api/v1/embed/things', apiBase);

export class ThingtimeEmbedRuntime {
	readonly version = EMBED_VERSION;
	readonly ready: Promise<ThingtimeEmbedRuntime>;

	private config: Required<Omit<ThingtimeEmbedConfig, 'thingId' | 'initialValue'>> & {
		thingId?: string;
		initialValue?: JsonValue;
	};
	private value: JsonValue = { hello: 'Thingtime 🌈' };
	private document: ThingDocument | null = null;
	private status: RuntimeStatus = { tone: 'idle', message: 'Local Thingtime is ready.' };
	private stateListeners = new Set<StateListener>();
	private renderListeners = new Set<() => void>();
	private mounts = new Map<string, MountRecord>();
	private past: JsonValue[] = [];
	private future: JsonValue[] = [];
	private openState = false;
	private nonce?: string;
	private chromeHost: HTMLElement | null = null;
	private chromeShadow: ShadowRoot | null = null;
	private chromeTreeDestroy: (() => void) | null = null;
	private bridgeWindow: Window | null = null;
	private bridgeChannel = '';
	private bridgeReady = false;
	private bridgeReadyPromise: Promise<void> | null = null;
	private resolveBridgeReady: (() => void) | null = null;
	// In-flight popup handshake, so concurrent openSecureWindow() callers share
	// one popup instead of racing to open several.
	private bridgeConnect: Promise<void> | null = null;
	private pendingBridge = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void; timeout: number; closePoll: number }
	>();
	private destroyed = false;
	private startOnDomReady: (() => void) | null = null;
	private resolveReady: ((runtime: ThingtimeEmbedRuntime) => void) | null = null;

	constructor(config: ThingtimeEmbedConfig = {}, nonce?: string) {
		const apiBase = new URL(config.apiBase || window.location.origin, window.location.href).origin;
		this.config = {
			apiBase,
			name: config.name || 'Embedded thing',
			visibility: config.visibility === 'private' ? 'private' : 'public',
			editable: config.editable !== false,
			autoLoad: config.autoLoad !== false,
			autoOpen: config.autoOpen === true,
			thingId: config.thingId,
			initialValue: config.initialValue === undefined ? undefined : sanitizeJson(config.initialValue)
		};
		if (this.config.initialValue !== undefined) this.value = cloneJson(this.config.initialValue);
		this.nonce = nonce;
		this.onWindowMessage = this.onWindowMessage.bind(this);
		window.addEventListener('message', this.onWindowMessage);

		this.ready = new Promise((resolve) => {
			this.resolveReady = resolve;
			const start = () => {
				this.startOnDomReady = null;
				if (this.destroyed) {
					this.resolveReady?.(this);
					this.resolveReady = null;
					return;
				}
				this.installChrome();
				this.mountDeclaredTargets();
				if (this.config.autoOpen) this.open();
				if (this.config.thingId && this.config.autoLoad) {
					this.load(this.config.thingId).catch(() => {});
				}
				this.resolveReady?.(this);
				this.resolveReady = null;
			};
			if (document.readyState === 'loading') {
				this.startOnDomReady = start;
				document.addEventListener('DOMContentLoaded', start, { once: true });
			}
			else start();
		});
	}

	configure(next: ThingtimeEmbedConfig = {}) {
		if (next.apiBase) this.config.apiBase = new URL(next.apiBase, window.location.href).origin;
		if (next.thingId !== undefined) this.config.thingId = next.thingId || undefined;
		if (next.name !== undefined) this.config.name = next.name || 'Embedded thing';
		if (next.visibility !== undefined) this.config.visibility = next.visibility === 'private' ? 'private' : 'public';
		if (next.editable !== undefined) this.config.editable = next.editable;
		if (next.autoLoad !== undefined) this.config.autoLoad = next.autoLoad;
		if (next.autoOpen !== undefined) this.config.autoOpen = next.autoOpen;
		if (next.initialValue !== undefined) this.replace(next.initialValue, 'configure');
		this.notifyRender();
		return this;
	}

	get(path?: string | Array<string | number>) {
		const value = getJsonPath(this.value, path);
		return value === undefined ? undefined : cloneJson(value);
	}

	set(path: string | Array<string | number> | undefined, value: unknown) {
		const next = setJsonPath(this.value, path, value);
		this.commit(next, 'local');
		return this.get(path);
	}

	replace(value: unknown, source = 'local') {
		this.commit(sanitizeJson(value), source);
		return cloneJson(this.value);
	}

	subscribe(listener: StateListener) {
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	undo() {
		const previous = this.past.pop();
		if (previous === undefined) return cloneJson(this.value);
		this.future.push(cloneJson(this.value));
		this.value = previous;
		this.emitState('undo');
		this.postBridge('state', { value: this.value });
		return cloneJson(this.value);
	}

	redo() {
		const next = this.future.pop();
		if (next === undefined) return cloneJson(this.value);
		this.past.push(cloneJson(this.value));
		this.value = next;
		this.emitState('redo');
		this.postBridge('state', { value: this.value });
		return cloneJson(this.value);
	}

	mount(targetInput: string | Element, path?: string | Array<string | number>, options: SafeMountOptions = {}) {
		const target = typeof targetInput === 'string' ? document.querySelector(targetInput) : targetInput;
		if (!target) throw new Error(`Thingtime mount target was not found: ${String(targetInput)}`);

		const id = randomChannel();
		const mount = createSafeThingMount(
			target,
			{
				get: (mountPath) => this.get(mountPath),
				set: (mountPath, value) => this.set(mountPath, value),
				subscribe: (listener) => {
					this.renderListeners.add(listener);
					return () => this.renderListeners.delete(listener);
				}
			},
			path,
			{ editable: options.editable ?? this.config.editable, label: options.label },
			this.nonce
		);
		this.mounts.set(id, { id, destroy: mount.destroy });

		return {
			id,
			unmount: () => this.unmount(id)
		};
	}

	unmount(idOrHandle: string | { id: string }) {
		const id = typeof idOrHandle === 'string' ? idOrHandle : idOrHandle.id;
		const mount = this.mounts.get(id);
		if (!mount) return false;
		mount.destroy();
		this.mounts.delete(id);
		return true;
	}

	open() {
		this.openState = true;
		this.renderChrome();
		return this;
	}

	close() {
		this.openState = false;
		this.renderChrome();
		return this;
	}

	toggle() {
		return this.openState ? this.close() : this.open();
	}

	async load(id = this.config.thingId) {
		if (!id) throw new Error('Thing id is required to load');
		this.setStatus('working', 'Loading from Thingtime…');

		const url = apiEndpoint(this.config.apiBase);
		url.searchParams.set('id', id);
		const sameOrigin = url.origin === window.location.origin;
		try {
			const response = await fetch(url, {
				credentials: sameOrigin ? 'same-origin' : 'omit',
				mode: sameOrigin ? 'same-origin' : 'cors',
				headers: { Accept: 'application/json' }
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body?.ok !== true || !body?.thing) {
				throw new Error(body?.error || `Thingtime load failed (${response.status})`);
			}
			this.applyDocument(body.thing, 'load');
			this.setStatus('success', `Loaded “${this.document?.name || id}”.`);
			return this.document;
		} catch (error) {
			this.setStatus('error', errorMessage(error));
			throw error;
		}
	}

	async save() {
		const endpoint = apiEndpoint(this.config.apiBase);
		if (endpoint.origin === window.location.origin) return this.saveSameOrigin();

		try {
			this.setStatus('working', 'Opening a secure Thingtime window for your confirmation…');
			await this.openSecureWindow();
			const requestId = randomChannel();
			const result = await this.requestBridge('request-save', this.createBridgePayload(), requestId);
			if (result?.thing) this.applyDocument(result.thing, 'save');
			this.setStatus('success', `Saved “${this.document?.name || this.config.name}” to Thingtime.`);
			return this.document;
		} catch (error) {
			this.setStatus('error', errorMessage(error));
			throw error;
		}
	}

	async openSecureWindow() {
		if (window.location.origin === 'null') {
			throw new Error('The secure Thingtime window needs a normal http(s) host origin');
		}
		if (this.bridgeWindow && !this.bridgeWindow.closed && this.bridgeReady) {
			this.bridgeWindow.focus();
			this.postBridge('init', this.createBridgePayload());
			return;
		}

		// A second call while the first popup is still connecting must JOIN that
		// attempt. Minting a new channel would window.open() under a new window
		// name — a second popup — and strand the first: its bridge-ready still
		// carries the old channel, so onWindowMessage drops it forever, and the
		// first caller's ready promise (whose resolver was just overwritten) only
		// settles at the 15s timeout with "popup did not connect". The chrome shows
		// Save and "Full editor ↗" side by side while a ~1.7 MB bundle loads, so
		// double-clicking either one was enough.
		if (!this.bridgeConnect) {
			this.bridgeConnect = this.connectSecureWindow().finally(() => {
				this.bridgeConnect = null;
			});
		}
		await this.bridgeConnect;
		this.postBridge('init', this.createBridgePayload());
		this.bridgeWindow?.focus();
	}

	private async connectSecureWindow() {
		this.bridgeChannel = randomChannel();
		this.bridgeReady = false;
		this.bridgeReadyPromise = new Promise((resolve) => {
			this.resolveBridgeReady = resolve;
		});

		const url = new URL('/embed/bridge.html', this.config.apiBase);
		url.hash = new URLSearchParams({
			channel: this.bridgeChannel,
			parentOrigin: window.location.origin
		}).toString();
		this.bridgeWindow = window.open(url, `thingtime-embed-${this.bridgeChannel}`, 'popup=yes,width=760,height=820,resizable=yes,scrollbars=yes');
		if (!this.bridgeWindow) {
			this.setStatus('error', 'Your browser blocked the secure Thingtime popup. Allow popups and try again.');
			throw new Error('Thingtime popup was blocked');
		}

		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				window.clearTimeout(timeout);
				window.clearInterval(closePoll);
			};
			const timeout = window.setTimeout(() => {
				cleanup();
				reject(new Error('Thingtime popup did not connect'));
			}, 15_000);
			const closePoll = window.setInterval(() => {
				if (!this.bridgeWindow || this.bridgeWindow.closed) {
					cleanup();
					reject(new Error('Thingtime popup was closed before it connected'));
				}
			}, 300);
			this.bridgeReadyPromise?.then(() => {
				cleanup();
				resolve();
			});
		});
	}

	destroy() {
		this.destroyed = true;
		if (this.startOnDomReady) document.removeEventListener('DOMContentLoaded', this.startOnDomReady);
		this.startOnDomReady = null;
		this.resolveReady?.(this);
		this.resolveReady = null;
		this.mounts.forEach((mount) => mount.destroy());
		this.mounts.clear();
		this.chromeTreeDestroy?.();
		this.chromeHost?.remove();
		this.chromeHost = null;
		this.chromeShadow = null;
		window.removeEventListener('message', this.onWindowMessage);
		this.pendingBridge.forEach(({ reject, timeout, closePoll }) => {
			window.clearTimeout(timeout);
			window.clearInterval(closePoll);
			reject(new Error('Thingtime was destroyed'));
		});
		this.pendingBridge.clear();
		this.bridgeWindow?.close();
		this.bridgeWindow = null;
		this.stateListeners.clear();
		this.renderListeners.clear();
	}

	getDocument() {
		return this.document ? { ...this.document, value: cloneJson(this.document.value) } : null;
	}

	getStatus() {
		return { ...this.status };
	}

	private commit(next: JsonValue, source: string) {
		const serialized = JSON.stringify(next);
		if (serialized === JSON.stringify(this.value)) return;
		if (source !== 'bridge' && source !== 'load' && source !== 'configure') {
			this.past.push(cloneJson(this.value));
			if (this.past.length > 100) this.past.shift();
			this.future = [];
		}
		this.value = next;
		this.emitState(source);
		if (source !== 'bridge') this.postBridge('state', { value: this.value });
	}

	private emitState(source: string) {
		this.stateListeners.forEach((listener) => {
			try {
				listener(cloneJson(this.value), { source });
			} catch {
				// Host listeners are isolated so one integration cannot stale every mount.
			}
		});
		this.notifyRender();
	}

	private notifyRender() {
		this.renderListeners.forEach((listener) => {
			try {
				listener();
			} catch {
				// Keep the remaining mounts connected if one renderer is removed badly.
			}
		});
		this.renderChromeStatus();
	}

	private setStatus(tone: StatusTone, message: string) {
		this.status = { tone, message };
		this.notifyRender();
	}

	private applyDocument(input: unknown, source: string) {
		if (!input || typeof input !== 'object') throw new Error('Thingtime returned an invalid thing');
		const raw = input as any;
		const document: ThingDocument = {
			id: String(raw.id || ''),
			name: String(raw.name || 'Embedded thing'),
			value: sanitizeJson(raw.value),
			visibility: raw.visibility === 'private' ? 'private' : 'public',
			version: Number(raw.version || 1),
			createdAt: raw.createdAt ? String(raw.createdAt) : undefined,
			updatedAt: raw.updatedAt ? String(raw.updatedAt) : undefined
		};
		if (!document.id) throw new Error('Thingtime returned a thing without an id');
		this.document = document;
		this.config.thingId = document.id;
		this.config.name = document.name;
		this.config.visibility = document.visibility;
		this.commit(document.value, source);
	}

	private async saveSameOrigin() {
		this.setStatus('working', 'Saving to Thingtime…');
		try {
			const response = await fetch(apiEndpoint(this.config.apiBase), {
				method: 'POST',
				credentials: 'same-origin',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(this.document ? { id: this.document.id, version: this.document.version } : {}),
					name: this.document?.name || this.config.name,
					visibility: this.document?.visibility || this.config.visibility,
					value: this.value
				})
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body?.ok !== true || !body?.thing) {
				const conflict: any = new Error(body?.error || `Thingtime save failed (${response.status})`);
				conflict.status = response.status;
				conflict.thing = body?.thing;
				throw conflict;
			}
			this.applyDocument(body.thing, 'save');
			this.setStatus('success', `Saved “${this.document?.name}” to Thingtime.`);
			return this.document;
		} catch (error) {
			this.setStatus('error', errorMessage(error));
			throw error;
		}
	}

	private createBridgePayload() {
		return {
			value: cloneJson(this.value),
			thing: this.document
				? {
						id: this.document.id,
						name: this.document.name,
						visibility: this.document.visibility,
						version: this.document.version
				  }
				: {
						name: this.config.name,
						visibility: this.config.visibility
				  },
			parentOrigin: window.location.origin
		};
	}

	private postBridge(type: string, payload?: unknown, requestId?: string) {
		if (!this.bridgeWindow || this.bridgeWindow.closed || !this.bridgeReady) return;
		const message: BridgeMessage = {
			protocol: EMBED_PROTOCOL,
			channel: this.bridgeChannel,
			type,
			...(requestId ? { requestId } : {}),
			...(payload === undefined ? {} : { payload })
		};
		this.bridgeWindow.postMessage(message, this.config.apiBase);
	}

	private requestBridge(type: string, payload: unknown, requestId = randomChannel()) {
		return new Promise<any>((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				window.clearInterval(closePoll);
				this.pendingBridge.delete(requestId);
				reject(new Error('Thingtime save confirmation timed out'));
			}, 120_000);
			const closePoll = window.setInterval(() => {
				if (!this.bridgeWindow || this.bridgeWindow.closed) {
					window.clearTimeout(timeout);
					window.clearInterval(closePoll);
					this.pendingBridge.delete(requestId);
					reject(new Error('Thingtime popup was closed before the save was confirmed'));
				}
			}, 300);
			this.pendingBridge.set(requestId, { resolve, reject, timeout, closePoll });
			this.postBridge(type, payload, requestId);
		});
	}

	private onWindowMessage(event: MessageEvent) {
		if (!this.bridgeWindow || event.source !== this.bridgeWindow || event.origin !== this.config.apiBase) return;
		const message = event.data as BridgeMessage;
		if (!message || message.protocol !== EMBED_PROTOCOL || message.channel !== this.bridgeChannel) return;

		if (message.type === 'bridge-ready') {
			this.bridgeReady = true;
			this.resolveBridgeReady?.();
			this.resolveBridgeReady = null;
			this.postBridge('init', this.createBridgePayload());
			this.setStatus('success', 'Secure Thingtime editor connected.');
			return;
		}
		if (message.type === 'state') {
			try {
				this.commit(sanitizeJson(message.payload?.value), 'bridge');
			} catch {
				// Invalid bridge snapshots are ignored.
			}
			return;
		}
		if (message.type === 'saved' && message.payload?.thing) {
			try {
				this.applyDocument(message.payload.thing, 'save');
			} catch {
				// Invalid save projections are ignored.
			}
		}
		if ((message.type === 'response' || message.type === 'error') && message.requestId) {
			const pending = this.pendingBridge.get(message.requestId);
			if (!pending) return;
			window.clearTimeout(pending.timeout);
			window.clearInterval(pending.closePoll);
			this.pendingBridge.delete(message.requestId);
			if (message.type === 'error') pending.reject(new Error(message.payload?.error || 'Thingtime save failed'));
			else pending.resolve(message.payload);
		}
	}

	private installChrome() {
		if (this.chromeHost) return;
		const host = document.createElement('div');
		host.id = `thingtime-embed-${randomChannel()}`;
		host.setAttribute('data-thingtime-embed-chrome', '');
		document.body.appendChild(host);
		const shadow = host.attachShadow({ mode: 'open' });
		const style = document.createElement('style');
		if (this.nonce) style.nonce = this.nonce;
		style.textContent = CHROME_STYLES;
		shadow.appendChild(style);
		this.chromeHost = host;
		this.chromeShadow = shadow;
		this.renderChrome();
	}

	private renderChrome() {
		const shadow = this.chromeShadow;
		if (!shadow) return;
		shadow.querySelectorAll('.tt-launcher,.tt-window').forEach((node) => node.remove());
		this.chromeTreeDestroy?.();
		this.chromeTreeDestroy = null;

		const launcher = document.createElement('button');
		launcher.type = 'button';
		launcher.className = 'tt-launcher';
		launcher.setAttribute('aria-label', this.openState ? 'Close Thingtime' : 'Open Thingtime');
		launcher.textContent = this.openState ? '✕ Thingtime' : '🌈 Thingtime';
		launcher.addEventListener('click', () => this.toggle());
		if (!this.openState) shadow.appendChild(launcher);

		const panel = document.createElement('section');
		panel.className = 'tt-window';
		panel.hidden = !this.openState;
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-label', 'Thingtime popup');

		const header = document.createElement('div');
		header.className = 'tt-header';
		const titleWrap = document.createElement('div');
		const title = document.createElement('div');
		title.className = 'tt-brand';
		title.textContent = this.document?.name || this.config.name;
		const subtitle = document.createElement('div');
		subtitle.className = 'tt-subtitle';
		subtitle.textContent = 'One living thing · mounted anywhere';
		titleWrap.append(title, subtitle);
		const spacer = document.createElement('div');
		spacer.className = 'tt-spacer';
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'tt-close';
		close.setAttribute('aria-label', 'Close Thingtime');
		close.textContent = '×';
		close.addEventListener('click', () => this.close());
		header.append(titleWrap, spacer, close);

		const actions = document.createElement('div');
		actions.className = 'tt-actions';
		const save = document.createElement('button');
		save.type = 'button';
		save.className = 'tt-button tt-button-primary';
		save.textContent = 'Save';
		save.addEventListener('click', () => this.save().catch(() => {}));
		const secure = document.createElement('button');
		secure.type = 'button';
		secure.className = 'tt-button';
		secure.textContent = 'Full editor ↗';
		secure.addEventListener('click', () => this.openSecureWindow().catch((error) => this.setStatus('error', errorMessage(error))));
		const undo = document.createElement('button');
		undo.type = 'button';
		undo.className = 'tt-button';
		undo.textContent = 'Undo';
		undo.addEventListener('click', () => this.undo());
		actions.append(save, secure, undo);

		const status = document.createElement('div');
		status.className = 'tt-status';
		status.setAttribute('data-thingtime-status', '');
		const body = document.createElement('div');
		body.className = 'tt-body';
		panel.append(header, actions, status, body);
		shadow.appendChild(panel);

		if (this.openState) {
			const treeMount = createSafeThingMount(
				body,
				{
					get: (path) => this.get(path),
					set: (path, value) => this.set(path, value),
					subscribe: (listener) => {
						this.renderListeners.add(listener);
						return () => this.renderListeners.delete(listener);
					}
				},
				undefined,
				{ editable: this.config.editable, label: this.document?.name || this.config.name },
				this.nonce
			);
			this.chromeTreeDestroy = treeMount.destroy;
		}
		this.renderChromeStatus();
	}

	private renderChromeStatus() {
		const status = this.chromeShadow?.querySelector<HTMLElement>('[data-thingtime-status]');
		if (!status) return;
		status.dataset.tone = this.status.tone;
		status.textContent = this.status.message;
	}

	private mountDeclaredTargets() {
		document.querySelectorAll<HTMLElement>('[data-thingtime-mount]').forEach((target) => {
			const path = target.dataset.thingtimeMount || undefined;
			this.mount(target, path, {
				editable: booleanAttribute(target.dataset.thingtimeEditable, this.config.editable),
				label: target.dataset.thingtimeLabel
			});
		});
	}
}

export const configFromScript = (script: HTMLScriptElement | null): ThingtimeEmbedConfig => {
	const dataset = script?.dataset || {};
	let initialValue: unknown;
	if (dataset.thingtimeInitial) {
		try {
			initialValue = JSON.parse(dataset.thingtimeInitial);
		} catch {
			// Invalid declarative JSON is ignored; configure() can still set it.
		}
	}
	const scriptOrigin = script?.src ? new URL(script.src, window.location.href).origin : window.location.origin;
	return {
		apiBase: dataset.thingtimeApi || scriptOrigin,
		thingId: dataset.thingtimeId,
		name: dataset.thingtimeName,
		visibility: dataset.thingtimeVisibility === 'private' ? 'private' : 'public',
		editable: booleanAttribute(dataset.thingtimeEditable, true),
		autoLoad: booleanAttribute(dataset.thingtimeAutoLoad, true),
		autoOpen: booleanAttribute(dataset.thingtimeOpen, false),
		...(initialValue === undefined ? {} : { initialValue })
	};
};
