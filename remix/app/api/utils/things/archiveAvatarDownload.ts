import { lookup } from 'node:dns/promises';
import { get, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import { isBlockedLopuProviderHostname } from '../lopu/userVaultCore';
import { withExportDeadline } from '../../../utils/thingTransfer/exportDeadline';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_PIXELS = 4 * 1024 * 1024;
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const special = new BlockList();
special.addSubnet('240.0.0.0', 4, 'ipv4');
special.addSubnet('2001::', 23, 'ipv6');
special.addSubnet('2002::', 16, 'ipv6');

export const isPublicArchiveAvatarAddress = (address: string): boolean => {
  const family = isIP(address);
  return !!family && !isBlockedLopuProviderHostname(address) &&
    !special.check(address, family === 4 ? 'ipv4' : 'ipv6') &&
    (family === 4 || globalV6.check(address, 'ipv6'));
};

const unavailable = () => new Error('The historical avatar could not be safely downloaded');
const defaults = { lookup, get };

/** Internal prerequisite, not an arbitrary-URL HTTP endpoint. Call only after
 * resolving an authorized participant's public profile. No cookies, bearer
 * tokens, referrer, proxy settings, redirects or pooled connections are used.
 * The socket uses the vetted DNS answer, not a second hostname resolution.
 * Only the membership-authorized live-chat adapter calls this helper. */
export const downloadArchiveAvatar = async (value: string, parent?: AbortSignal,
  overrides: Partial<typeof defaults> = {}): Promise<{ bytes: Uint8Array; mime: string }> => withExportDeadline(async signal => {
  const deps = { ...defaults, ...overrides };
  let url: URL;
  try { url = new URL(value); } catch { throw unavailable(); }
  if (value.length > 2048 || url.protocol !== 'https:' || url.username || url.password || url.hash ||
    (url.port && url.port !== '443') || isBlockedLopuProviderHostname(url.hostname)) throw unavailable();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literal = isIP(hostname);
  const addresses = literal ? [{ address: hostname, family: literal }] : await deps.lookup(hostname, { all: true, verbatim: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(row => !isPublicArchiveAvatarAddress(row.address) || isIP(row.address) !== row.family)) throw unavailable();
  const pinned = addresses[0];
  const options: RequestOptions = { agent: false, signal, maxHeaderSize: 16 * 1024,
    headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp', 'Accept-Encoding': 'identity' },
    lookup: (_host, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [pinned]);
      else callback(null, pinned.address, pinned.family);
    } };
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const request = deps.get(url, options, response => {
      void (async () => {
        try {
          const length = response.headers['content-length'];
          const encoding = response.headers['content-encoding'];
          const mime = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
          if (response.statusCode !== 200 || (encoding && encoding !== 'identity') ||
            !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mime || '') ||
            (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))) throw unavailable();
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response) {
            signal.throwIfAborted();
            size += chunk.length;
            if (size > MAX_BYTES) throw unavailable();
            chunks.push(Buffer.from(chunk));
          }
          if (!size || (length !== undefined && size !== Number(length))) throw unavailable();
          resolve(Buffer.concat(chunks, size));
        } catch (error) { reject(error); }
        finally { response.destroy(); }
      })();
    });
    request.on('error', reject);
  });
  signal.throwIfAborted();
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(detected.mime)) throw unavailable();
  const image = sharp(bytes, { animated: true, limitInputPixels: MAX_PIXELS, failOn: 'warning' });
  const metadata = await image.metadata();
  const mime = ({ png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as Record<string, string>)[metadata.format || ''];
  if (!mime || mime !== detected.mime || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS) throw unavailable();
  // Decode every frame under the same pixel limit; metadata alone accepts
  // truncated streams. Keep original bytes, including animation and metadata.
  await image.stats();
  signal.throwIfAborted();
  return { bytes: new Uint8Array(bytes), mime };
}, parent, 10_000);
