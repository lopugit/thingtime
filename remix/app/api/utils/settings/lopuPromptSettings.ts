import { randomUUID } from 'node:crypto';
import { getSettingsCollection } from '../mongodb/collections';
import { getUserLopuInstructions } from '../auth/users';
import { DEFAULT_LOPU_BASE_PROMPT, LopuPromptConflictError, validateLopuBasePrompt, type LopuBasePromptSettings, type LopuPromptSettings } from '../lopu/promptSettingsCore';

export const LOPU_BASE_PROMPT_KEY = 'Thingtime.LopuBasePrompt';
// No positive cache: edits and disabled instructions apply on the next turn,
// across warm instances. Read failures never silently resurrect old preferences.
export async function getLopuBasePrompt(): Promise<LopuBasePromptSettings> {
  const row = await (await getSettingsCollection()).findOne({ key: LOPU_BASE_PROMPT_KEY }, { projection: { basePrompt: 1, revision: 1 } });
  return row ? { basePrompt: validateLopuBasePrompt(row.basePrompt), revision: row.revision ?? null } : { basePrompt: DEFAULT_LOPU_BASE_PROMPT, revision: null };
}
export async function setLopuBasePrompt(basePrompt: unknown, expectedRevision: string | null, updatedBy: string): Promise<LopuBasePromptSettings> {
  const settings = { basePrompt: validateLopuBasePrompt(basePrompt), revision: randomUUID() };
  try {
    const result = await (await getSettingsCollection()).updateOne(
      { key: LOPU_BASE_PROMPT_KEY, revision: expectedRevision } as any,
      { $set: { key: LOPU_BASE_PROMPT_KEY, ...settings, updatedAt: new Date(), updatedBy } },
      { upsert: expectedRevision === null }
    );
    if (!result.matchedCount && !result.upsertedCount) throw new LopuPromptConflictError();
  } catch (error) {
    if ((error as any)?.code === 11000) throw new LopuPromptConflictError();
    throw error;
  }
  return settings;
}
export async function getLopuPromptSettings(ownerId?: string): Promise<LopuPromptSettings> {
  const [base, personal] = await Promise.all([getLopuBasePrompt(), ownerId ? getUserLopuInstructions(ownerId) : { instructions: [] }]);
  return { basePrompt: base.basePrompt, instructions: personal.instructions };
}
