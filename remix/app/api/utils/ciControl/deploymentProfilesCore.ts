export type DeploymentProfile = {
	id: string;
	label: string;
	mode: 'parallel' | 'primary';
	teamId: string;
	teamSlug: string;
	projectId: string;
	projectName: string;
	testOrigin: string;
	enabled: boolean;
	/** Per-authority enrollment. Missing means the legacy preview-only pilot. */
	pilotLanes?: ('production' | 'development' | 'preview')[];
};
export type SavedDeploymentProfile = DeploymentProfile & { revision: string };
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const origin = /^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vercel\.app$/;
export const isDeploymentProfileId = (value: unknown): value is string => typeof value === 'string' && slug.test(value) && ('vercel-deployment-' + value).length <= 255;

export function parseDeploymentProfile(value: unknown): DeploymentProfile {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Provide a deployment profile.');
	const p = value as Record<string, unknown>;
	if (!isDeploymentProfileId(p.id)) throw new TypeError('Use lowercase letters, digits and hyphen-separated words that fit the GitHub environment name.');
	if (typeof p.label !== 'string' || !p.label.trim()) throw new TypeError('Enter a display name.');
	const mode = p.id === 'legacy' ? 'primary' : 'parallel';
	if (p.mode !== mode) throw new TypeError('Only the existing legacy deployment may manage production.');
	if (typeof p.enabled !== 'boolean') throw new TypeError('Select the publishing state.');
	if (typeof p.teamId !== 'string' || !/^team_[A-Za-z0-9]+$/.test(p.teamId)) throw new TypeError('Enter the Vercel team ID.');
	if (typeof p.projectId !== 'string' || !/^prj_[A-Za-z0-9]+$/.test(p.projectId)) throw new TypeError('Enter the Vercel project ID.');
	if (typeof p.teamSlug !== 'string' || !slug.test(p.teamSlug)) throw new TypeError('Enter the Vercel team slug.');
	if (typeof p.projectName !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(p.projectName)) throw new TypeError('Enter the Vercel project name.');
	if (typeof p.testOrigin !== 'string' || (mode === 'parallel' ? !origin.test(p.testOrigin) : p.testOrigin !== ''))
		throw new TypeError('Parallel deployments require their exact HTTPS vercel.app alias.');
	const lanes = p.pilotLanes;
	if (lanes !== undefined && (!Array.isArray(lanes) || mode !== 'parallel' ||
		lanes.some((lane) => !['production', 'development', 'preview'].includes(lane)) ||
		new Set(lanes).size !== lanes.length))
		throw new TypeError('Select distinct supported pilot lanes for a parallel profile.');
	return {
		id: p.id,
		label: p.label.trim(),
		mode,
		teamId: p.teamId,
		teamSlug: p.teamSlug,
		projectId: p.projectId,
		projectName: p.projectName,
		testOrigin: p.testOrigin,
		enabled: p.enabled,
		...(lanes === undefined ? {} : { pilotLanes: lanes as DeploymentProfile['pilotLanes'] })
	};
}

export class DeploymentProfileConflict extends Error {
	constructor() {
		super('The saved revision or target identity differs. Reload the profiles before saving.');
	}
}
