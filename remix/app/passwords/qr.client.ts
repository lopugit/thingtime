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
export async function scanQrScreen(): Promise<string> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture is unavailable here. Upload a screenshot of the QR code instead.');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement('video');
  try {
    video.srcObject = stream; video.muted = true;
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Screen capture timed out.')), 5000);
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
      else { clearTimeout(timer); resolve(); }
    });
    return decodeImage(video, video.videoWidth, video.videoHeight);
  } finally { stream.getTracks().forEach(track => track.stop()); video.pause(); video.srcObject = null; }
}
