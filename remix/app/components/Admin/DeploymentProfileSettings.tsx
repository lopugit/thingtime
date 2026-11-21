import React from 'react';
import { SettingsDocumentHost } from '~/components/Settings/SettingsDocumentHost';
import { WebpageBlocksRenderer } from '~/components/Builder/WebpageBlocksRenderer';
import { TransientBlockHost, type TransientBlockActions } from '~/components/Builder/TransientBlockHost';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { parseDeploymentProfile, type DeploymentProfile, type SavedDeploymentProfile } from '~/api/utils/ciControl/deploymentProfilesCore';
import { AdminSettingsScope, type AdminSettingsEditorProps } from './AdminSettingsScope';
import { DEPLOYMENT_PROFILE_BLOCKS, PROFILE_FIELDS } from './deploymentProfileBlocks';

function emptyProfile(primary: boolean): DeploymentProfile {
	return {
		id: primary ? 'legacy' : '',
		mode: primary ? 'primary' : 'parallel',
		enabled: primary,
		label: '',
		teamId: '',
		teamSlug: '',
		projectId: '',
		projectName: '',
		testOrigin: ''
	};
}
function readSaved(row: SavedDeploymentProfile): SavedDeploymentProfile {
	if (typeof row.revision !== 'string') throw new Error('The deployment profile has no saved revision.');
	return { ...parseDeploymentProfile(row), revision: row.revision };
}
export function DeploymentProfileSettings() {
	return <AdminSettingsScope editor={DeploymentProfileEditor} />;
}
export function DeploymentProfileEditor({ scope, transport, dataPlane }: AdminSettingsEditorProps) {
	const { expectedActor, expectedApiOrigin } = scope;
	const [profiles, setProfiles] = React.useState<SavedDeploymentProfile[] | null>(null);
	const [draft, setDraft] = React.useState<DeploymentProfile | null>(null);
	const [original, setOriginal] = React.useState<SavedDeploymentProfile | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState('');
	const operation = React.useRef<AbortController | null>(null);
	const request = React.useCallback(
		async (signal: AbortSignal, body?: object) => {
			if (dataPlane !== 'home') throw new Error('Select the Home data plane to manage deployment profiles.');
			await requireThingtimeCapability('api.admin-ci-deployment-profiles', '1.0.0', expectedApiOrigin, { ...transport, signal });
			const response = await transport.fetch(new URL('/api/v1/admin/ci/deployment-profiles', expectedApiOrigin).href, {
				method: body ? 'POST' : 'GET',
				credentials: 'same-origin',
				redirect: 'error',
				cache: 'no-store',
				signal,
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-Thingtime-Expected-Actor': expectedActor,
					'X-Thingtime-Expected-Data-Plane': dataPlane
				},
				...(body ? { body: JSON.stringify(body) } : {})
			});
			const result = await response.json();
			signal.throwIfAborted();
			transport.currentOrigin?.();
			if (!response.ok || result.ok !== true) throw new Error(result.error || 'Could not access deployment profiles.');
			return result;
		},
		[expectedActor, expectedApiOrigin, transport, dataPlane]
	);
	const run = React.useCallback(async (work: (signal: AbortSignal) => Promise<void>) => {
		if (operation.current) return;
		const pending = new AbortController();
		operation.current = pending;
		setBusy(true);
		setError('');
		try {
			await work(pending.signal);
		} catch (reason) {
			if (!pending.signal.aborted) setError((reason as Error).message);
		} finally {
			if (operation.current === pending) {
				operation.current = null;
				setBusy(false);
			}
		}
	}, []);
	const load = React.useCallback(
		() =>
			run(async (signal) => {
				const result = await request(signal);
				setProfiles(result.profiles.map(readSaved));
			}),
		[request, run]
	);
	React.useEffect(() => {
		void load();
		return () => {
			operation.current?.abort();
			operation.current = null;
		};
	}, [load]);
	function edit(row: SavedDeploymentProfile | null, primary = false) {
		setOriginal(row);
		setDraft(row ? parseDeploymentProfile(row) : emptyProfile(primary));
		setError('');
	}
	const save = () =>
		run(async (signal) => {
			if (!draft) return;
			const profile = parseDeploymentProfile(draft);
			const { profile: result } = await request(signal, { profile, expectedRevision: original?.revision ?? null });
			const saved = readSaved(result);
			setProfiles((rows) => [...(rows ?? []).filter((row) => row.id !== saved.id), saved].sort((a, b) => a.id.localeCompare(b.id)));
			setDraft(null);
			setOriginal(null);
		});
	const actions: TransientBlockActions = {
		'profile.refresh': load,
		'profile.new': () => edit(null),
		'profile.legacy': () => edit(null, true),
		'profile.edit': ({ inputs }) => {
			if (!draft) {
				const row = profiles?.find((p) => p.id === inputs.id);
				if (row) edit(row);
			}
		},
		'profile.field': ({ inputs, value }) => {
			const name = String(inputs.name);
			if (!Object.prototype.hasOwnProperty.call(PROFILE_FIELDS, name) || typeof value !== 'string') return;
			setDraft((d) => d && { ...d, [name]: value });
		},
		'profile.enable': ({ value }) => setDraft((d) => d && { ...d, enabled: value === true }),
		'profile.cancel': () => {
			setDraft(null);
			setOriginal(null);
			setError('');
		},
		'profile.save': save
	};
	const display = {
		rows: (profiles ?? []).map((p) => ({
			...p,
			destination: p.teamSlug + '/' + p.projectName,
			status: [p.mode, p.enabled ? 'Enabled' : 'Disabled', p.testOrigin].filter(Boolean).join(' · ')
		})),
		draft,
		busy,
		status: draft ? 'Saving deployment profile…' : 'Loading deployment profiles…',
		error,
		hasError: !!error,
		editing: !!draft,
		parallel: draft?.mode === 'parallel',
		idLocked: busy || !!original || draft?.mode === 'primary',
		identityLocked: busy || !!original,
		formTitle: original ? 'Edit deployment profile' : 'Add deployment profile',
		refreshDisabled: busy || !!draft,
		empty: profiles?.length === 0,
		showActions: !!profiles && !draft,
		needsLegacy: !profiles?.some((p) => p.id === 'legacy'),
		saveDisabled: busy || !draft || (!!original && JSON.stringify(parseDeploymentProfile(original)) === JSON.stringify(draft))
	};
	const scopeKey = JSON.stringify([expectedActor, expectedApiOrigin, dataPlane]);
	return (
		<SettingsDocumentHost
			documentKey="ci-deployment-profiles"
			title="Deployment profile layout"
			defaultDocument={DEPLOYMENT_PROFILE_BLOCKS}
			scopeKey={scopeKey}
			accountTransport={transport}
			layoutEditingDisabled={busy}
		>
			{({ blocks, chrome, editing }) => (
				<TransientBlockHost
					scopeKey={scopeKey}
					scope={{ profiles: display }}
					actions={actions}
					enabled={!editing}
					onError={() => setError('The profile control could not complete.')}
				>
					<WebpageBlocksRenderer blocks={blocks} componentsByRef={{}} chrome={chrome} interactive={!editing} bare />
				</TransientBlockHost>
			)}
		</SettingsDocumentHost>
	);
}
