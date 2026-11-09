import React from 'react';
import { Link, useLocation, useRouteLoaderData } from 'react-router';
import type { RootLoaderData } from '~/root-data.server';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { rootIdentity } from '~/utils/rootIdentity';
import { rememberAuthReturnTo } from '~/utils/authReturn';
import { SettingsDocumentHost } from '../Settings/SettingsDocumentHost';
import { TransientBlockHost, type TransientBlockActions } from '../Builder/TransientBlockHost';
import { WebpageBlocksRenderer } from '../Builder/WebpageBlocksRenderer';
import { credentialImportBlocks, credentialHandoffBlocks } from './credentialImportBlocks';
import { CredentialImportError, credentialImportRequest, encodeImportTarget, importFormatLabel, inCredentialFrame, validateCredential } from './credentialImport.client';
import {
	CREDENTIAL_IMPORT_HEADERS, CREDENTIAL_IMPORT_PAGE_PATH, GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH, GOOGLE_OAUTH_CREDENTIAL_LABEL,
	type CredentialImportFormat, type CredentialImportIntent, type CredentialImportReceipt, type CredentialImportTarget
} from '~/credentials/importContract';

export type CredentialImportSecret = { id: string; label: string; updatedAt: string };

export function useCredentialAuthority() {
	const currentUser = useCurrentUser();
	const data = useRouteLoaderData('root') as RootLoaderData | undefined;
	const identity = React.useSyncExternalStore(rootIdentity.subscribe, rootIdentity.read, rootIdentity.read);
	const location = useLocation();
	const origin = typeof window === 'undefined' ? '' : window.location.origin;
	const actor = data?.user?.id || '';
	const environment = data?.dataEnvironment?.id || '';
	const authorized = !!actor && !!currentUser?.isAdmin && currentUser.id === actor && !currentUser.isCharacter && !identity.pending;
	const dataPlane = data?.dataPlane;
	const signedIn = !!currentUser && !currentUser.temporary;
	return React.useMemo(() => ({
		actor, origin, environment, generation: identity.generation, authorized, signedIn, pending: identity.pending,
		key: JSON.stringify([actor, origin, environment, dataPlane, identity.generation, location.key])
	}), [actor, origin, environment, dataPlane, identity.generation, identity.pending, location.key, authorized, signedIn]);
}
type Authority = ReturnType<typeof useCredentialAuthority>;

function focusControl(root: HTMLElement | null, blockId: string) {
	const selector = `[data-block-id="${blockId}"]`;
	const element = root?.querySelector<HTMLElement>(selector);
	(element?.matches('button, input, select') ? element : element?.querySelector<HTMLElement>('button, input, select'))?.focus();
}

type Props = { vaultConfigured: boolean | null; onImported: () => void };

export function CredentialImport(props: Props) {
	const authority = useCredentialAuthority();
	return authority.authorized && !inCredentialFrame() ? <DirectImport key={authority.key} authority={authority} {...props} /> : null;
}

function DirectImport({ authority, vaultConfigured, onImported }: Props & { authority: Authority }) {
	const [format, setFormat] = React.useState<CredentialImportFormat>('google-oauth');
	const [label, setLabel] = React.useState('');
	const [paste, setPaste] = React.useState(false);
	const [replaceRevision, setReplaceRevision] = React.useState('');
	const [inspected, setInspected] = React.useState<CredentialImportSecret | null>(null);
	const [fileSize, setFileSize] = React.useState<number | null>(null);
	const [review, setReview] = React.useState<{ target: CredentialImportTarget; size: number } | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const [notice, setNotice] = React.useState('');
	const [epoch, resetFields] = React.useReducer((previous: number) => previous + 1, 0);
	const fileRef = React.useRef<File | undefined>(undefined);
	const payloadRef = React.useRef<Blob | undefined>(undefined);
	const running = React.useRef(false);
	const frame = React.useRef<HTMLDivElement>(null);
	const focusNext = React.useRef('');
	React.useLayoutEffect(() => {
		if (focusNext.current) focusControl(frame.current, focusNext.current);
		focusNext.current = '';
	}, [review, paste, epoch]);
	const available = vaultConfigured === true && !!authority.environment && !!authority.origin;
	const google = format === 'google-oauth';
	const targetLabel = google ? GOOGLE_OAUTH_CREDENTIAL_LABEL : label.trim();
	const callbackUrl = authority.origin + GOOGLE_OAUTH_CREDENTIAL_CALLBACK_PATH;
	const existing = inspected?.label === targetLabel ? inspected : null;
	const revision = existing ? `${existing.id}:${existing.updatedAt}` : '';
	const replace = !!revision && replaceRevision === revision;
	const clear = () => {
		fileRef.current = undefined;
		payloadRef.current = undefined;
		setFileSize(null);
		setReview(null);
		setReplaceRevision('');
		setInspected(null);
		resetFields();
	};
	React.useEffect(() => {
		const hide = () => { clear(); setBusy(false); setError(''); setNotice(''); };
		window.addEventListener('pagehide', hide);
		window.addEventListener('thingtime:hide-vault-values', hide);
		return () => {
			window.removeEventListener('pagehide', hide);
			window.removeEventListener('thingtime:hide-vault-values', hide);
			fileRef.current = undefined;
			payloadRef.current = undefined;
		};
	}, []);
	const run = async (signal: AbortSignal, operation: () => Promise<void>) => {
		if (!available || running.current || signal.aborted) return;
		running.current = true;
		setBusy(true);
		setError('');
		setNotice('');
		try {
			await operation();
		} catch (failure) {
			if (!signal.aborted) setError(failure instanceof Error ? failure.message : 'Credential import failed. Please retry.');
		} finally {
			running.current = false;
			if (!signal.aborted) setBusy(false);
		}
	};
	const changeSource = (nextPaste: boolean) => {
		fileRef.current = undefined;
		setFileSize(null);
		setPaste(nextPaste);
		setError('');
		setNotice('');
	};
	const actions: TransientBlockActions = {
		'import.format': ({ value }) => {
			if (value !== 'text' && value !== 'json' && value !== 'google-oauth') return;
			setFormat(value);
			setInspected(null);
			changeSource(false);
			setReplaceRevision('');
		},
		'import.label': ({ value }) => {
			if (typeof value !== 'string') return;
			setLabel(value);
			setInspected(null);
			setReplaceRevision('');
			setError('');
		},
		'import.replace': ({ value }) => setReplaceRevision(value === true ? revision : ''),
		'import.file': invocation => {
			const file = invocation.readFile('credential-file');
			fileRef.current = file;
			setFileSize(file?.size ?? null);
			setError('');
			setNotice('');
		},
		'import.file-mode': () => { focusNext.current = 'credential-file'; changeSource(false); },
		'import.paste-mode': () => { focusNext.current = 'credential-paste'; changeSource(true); },
		'import.review': invocation => {
			const pasted = paste ? invocation.readField('credential-paste') : undefined;
			const file = fileRef.current;
			return run(invocation.signal, async () => {
				if (!targetLabel || /[\p{Cc}\p{Cf}]/u.test(targetLabel) || (!google && targetLabel === GOOGLE_OAUTH_CREDENTIAL_LABEL)) {
					setError('Enter a unique vault label. The Google OAuth label is reserved for Google imports.');
					return;
				}
				let raw: string;
				try {
					raw = file ? new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) : typeof pasted === 'string' ? pasted : '';
				} catch {
					setError('Choose a readable UTF-8 credential file.');
					return;
				}
				invocation.signal.throwIfAborted();
				const problem = validateCredential(raw, format, google ? callbackUrl : undefined);
				if (problem) { setError(problem); return; }
				const { secret } = await credentialImportRequest<{ secret: CredentialImportSecret | null }>(
					authority, 'inspect', JSON.stringify({ label: targetLabel }), { 'Content-Type': 'application/json' }, invocation.signal
				);
				if (secret !== null && (!secret?.id || secret.label !== targetLabel || !secret.updatedAt)) {
					throw new Error('The vault destination metadata could not be verified.');
				}
				setInspected(secret);
				const currentRevision = secret ? `${secret.id}:${secret.updatedAt}` : '';
				if (currentRevision !== replaceRevision) {
					setReplaceRevision('');
					setError(secret ? 'Confirm the exact existing credential before replacing it.' : 'The vault destination changed. Review the import again.');
					return;
				}
				const payload = file ?? new Blob([raw]);
				payloadRef.current = payload;
				fileRef.current = undefined;
				setFileSize(null);
				focusNext.current = 'import-submit';
				setReview({ size: payload.size, target: {
					destination: 'admin-provider-vault', format, label: targetLabel, environment: authority.environment,
					...(google ? { callbackUrl } : {}),
					overwrite: secret ? { mode: 'replace', expectedId: secret.id, expectedUpdatedAt: secret.updatedAt } : { mode: 'create' }
				} });
			});
		},
		'import.save': ({ signal }) => run(signal, async () => {
			const payload = payloadRef.current;
			if (!review || !payload) return;
			try {
				const { receipt } = await credentialImportRequest<{ receipt: CredentialImportReceipt }>(authority, 'direct', payload, {
					'Content-Type': 'application/octet-stream',
					[CREDENTIAL_IMPORT_HEADERS.target]: encodeImportTarget(review.target)
				}, signal);
				const target = review.target;
				if (!receipt?.credentialId || receipt.format !== target.format || receipt.label !== target.label ||
					receipt.environment !== target.environment || (target.overwrite.mode === 'replace' && receipt.credentialId !== target.overwrite.expectedId)) {
					throw new Error('The saved credential receipt could not be verified. Check the vault before retrying.');
				}
				setNotice('Credential saved in the encrypted integration vault.');
				setLabel('');
			} catch (failure) {
				if (!signal.aborted) {
					setError(failure instanceof Error ? failure.message : 'The response could not be verified. Check the vault before importing again.');
				}
			} finally {
				if (!signal.aborted) {
					focusNext.current = 'import-format';
					clear();
					onImported();
					// Resetting transient fields retires the invocation's signal.
					setBusy(false);
				}
			}
		}),
		'import.discard': () => { focusNext.current = paste ? 'credential-paste' : 'credential-file'; clear(); setError(''); setNotice('Import discarded.'); }
	};
	const scope = { result: {
		origin: authority.origin, environment: authority.environment || 'Environment unavailable', format, label, google, generic: !google,
		callbackUrl, hasExisting: !!existing, existingRevision: existing?.updatedAt, replace, replaceDisabled: busy || !revision, busy,
		unavailable: !available, unavailableMessage: !authority.environment ? 'The active data environment is unavailable.' :
			vaultConfigured === false ? 'Configure the integration vault before importing.' : 'Vault metadata is not available yet.',
		editingEntry: available && !review, fileMode: !paste, pasteMode: paste, hasFile: fileSize !== null,
		fileSize, accept: format === 'text' ? undefined : '.json,application/json',
		reviewing: !!review, reviewReplacing: review?.target.overwrite.mode === 'replace',
		reviewCredentialId: review?.target.overwrite.mode === 'replace' ? review.target.overwrite.expectedId : '', reviewFormat: importFormatLabel(format), reviewLabel: review?.target.label, reviewSize: review?.size,
		reviewOperation: review?.target.overwrite.mode === 'replace' ? `Replace revision ${review.target.overwrite.expectedUpdatedAt}` : 'Create a credential',
		hasError: !!error, error, hasNotice: !!notice, notice
	} };
	return <div ref={frame}><SettingsDocumentHost documentKey="provider-credential-import" title="Provider credential import layout" editLayoutLabel="Edit import layout"
		defaultDocument={credentialImportBlocks} scopeKey={authority.key} layoutEditingDisabled={busy || !!review || fileSize !== null}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={`${authority.key}:${epoch}`} scope={scope} actions={actions}
			enabled={!editing} onError={() => setError('Restore the default layout if this control is unavailable.')}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare />
		</TransientBlockHost>}
	</SettingsDocumentHost></div>;
}

const handoffStatus: Record<CredentialImportIntent['status'], string> = {
	pending: 'Awaiting approval.',
	approved: 'Approved. The sender can now deliver the credential.',
	revoked: 'Handoff cancelled.',
	expired: 'This handoff expired.',
	completed: 'Credential saved in the encrypted integration vault.'
};

export function CredentialHandoff({ requestId }: { requestId: string }) {
	const authority = useCredentialAuthority();
	if (inCredentialFrame()) return <p>Open credential handoff in its own tab to continue.</p>;
	if (authority.pending) return null;
	if (!authority.authorized) return <div>
		<p>Sign in as the intended Thingtime administrator to review this request.</p>
		{!authority.signedIn && <Link to="/login" onClick={() => rememberAuthReturnTo(
			`${CREDENTIAL_IMPORT_PAGE_PATH}?requestId=${encodeURIComponent(requestId)}`
		)}>Sign in</Link>}
	</div>;
	return <HandoffReview key={`${authority.key}:${requestId}`} authority={authority} requestId={requestId} />;
}

function HandoffReview({ authority, requestId }: { authority: Authority; requestId: string }) {
	const [intent, setIntent] = React.useState<CredentialImportIntent | null>(null);
	const [busy, setBusy] = React.useState(!!requestId);
	const [error, setError] = React.useState(requestId ? '' : 'Open the complete request URL from the sender.');
	const running = React.useRef(false);
	const run = React.useCallback(async (action: 'inspect' | 'approve' | 'revoke', signal: AbortSignal) => {
		if (!requestId || signal.aborted || running.current) return;
		running.current = true;
		setBusy(true);
		setError('');
		try {
			const { intent: next } = await credentialImportRequest<{ intent: CredentialImportIntent }>(authority, action, JSON.stringify({ requestId }), {
				'Content-Type': 'application/json'
			}, signal);
			if (next.requestId !== requestId || next.expectedAccountId !== authority.actor || next.target.destination !== 'admin-provider-vault' ||
				next.target.environment !== authority.environment) {
				setIntent(null);
				setError('This request does not match the active account or vault.');
				return;
			}
			setIntent(next);
		} catch (failure) {
			if (!signal.aborted) {
				if (failure instanceof CredentialImportError && [401, 403, 404].includes(failure.status)) setIntent(null);
				setError(failure instanceof Error ? failure.message : 'Handoff status could not be verified.');
			}
		} finally {
			running.current = false;
			if (!signal.aborted) setBusy(false);
		}
	}, [authority, requestId]);
	React.useEffect(() => {
		const controller = new AbortController();
		// Defer one microtask so Strict Mode can retire its probe first.
		void Promise.resolve().then(() => run('inspect', controller.signal));
		return () => controller.abort();
	}, [run]);
	const actionable = intent?.status === 'pending' || intent?.status === 'approved';
	const actions: TransientBlockActions = {
		'handoff.approve': ({ signal }) => { if (intent?.status === 'pending' && !error) return run('approve', signal); },
		'handoff.revoke': ({ signal }) => { if (actionable && !error) return run('revoke', signal); },
		'handoff.inspect': ({ signal }) => run('inspect', signal)
	};
	const target = intent?.target;
	const scope = { result: {
		origin: authority.origin, hasIntent: !!intent, requestId: intent?.requestId, account: intent?.expectedAccountId, environment: target?.environment,
		format: target ? importFormatLabel(target.format) : '', label: target?.label, callbackUrl: target?.callbackUrl,
		// The saved handoff layout's existing callback block binds to this flag.
		google: !!target?.callbackUrl,
		operation: target?.overwrite.mode === 'replace' ? `Replace ${target.overwrite.expectedId} at revision ${target.overwrite.expectedUpdatedAt}` : 'Create a credential',
		expiresAt: intent ? new Date(intent.expiresAt).toLocaleString() : '',
		status: intent ? handoffStatus[intent.status] : '', hasReceipt: intent?.status === 'completed' && !!intent.receipt,
		credentialId: intent?.receipt?.credentialId, credentialUpdatedAt: intent?.receipt?.updatedAt, busy, canRefresh: !!requestId, refreshDisabled: busy,
		canApprove: intent?.status === 'pending' && !error, canRevoke: actionable && !error, hasError: !!error, error
	} };
	return <SettingsDocumentHost documentKey="provider-credential-handoff" title="Credential handoff layout" editLayoutLabel="Edit handoff layout"
		defaultDocument={credentialHandoffBlocks} scopeKey={authority.key} layoutEditingDisabled={busy}>
		{({ blocks, chrome, editing }) => <TransientBlockHost scopeKey={authority.key} scope={scope} actions={actions} enabled={!editing}>
			<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} bare />
		</TransientBlockHost>}
	</SettingsDocumentHost>;
}
