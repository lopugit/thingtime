import jsQR from 'jsqr';
import { parseTotp } from './totp';
export function authenticatorQr(text: string): string {
  if (/^fido:/i.test(text)) throw new Error('This is a passkey device-pairing code. Finish the device handoff, or choose Thingtime in the system passkey provider picker. It is not a TOTP setup code.');
  if (!/^otpauth:\/\/totp\//i.test(text)) throw new Error('This QR code is not a time-based authenticator setup code.');
  parseTotp(text); return text;
}
function decodeImage(image: CanvasImageSource, width: number, height: number) {
  if (!width || !height || width * height > 20_000_000) throw new Error('Choose an image under 20 megapixels.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image scanning is unavailable.');
  try {
    context.drawImage(image, 0, 0); const pixels = context.getImageData(0, 0, width, height);
    try { const qr = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' }); if (!qr) throw new Error('No QR code found. Crop closer to the setup QR code and try again.'); return authenticatorQr(qr.data); }
    finally { pixels.data.fill(0); }
  } finally { context.clearRect(0, 0, width, height); canvas.width = canvas.height = 0; }
}
export async function scanQrFile(file: File): Promise<string> {
  if (file.size > 12 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Upload a PNG, JPEG or WebP image under 12 MiB.');
  const bitmap = await createImageBitmap(file);
  try { return decodeImage(bitmap, bitmap.width, bitmap.height); } finally { bitmap.close(); }
}
function waitForCapture<T>(pending: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => finish(() => reject(new DOMException('Cancelled', 'AbortError')));
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => finish(() => reject(new Error('Screen capture timed out.'))), timeoutMs);
    const finish = (done: () => void) => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); done(); };
    signal?.addEventListener('abort', aborted, { once: true });
    pending.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
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
  const stream = await waitForCapture(pending, signal);
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
    return decodeImage(video, video.videoWidth, video.videoHeight);
  } finally { finished = true; if (frame !== undefined) video.cancelVideoFrameCallback(frame); stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null; }
}
