// Opt-in isolated acceptance only. The application's normal UI performs the
// shared copy; this separately bundled fixture reads its resulting device data
// and invokes the actual saved Action interpreter with synthetic local data.
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';
import { LocalActions } from './actions';
import { LocalThemes } from './themes';
import { LocalAlgorithms } from './algorithms';
import { LocalTimeline } from './timeline';
import { serializeTransfer } from '../utils/thingTransfer/format';
import { binaryBlob, blobChecksum } from '../utils/thingTransfer/binary';

const db = new WorkspaceDatabase(indexedDB), scope = { kind: 'anonymous' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, things = new LocalThings(db, scope, lease);
export async function proof(id: string) {
	const page = await things.get(id), bundle = await things.export([id]);
	const media = await Promise.all(bundle.manifest.files.map(async file => {
		// Export already reads and verifies the persisted attachment by its Thing
		// ID. Manifest file IDs identify portable bytes, not attachment Things.
		const retained = bundle.files.get(file.id);
		if (!retained) throw new Error('Export is missing the declared local file bytes');
		const blob = binaryBlob(retained);
		return { id: file.id, bytes: blob.size, sha256: await blobChecksum(blob) };
	}));
	return { page, roots: bundle.manifest.roots, things: bundle.manifest.things, files: bundle.manifest.files, media, json: serializeTransfer(bundle.manifest) };
}

export async function runProfileAction() {
	const endpoint = (route: string, minimumVersion: string, body: unknown) => ({ op: 'http.request', path: `/api/v1/${route}`, method: 'POST', feature: `api.${route.replace('/', '-')}`, minimumVersion, body });
	const steps = [
		endpoint('themes', '1.1.1', { name: 'Browser Action theme', theme: {} }),
		endpoint('themes', '1.1.1', { id: '$step.1.theme.id', name: 'Browser Action theme edited', theme: {} }),
		endpoint('themes/active', '1.0.0', { themeId: '$step.1.theme.id' }),
		endpoint('algorithms', '1.1.0', { name: 'Browser Action algorithm' }),
		endpoint('algorithms/update', '1.1.0', { id: '$step.4.algorithm.id', name: 'Browser Action algorithm edited' }),
		endpoint('algorithms/active', '1.1.0', { algorithmId: '$step.4.algorithm.id' }),
		{ op: 'return', value: { themeId: '$step.1.theme.id', algorithmId: '$step.4.algorithm.id' } }
	];
	const action = await things.create({ thingtime: ['action'], crystal: { name: 'Saved profile browser acceptance', runtime: 'browser', version: 1,
		capabilities: [{ capability: 'http.request', endpoints: [...new Set(steps.filter(step => 'path' in step).map(step => `POST ${step.path}`))] }], steps } });
	const actions = new LocalActions(db, scope, lease), supported = await actions.canRunLocally(action.id), outcome = await actions.run({ action: action.id });
	const profiles = await profileProof(action.id);
	return { actionId: action.id, supported, outcome, ...profiles };
}

export async function profileProof(actionId: string) {
	const themes = await new LocalThemes(db, lease).list(), algorithms = await new LocalAlgorithms(db, lease).list();
	const runs = await new LocalActions(db, scope, lease).runs({ action: actionId });
	const history = new LocalTimeline(db, lease, location.origin), ids = [themes.activeThemeId, algorithms.activeAlgorithmId].filter(Boolean) as string[];
	const historyCounts = await Promise.all(ids.map(async thingId => (await history.page({ thingId, before: null, after: null, limit: 40 })).entries.length));
	const bundle = await things.export([actionId, ...ids]);
	return { themes, algorithms, runs: runs.runs, historyCounts, json: serializeTransfer(bundle.manifest) };
}
