export type TotpConfig = { secret: string; algorithm: 'SHA-1' | 'SHA-256' | 'SHA-512'; digits: 6 | 8; period: number; issuer: string; account: string };
export function decodeBase32(source: string): Uint8Array<ArrayBuffer> {
  const value = source.replace(/\s/g, '').toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]{16,1024}$/.test(value)) throw new Error('Enter a valid Base32 authenticator secret.');
  let buffer = 0, bits = 0;
  const bytes: number[] = [];
  for (const char of value) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  if ((buffer & ((1 << bits) - 1)) !== 0) throw new Error('Invalid Base32 padding.');
  return new Uint8Array(bytes);
}
export function parseTotp(value: string): TotpConfig {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid authenticator setup.');
  const text = value.trim();
  let result: TotpConfig = { secret: text, algorithm: 'SHA-1', digits: 6, period: 30, issuer: '', account: '' };
  if (text.includes(':')) {
    let url: URL;
    try { url = new URL(text); } catch { throw new Error('Invalid authenticator setup link.'); }
    if (url.protocol !== 'otpauth:' || url.hostname !== 'totp' || url.username || url.password || url.port || url.hash)
      throw new Error('Use an otpauth://totp setup QR code or secret. Passkey handoff QR codes are not authenticator secrets.');
    for (const key of url.searchParams.keys()) if (url.searchParams.getAll(key).length !== 1) throw new Error('Duplicate authenticator option.');
    const algorithm = (url.searchParams.get('algorithm') || 'SHA1').toUpperCase();
    const digits = url.searchParams.get('digits') || '6', period = url.searchParams.get('period') || '30';
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm) || !['6', '8'].includes(digits) || !/^\d{1,3}$/.test(period) || +period < 15 || +period > 120)
      throw new Error('Unsupported authenticator algorithm, digits, or period.');
    const label = decodeURIComponent(url.pathname.slice(1));
    result = { secret: url.searchParams.get('secret') || '', algorithm: algorithm.replace('SHA', 'SHA-') as TotpConfig['algorithm'], digits: +digits as 6 | 8, period: +period, issuer: url.searchParams.get('issuer') || '', account: label };
  }
  decodeBase32(result.secret);
  return { ...result, secret: result.secret.replace(/\s/g, '').toUpperCase().replace(/=+$/, '') };
}
export async function totpCode(value: string, time = Date.now()): Promise<{ code: string; remaining: number; period: number }> {
  const config = parseTotp(value), secret = decodeBase32(config.secret);
  if (!Number.isFinite(time) || time < 0) throw new Error('Invalid clock.');
  const counter = BigInt(Math.floor(time / 1000 / config.period));
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, counter);
  try {
    const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: config.algorithm }, false, ['sign']);
    const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
    const offset = digest[digest.length - 1] & 15;
    const number = ((digest[offset] & 127) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
    return { code: String(number % (10 ** config.digits)).padStart(config.digits, '0'), remaining: config.period - Math.floor(time / 1000) % config.period, period: config.period };
  } finally { secret.fill(0); }
}
