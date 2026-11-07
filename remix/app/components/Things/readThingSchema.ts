import { ThingtimeApiError } from '../../hooks/apiFailure';

type SchemaRead = { id: string; sharedRoot?: string; key?: string };
/** An owned root can use its local schema immediately. A foreign schema may
 * still be inherited through the server-authorized composition, so preserve
 * that read after a definitive direct-read refusal. Shared/keyed roots always
 * use the composition path; neither a URL nor a cached template grants access. */
export async function readThingSchema<T>(
 get: (args: SchemaRead, options: { signal: AbortSignal }) => Promise<T>,
 input: { schemaId: string; rootId: string; owned: boolean; linkKey?: string },
 signal: AbortSignal
): Promise<T> {
 const { schemaId: id, rootId: sharedRoot, owned, linkKey } = input;
 signal.throwIfAborted();
 if (owned && !linkKey) {
  try { return await get({ id }, { signal }); }
  catch (error) {
   signal.throwIfAborted();
   if (!(error instanceof ThingtimeApiError) || ![403, 404].includes(error.status ?? 0)) throw error;
  }
 }
 return get({ id, sharedRoot, ...(linkKey ? { key: linkKey } : {}) }, { signal });
}
