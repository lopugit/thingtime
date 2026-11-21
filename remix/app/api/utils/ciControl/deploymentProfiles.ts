import { createHash, randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getSettingsCollection } from '../mongodb/collections';
import { DeploymentProfileConflict, isDeploymentProfileId, parseDeploymentProfile, type SavedDeploymentProfile } from './deploymentProfilesCore';

const prefix = 'ci-deployment-profile/';
function readProfile(row: Record<string, any>): SavedDeploymentProfile {
	const parsed = parseDeploymentProfile(row.profile);
	if (row.key !== prefix + parsed.id || typeof row.revision !== 'string') throw new Error('Invalid stored deployment profile.');
	return { ...parsed, revision: row.revision };
}
export async function getDeploymentProfile(id: string): Promise<SavedDeploymentProfile | null> {
	if (!isDeploymentProfileId(id)) return null;
	const row = await (await getSettingsCollection()).findOne({ key: prefix + id });
	return row ? readProfile(row) : null;
}
export async function listDeploymentProfiles() {
	const rows = await (
		await getSettingsCollection()
	)
		.find({ key: /^ci-deployment-profile\// }, { projection: { key: 1, profile: 1, revision: 1 } })
		.sort({ key: 1 })
		.toArray();
	return rows.map(readProfile);
}
export async function saveDeploymentProfile(value: unknown, expectedRevision: string | null, updatedBy: string): Promise<SavedDeploymentProfile> {
	const profile = parseDeploymentProfile(value);
	const key = prefix + profile.id;
	// The existing unique key index protects the stable profile ID. The primary
	// key separately prevents two profiles from claiming the same Vercel target.
	const _id = new ObjectId(
		createHash('sha256')
			.update(prefix + profile.teamId + '/' + profile.projectId)
			.digest()
			.subarray(0, 12)
	);
	const revision = randomUUID();
	const fields = { profile, revision, updatedAt: new Date(), updatedBy };
	const settings = await getSettingsCollection();
	try {
		if (expectedRevision === null) await settings.insertOne({ _id, key, ...fields });
		else {
			const result = await settings.updateOne({ _id, key, revision: expectedRevision }, { $set: fields });
			if (!result.matchedCount) throw new DeploymentProfileConflict();
		}
	} catch (error) {
		if ((error as { code?: number }).code === 11000) throw new DeploymentProfileConflict();
		throw error;
	}
	return { ...profile, revision };
}
