import { ChakraProvider } from '@chakra-ui/react';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { ThingtimeProvider } from '~/Providers/ThingtimeProvider';
import { theme } from '~/Providers/Chakra/theme';
import { Thingtime } from '~/components/Thingtime/Thingtime';
import { useThingtime } from '~/components/Thingtime/useThingtime';
import { useLopu } from '~/components/Lopu/useLopu';

import { readBridgeThingIdentity } from './bridgeIdentity';
import { errorMessage, sanitizeJson, type JsonValue } from './json';
import { EMBED_PROTOCOL, type ThingDocument, type ThingVisibility } from './runtime';

const BRIDGE_PATH = ['Embed', 'value'];
const BRIDGE_CSS = `
:root { color-scheme: light; --tt-card:#fff; --tt-ink:#18181b; --tt-muted:#71717a; --tt-faint:#a1a1aa; --tt-border:#e4e4e7; --tt-surface-alt:#f4f4f5; --tt-surface-hover:#ededf0; --tt-radius-xs:7px; --tt-radius-sm:9px; --tt-radius-xl:20px; }
html,body,#thingtime-bridge-root { margin:0; min-height:100%; }
body { background:#f7f7f8; color:#18181b; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
* { box-sizing:border-box; }
.ttb-shell { margin:0 auto; max-width:860px; padding:18px; }
.ttb-card { background:#fff; border:1px solid #e4e4e7; border-radius:20px; box-shadow:0 18px 70px rgba(0,0,0,.10); overflow:hidden; }
.ttb-header { align-items:flex-start; border-bottom:1px solid #ededf0; display:flex; gap:14px; padding:18px 20px; }
.ttb-logo { font-size:25px; line-height:1; }
.ttb-title { font-size:19px; font-weight:850; letter-spacing:-.025em; }
.ttb-origin { color:#71717a; font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; margin-top:4px; overflow-wrap:anywhere; }
.ttb-grid { display:grid; gap:12px; grid-template-columns:1fr 160px; padding:16px 20px 0; }
.ttb-label { color:#71717a; display:block; font-size:11px; font-weight:750; margin-bottom:5px; text-transform:uppercase; letter-spacing:.06em; }
.ttb-input { background:#fff; border:1px solid #d4d4d8; border-radius:9px; color:#18181b; font:inherit; outline:none; padding:9px 10px; width:100%; }
.ttb-input:focus { border-color:#a1a1aa; box-shadow:0 0 0 3px rgba(24,24,27,.08); }
.ttb-status { color:#52525b; font-size:12px; min-height:24px; padding:12px 20px 0; }
.ttb-status[data-error="true"] { color:#b42318; }
.ttb-target { color:#52525b; font-size:12px; line-height:1.5; padding:10px 20px 0; }
.ttb-target[data-update="true"] { color:#92400e; }
.ttb-target code { font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
.ttb-editor { min-height:280px; overflow:auto; padding:14px 12px 22px; }
.ttb-actions { align-items:center; border-top:1px solid #ededf0; display:flex; flex-wrap:wrap; gap:9px; padding:14px 20px; }
.ttb-button { background:#f4f4f5; border:1px solid #e4e4e7; border-radius:10px; color:#27272a; cursor:pointer; font:750 13px/1 ui-sans-serif,system-ui; padding:10px 13px; }
.ttb-primary { background:#18181b; border-color:#18181b; color:#fff; }
.ttb-spacer { flex:1; }
.ttb-link { color:#52525b; font-size:12px; font-weight:700; }
@media(max-width:600px){.ttb-shell{padding:0}.ttb-card{border:0;border-radius:0;min-height:100vh}.ttb-grid{grid-template-columns:1fr}.ttb-header,.ttb-grid,.ttb-actions{padding-left:14px;padding-right:14px}}
`;

type BridgeParams = { channel: string; parentOrigin: string };
type Incoming = {
	protocol?: string;
	channel?: string;
	type?: string;
	requestId?: string;
	payload?: any;
};

const getBridgeParams = (): BridgeParams => {
	const params = new URLSearchParams(window.location.hash.slice(1));
	const channel = params.get('channel') || '';
	const parentOrigin = params.get('parentOrigin') || '';
	let normalizedOrigin = '';
	try {
		normalizedOrigin = new URL(parentOrigin).origin;
	} catch {
		// handled below
	}
	if (!channel || !normalizedOrigin || normalizedOrigin !== parentOrigin || normalizedOrigin === 'null') {
		throw new Error('This Thingtime bridge link is invalid');
	}
	return { channel, parentOrigin: normalizedOrigin };
};

const initializeBridgeGlobals = () => {
	const root = globalThis as any;
	root.meta = root.meta || {
		tmp: {},
		subscribers: {},
		state: {},
		db: {},
		stats: { db: {}, limit: 20_000, maxDepth: 40, count: 0 },
		things: {}
	};
};

const BridgeApp = ({ channel, parentOrigin }: BridgeParams) => {
	const { thingtime, setThingtime, getThingtime, loading } = useThingtime();
	const lopu = useLopu();
	const [initialized, setInitialized] = React.useState(false);
	const [name, setName] = React.useState('Embedded thing');
	const [visibility, setVisibility] = React.useState<ThingVisibility>('public');
	const [documentMeta, setDocumentMeta] = React.useState<Pick<ThingDocument, 'id' | 'version'> | null>(null);
	const [status, setStatus] = React.useState(`Waiting for ${parentOrigin}…`);
	const [statusError, setStatusError] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	const [pendingRequestId, setPendingRequestId] = React.useState<string | null>(null);
	const applyingRemote = React.useRef(false);

	const post = React.useCallback(
		(type: string, payload?: unknown, requestId?: string) => {
			if (!window.opener) return;
			window.opener.postMessage(
				{
					protocol: EMBED_PROTOCOL,
					channel,
					type,
					...(requestId ? { requestId } : {}),
					...(payload === undefined ? {} : { payload })
				},
				parentOrigin
			);
		},
		[channel, parentOrigin]
	);

	React.useEffect(() => {
		post('bridge-ready');
	}, [post]);

	React.useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			if (event.source !== window.opener || event.origin !== parentOrigin) return;
			const message = event.data as Incoming;
			if (message?.protocol !== EMBED_PROTOCOL || message.channel !== channel) return;
			if (message.type !== 'init' && message.type !== 'state' && message.type !== 'request-save') return;

			try {
				const value = sanitizeJson(message.payload?.value);
				applyingRemote.current = true;
				setThingtime(BRIDGE_PATH, value, { ignoreUndoRedo: true, namespace: 'embed-bridge' });
				// `state` syncs the value only and names no thing — keep the identity
				// established by init/request-save/the last save (see bridgeIdentity.ts).
				const identity = readBridgeThingIdentity(message.payload);
				if (identity) {
					setName(identity.name);
					setVisibility(identity.visibility);
					setDocumentMeta(identity.documentMeta);
				}
				setInitialized(true);
				setStatusError(false);
				if (message.type === 'request-save') {
					setPendingRequestId(message.requestId || null);
					setStatus(`Review the edits, then confirm the save for ${parentOrigin}.`);
					window.focus();
				} else {
					setStatus(`Securely connected to ${parentOrigin}.`);
				}
			} catch (error) {
				setStatusError(true);
				setStatus(errorMessage(error));
			}
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [channel, parentOrigin, setThingtime]);

	const value = initialized && !loading ? getThingtime(BRIDGE_PATH) : undefined;
	React.useEffect(() => {
		if (!initialized || loading || value === undefined) return;
		// Clear the echo guard before anything that can throw. Sanitizing first left
		// the flag set whenever the editor round-tripped a value sanitizeJson
		// rejects (a dotted or `$`-prefixed key is the easy one to type), and the
		// next *genuine* local edit then consumed the stale flag and was dropped
		// instead of posted — one silent divergence from the host page per failure.
		if (applyingRemote.current) {
			applyingRemote.current = false;
			return;
		}
		try {
			post('state', { value: sanitizeJson(value) });
		} catch {
			// The safe bridge never sends non-JSON Thingtime state to its opener.
		}
	}, [initialized, loading, post, thingtime, value]);

	const save = async () => {
		if (!initialized || value === undefined) return;
		setSaving(true);
		setStatusError(false);
		setStatus('Saving through your first-party Thingtime session…');
		try {
			const safeValue = sanitizeJson(value);
			const response = await fetch('/api/v1/embed/things', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...(documentMeta ? { id: documentMeta.id, version: documentMeta.version } : {}),
					name,
					visibility,
					value: safeValue
				})
			});
			const body = await response.json().catch(() => ({}));
			if (!response.ok || body?.ok !== true || !body?.thing) {
				throw new Error(
					response.status === 401
						? 'Sign in to Thingtime in this browser, then return here and save again.'
						: body?.error || `Thingtime save failed (${response.status})`
				);
			}
			const thing = body.thing as ThingDocument;
			setDocumentMeta({ id: thing.id, version: thing.version });
			setName(thing.name);
			setVisibility(thing.visibility);
			setStatus(`Saved “${thing.name}” to Thingtime.`);
			lopu({ title: `Saved “${thing.name}”`, description: 'Your embedded thing is connected ✨', status: 'success' });
			post('saved', { thing });
			if (pendingRequestId) post('response', { thing }, pendingRequestId);
			setPendingRequestId(null);
		} catch (error) {
			const message = errorMessage(error);
			setStatusError(true);
			setStatus(message);
			lopu({ title: 'Thingtime could not save yet', description: message, status: 'error' });
			if (pendingRequestId) post('error', { error: message }, pendingRequestId);
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="ttb-shell">
			<style>{BRIDGE_CSS}</style>
			<main className="ttb-card">
				<header className="ttb-header">
					<div className="ttb-logo">🌈</div>
					<div>
						<div className="ttb-title">Thingtime secure editor</div>
						<div className="ttb-origin">Connected website: {parentOrigin}</div>
					</div>
				</header>

				<div className="ttb-grid">
					<label>
						<span className="ttb-label">Thing name</span>
						<input className="ttb-input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
					</label>
					<label>
						<span className="ttb-label">Visibility</span>
						<select className="ttb-input" value={visibility} onChange={(event) => setVisibility(event.target.value as ThingVisibility)}>
							<option value="public">Public embed</option>
							<option value="private">Private</option>
						</select>
					</label>
				</div>

				<div className="ttb-status" data-error={statusError ? 'true' : 'false'} role="status">
					{status}
				</div>

				{/*
				 * The opener names the save target: `documentMeta` is whatever id and
				 * version the host page put in its init/request-save payload, and the
				 * server authorizes that write by ownerId alone. So a page that knows a
				 * *public* embed's id — which is exactly the id it was shared under —
				 * can aim this confirmation at an existing thing on the signed-in
				 * owner's account, under that thing's real name. Confirming is still the
				 * user's call, but they can only make it if the window says which call
				 * it is: replacing something they already have, or making something new.
				 */}
				<div className="ttb-target" data-update={documentMeta ? 'true' : 'false'} role="note">
					{documentMeta ? (
						<>
							⚠︎ Saving <strong>replaces</strong> a thing already on your account — “{name}”, version {documentMeta.version},{' '}
							<code>{documentMeta.id}</code>. {parentOrigin} chose it. Its current contents are overwritten.
						</>
					) : (
						<>Saving creates a new thing on your Thingtime account.</>
					)}
				</div>
				<section className="ttb-editor" aria-label="Thing editor">
					{initialized && !loading ? <Thingtime path={BRIDGE_PATH} edit codeView safeEmbed pathPl={0} /> : <div>Connecting to the website…</div>}
				</section>

				<footer className="ttb-actions">
					<button className="ttb-button ttb-primary" type="button" disabled={!initialized || saving} onClick={save}>
						{saving ? 'Saving…' : pendingRequestId ? 'Confirm save' : 'Save to Thingtime'}
					</button>
					<a className="ttb-link" href="/login" target="_blank" rel="noreferrer">
						Sign in
					</a>
					<div className="ttb-spacer" />
					<button className="ttb-button" type="button" onClick={() => window.close()}>
						Close
					</button>
				</footer>
			</main>
		</div>
	);
};

export const bootstrapBridge = () => {
	initializeBridgeGlobals();
	const params = getBridgeParams();
	document.title = '[TT] Secure Thingtime editor';
	const rootElement = document.createElement('div');
	rootElement.id = 'thingtime-bridge-root';
	document.body.replaceChildren(rootElement);
	createRoot(rootElement).render(
		<React.StrictMode>
			<ChakraProvider theme={theme}>
				{/*
				 * The popup holds a first-party session, so it keeps nothing locally and
				 * publishes no window globals. Persisted functions need no switch here:
				 * thingtimeSerialization always omits them on write and removes them on
				 * read, for every provider.
				 */}
				<ThingtimeProvider persistLocal={false} exposeGlobals={false}>
					<BridgeApp {...params} />
				</ThingtimeProvider>
			</ChakraProvider>
		</React.StrictMode>
	);
};
