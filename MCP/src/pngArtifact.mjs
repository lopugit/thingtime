import { inflateSync } from 'node:zlib';
function requireThat(condition, message) { if (!condition) throw new Error(message); }
/** @param {Buffer} bytes */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
/** @param {Buffer} bytes */
export function checkRendererPng(bytes) {
  requireThat(bytes.length >= 45 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'Malformed PNG signature');
  let offset = 8, width, height, channels, ended = false;
  const compressed = [];
  while (offset < bytes.length) {
    requireThat(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    requireThat(end <= bytes.length, 'Truncated PNG chunk');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    requireThat(crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'PNG checksum mismatch');
    if (offset === 8) {
      requireThat(type === 'IHDR' && length === 13, 'Missing PNG header');
      width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
      const depth = bytes[offset + 16], color = bytes[offset + 17];
      requireThat(width > 0 && width <= 1920 && height > 0 && height <= 1440 && depth === 8 && [2, 6].includes(color) && bytes.subarray(offset + 18, offset + 21).every(x => x === 0), 'Unsupported renderer PNG header');
      channels = color === 6 ? 4 : 3;
    } else requireThat(type !== 'IHDR', 'Duplicate PNG header');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') { requireThat(length === 0 && end === bytes.length, 'Invalid PNG end'); ended = true; }
    offset = end;
  }
  requireThat(ended && compressed.length > 0, 'Incomplete PNG');
  const expected = height * (1 + width * channels);
  const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  requireThat(pixels.length === expected, 'Incomplete PNG pixels');
  for (let row = 0; row < height; row++) requireThat(pixels[row * (1 + width * channels)] <= 4, 'Invalid PNG filter');
  return { width, height };
}
