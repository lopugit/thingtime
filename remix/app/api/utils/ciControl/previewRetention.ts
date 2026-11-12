import { randomUUID } from 'node:crypto';
import { getSettingsCollection } from '../mongodb/collections';
import { DEFAULT_PREVIEW_RETENTION, PREVIEW_RETENTION_KEY, PreviewRetentionConflict, parsePreviewRetentionPolicy, type PreviewRetentionSettings } from './previewRetentionCore';

// Fresh home-plane reads only: an outage must never resurrect a disabled policy.
export const getPreviewRetention = async (): Promise<PreviewRetentionSettings> => {
  const row = await (await getSettingsCollection()).findOne({ key: PREVIEW_RETENTION_KEY }, { projection: { policy: 1, revision: 1 } });
  if (!row) return { policy: { ...DEFAULT_PREVIEW_RETENTION }, revision: null };
  if (typeof row.revision !== 'string') throw new Error('Saved preview policy is invalid');
  return { policy: parsePreviewRetentionPolicy(row.policy), revision: row.revision };
};
export const setPreviewRetention = async (value: unknown, expectedRevision: string | null, updatedBy: string): Promise<PreviewRetentionSettings> => {
  const settings = { policy: parsePreviewRetentionPolicy(value), revision: randomUUID() };
  try {
    const result = await (await getSettingsCollection()).updateOne(
      { key: PREVIEW_RETENTION_KEY, revision: expectedRevision } as any,
      { $set: { key: PREVIEW_RETENTION_KEY, ...settings, updatedAt: new Date(), updatedBy } },
      { upsert: expectedRevision === null }
    );
    if (!result.matchedCount && !result.upsertedCount) throw new PreviewRetentionConflict();
  } catch (error) {
    if ((error as any)?.code === 11000) throw new PreviewRetentionConflict();
    throw error;
  }
  return settings;
};
