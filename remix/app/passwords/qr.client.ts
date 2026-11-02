import jsQR from 'jsqr';
import { parseTotp } from './totp';
export function authenticatorQr(text: string): string {
  if (/^fido:/i.test(text)) throw new Error('This is a passkey device-pairing code. Finish the device handoff, or choose Thingtime in the system passkey provider picker. It is not a TOTP setup code.');
  if (!/^otpauth:\/\/totp\//i.test(text)) throw new Error('This QR code is not a time-based authenticator setup code.');
  parseTotp(text); return text;
}
function* offsets(length: number, tile: number) {
  const last = Math.max(0, length - tile);
  for (let offset = 0; ; offset = Math.min(last, offset + tile / 2)) {
    yield offset;
    if (offset === last) return;
  }
}
async function decodeImage(image: CanvasImageSource, width: number, height: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('The image has no readable pixels.');
  // Bound working memory, not the user's image. Try the whole image first,
  // then overlapping tiles at increasing resolutions so small codes in large
  // screenshots remain readable without allocating an image-sized pixel array.
  const tile = 1024, canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image scanning is unavailable.');
  try {
    for (let scale = Math.min(1, tile / Math.max(width, height)); ; scale = Math.min(1, scale * 2)) {
      const scaledWidth = Math.ceil(width * scale), scaledHeight = Math.ceil(height * scale);
      for (const top of offsets(scaledHeight, tile)) for (const left of offsets(scaledWidth, tile)) {
        signal?.throwIfAborted();
        canvas.width = Math.min(tile, scaledWidth - left); canvas.height = Math.min(tile, scaledHeight - top);
        const sourceWidth = Math.min(width - left / scale, canvas.width / scale), sourceHeight = Math.min(height - top / scale, canvas.height / scale);
        context.drawImage(image, left / scale, top / scale, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        try {
          const qr = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
          if (qr) return authenticatorQr(qr.data);
        } finally { pixels.data.fill(0); context.clearRect(0, 0, canvas.width, canvas.height); }
        // Let cancellation and the editor remain responsive between scans.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (scale === 1) break;
    }
    throw new Error('No QR code found. Crop closer to the setup QR code and try again.');
  } finally { context.clearRect(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 0; }
}
export async function scanQrFile(file: File, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Upload a PNG, JPEG or WebP image.');
  const bitmap = await waitForCapture(createImageBitmap(file), signal, undefined, value => value.close());
  try { signal?.throwIfAborted(); return await decodeImage(bitmap, bitmap.width, bitmap.height, signal); } finally { bitmap.close(); }
}
function waitForCapture<T>(pending: Promise<T>, signal?: AbortSignal, timeoutMs?: number, discard?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const aborted = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => finish(() => reject(new Error('Screen capture timed out.'))), timeoutMs);
    const finish = (done: () => void) => {
      if (settled) return false;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); done(); return true;
    };
    signal?.addEventListener('abort', aborted, { once: true });
    pending.then(value => {
      // Ownership transfers in this same callback, with no intervening promise
      // precheck. A cancelled wait still owns and disposes its late resource.
      if (!finish(() => resolve(value))) discard?.(value);
    }, error => finish(() => reject(error)));
    if (signal?.aborted) aborted();
  });
}
export async function scanQrScreen(signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is unavailable here. Upload a screenshot of the QR code instead.');
  // Browsers cannot cancel an open chooser. If it resolves after the editor
  // closes, stop its stream before creating a video or reading any pixels.
  const stream = await waitForCapture(navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }), signal, undefined,
    value => value.getTracks().forEach(track => track.stop()));
  let video: HTMLVideoElement | undefined, frame: number | undefined, finished = false, stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; finished = true;
    if (frame !== undefined) video?.cancelVideoFrameCallback(frame);
    stream.getTracks().forEach(track => track.stop());
    if (video) { video.pause(); video.srcObject = null; }
  };
  try {
    signal?.throwIfAborted();
    const player = document.createElement('video'); video = player;
    player.srcObject = stream; player.muted = true;
    await waitForCapture(player.play().then(() => new Promise<void>((resolve, reject) => {
      if (finished) { reject(new DOMException('Cancelled', 'AbortError')); return; }
      if ('requestVideoFrameCallback' in player) frame = player.requestVideoFrameCallback(() => resolve());
      else resolve();
    })), signal, 5000);
    signal?.throwIfAborted();
    const bitmap = await waitForCapture(createImageBitmap(player), signal, undefined, value => value.close());
    try {
      // Stop sharing as soon as one frame is captured. The bitmap's owner is
      // already protected by finally, including a cancellation at this handoff.
      stop(); signal?.throwIfAborted();
      return await decodeImage(bitmap, bitmap.width, bitmap.height, signal);
    } finally { bitmap.close(); }
  } finally { stop(); }
}
