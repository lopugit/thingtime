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
await build({
	root,
	configFile: false,
	resolve: { alias: { '~': fileURLToPath(new URL('../../app', import.meta.url)) } },
	build: { outDir: output + 'built', emptyOutDir: true }
});
