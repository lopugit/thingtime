import { binaryBytes } from '../auth/binary.ts';
const kinds = ['lopu-instruction-transfer', 'lopu-instruction-part'];
/** New protected kinds have no older unmetered generation. Count exact secure
 * UTF-8 bytes in addition to the ordinary canonical payload; never trust a
 * caller-supplied size or duplicate instruction text into searchable crystal. */
export function instructionPayloadBytes(doc: {thingtime?: unknown; secure?: unknown}): number | null {
 if (!Array.isArray(doc.thingtime) || !doc.thingtime.some(kind => kinds.includes(kind))) return 0;
 if (doc.thingtime.length !== 1) return null;
 return binaryBytes(doc.secure);
}
