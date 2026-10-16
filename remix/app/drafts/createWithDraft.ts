/** Autosave and cleanup are ancillary. A stalled or rejected draft request
 * must never prevent the authoritative content write from completing. */
export async function createWithDraft<T extends { ok?: boolean }>(draft: { flush(): Promise<unknown>; retire(): Promise<unknown> }, create: () => Promise<T>): Promise<T> {
 void Promise.resolve().then(() => draft.flush()).catch(() => {});
 const result = await create();
 if (!result?.ok) throw result;
 void Promise.resolve().then(() => draft.retire()).catch(() => {});
 return result;
}
