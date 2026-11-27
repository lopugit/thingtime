export const SYNC_STREAM_UPLOAD_UNAVAILABLE = 'This browser or storage connection cannot stream a rate-limited sync upload. Use an updated Thingtime app with native upload support, or remove the upload speed and CPU limits. Your saved run is preserved for retry.';
/** Request construction performs no network access. WebKit may stringify a
 * stream body, so testing ReadableStream alone is insufficient. HTTP2/3 and the
 * signed storage origin's CORS policy still require validation at dispatch. */
export function supportsSyncUploadStreaming(construct: typeof Request = globalThis.Request): boolean {
 try {
  let duplexRead = false;
  const request = new construct('https://stream-capability.invalid', { method: 'POST', body: new ReadableStream({ start(c) { c.close(); } }),
   get duplex() { duplexRead = true; return 'half'; }
  } as RequestInit);
  return duplexRead && !request.headers.has('Content-Type');
 } catch { return false; }
}
