/** The device thumbnail wire format is PNG, at most 64 × 64 pixels.
 * These bytes are allowed only in image sources, never links or HTML. */
export function isPngThumbnail(value: unknown): value is string {
 if (typeof value !== 'string' || value.length > 32768 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
 try {
  const bytes = Uint8Array.from(atob(value.slice(22)), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  return bytes.length >= 33 && [137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte)
   && String.fromCharCode(...bytes.slice(12,16)) === 'IHDR'
   && view.getUint32(16) > 0 && view.getUint32(16) <= 64 && view.getUint32(20) > 0 && view.getUint32(20) <= 64;
 } catch { return false; }
}
