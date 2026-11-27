import sharp from 'sharp';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('.', import.meta.url));
const output = fileURLToPath(new URL('../../tmp/media-acceptance/', import.meta.url));
await mkdir(output, { recursive: true });
execFileSync('ffmpeg', [
	'-hide_banner',
	'-loglevel',
	'error',
	'-y',
	'-f',
	'lavfi',
	'-i',
	'testsrc2=size=1280x720:rate=30',
	'-f',
	'lavfi',
	'-i',
	'sine=frequency=880:sample_rate=48000',
	'-t',
	'4',
	'-c:v',
	'libx264',
	'-crf',
	'10',
	'-pix_fmt',
	'yuv420p',
	'-c:a',
	'aac',
	'-b:a',
	'192k',
	output + 'source.mp4'
]);
const width = 1024, height = 768;
const pixels = Buffer.alloc(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
 const i = (y * width + x) * 4;
 pixels.set([(x * 7 + y * 3) % 256, (x * 11 + y * 5) % 256, (x * 13 + y * 7) % 256, x < 128 ? 0 : x < 256 ? 100 : 255], i);
}
await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(output + 'source.png');
await sharp(pixels, { raw: { width, height, channels: 4 } }).flatten({ background: '#ffffff' }).jpeg({ quality: 99 }).toFile(output + 'source.jpg');
await sharp(pixels, { raw: { width, height, channels: 4 } }).tiff().toFile(output + 'source.tiff');
execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',output+'source.mp4','-t','1','-vf','fps=4,scale=160:90',output+'source.gif']);
await build({
	root,
	configFile: false,
	resolve: { alias: { '~': fileURLToPath(new URL('../../app', import.meta.url)) } },
	build: { outDir: output + 'built', emptyOutDir: true }
});
