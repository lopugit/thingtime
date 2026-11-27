import jsQR from 'jsqr';
import { parseTotp } from './totp';
export function authenticatorQr(text: string): string {
  if (/^fido:/i.test(text)) throw new Error('This is a passkey device-pairing code. Finish the device handoff, or choose Thingtime in the system passkey provider picker. It is not a TOTP setup code.');
  if (!/^otpauth:\/\/totp\//i.test(text)) throw new Error('This QR code is not a time-based authenticator setup code.');
  parseTotp(text); return text;
}
async function decodeImage(image: CanvasImageSource, width: number, height: number, signal?: AbortSignal) {
  if (!width || !height) throw new Error('Choose an image with readable dimensions.');
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image scanning is unavailable.');
  // Tile size and overlap bound working memory; they never reject large images.
  const tile = 2048, step = 1536; let scans = 0;
  try {
    for (let scale = Math.min(1, tile / Math.max(width, height)); ; scale = Math.min(1, scale * 2)) {
      const w = Math.ceil(width * scale), h = Math.ceil(height * scale);
      for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
        signal?.throwIfAborted(); const tw = Math.min(tile, w - x), th = Math.min(tile, h - y);
        canvas.width = tw; canvas.height = th;
        context.drawImage(image, x / scale, y / scale, tw / scale, th / scale, 0, 0, tw, th);
        const pixels = context.getImageData(0, 0, tw, th);
        try { const qr = jsQR(pixels.data, tw, th, { inversionAttempts: 'attemptBoth' }); if (qr) return authenticatorQr(qr.data); }
        finally { pixels.data.fill(0); context.clearRect(0, 0, tw, th); }
        if (++scans % 4 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (scale === 1) break;
    }
    throw new Error('No QR code found. Crop closer to the setup QR code and try again.');
  } finally { context.clearRect(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0; }
}
export async function scanQrFile(file: File, signal?: AbortSignal): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Upload a PNG, JPEG or WebP image.');
  signal?.throwIfAborted(); const bitmap = await createImageBitmap(file);
  try { signal?.throwIfAborted(); return await decodeImage(bitmap, bitmap.width, bitmap.height, signal); } finally { bitmap.close(); }
}
function waitForCapture<T>(pending: Promise<T>, signal?: AbortSignal, timeoutMs?: number, disposeLate?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const aborted = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => finish(() => reject(new Error('Screen capture timed out.'))), timeoutMs);
    const finish = (done: () => void) => { if (settled) return false; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); done(); return true; };
    signal?.addEventListener('abort', aborted, { once: true });
    pending.then(value => { if (!finish(() => resolve(value))) disposeLate?.(value); }, error => finish(() => reject(error)));
    if (signal?.aborted) aborted();
  });
}
export async function scanQrScreen(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is unavailable here. Upload a screenshot of the QR code instead.');
  // Browsers cannot cancel an open chooser. If it resolves after the editor
  // closes, stop its stream before creating a video or reading any pixels.
  const pending = navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then(stream => {
    if (signal?.aborted) { stream.getTracks().forEach(track => track.stop()); signal.throwIfAborted(); }
    return stream;
  });
  const stream = await waitForCapture(pending, signal, undefined, value => value.getTracks().forEach(track => track.stop()));
  const video = document.createElement('video');
  let frame: number | undefined, finished = false;
  try {
    video.srcObject = stream; video.muted = true;
    await waitForCapture(video.play().then(() => new Promise<void>((resolve, reject) => {
      if (finished) { reject(new DOMException('Cancelled', 'AbortError')); return; }
      if ('requestVideoFrameCallback' in video) frame = video.requestVideoFrameCallback(() => resolve());
      else resolve();
    })), signal, 5000);
    signal?.throwIfAborted();
    const pendingBitmap = createImageBitmap(video).then(bitmap => { if (finished || signal?.aborted) { bitmap.close(); throw new DOMException('Cancelled', 'AbortError'); } return bitmap; });
    const bitmap = await waitForCapture(pendingBitmap, signal, 5000, value => value.close());
    try { signal?.throwIfAborted(); stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null; return await decodeImage(bitmap, bitmap.width, bitmap.height, signal); }
    finally { bitmap.close(); }
  } finally { finished = true; if (frame !== undefined) video.cancelVideoFrameCallback(frame); stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null; }
}
