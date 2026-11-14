/** Self-host PDF.js decoding/font data; documents never leave the selected origin. */
import { createRequire } from 'node:module';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = new URL('../public/pdfjs/', import.meta.url);
await mkdir(target, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) await cp(join(source, directory), new URL(`${directory}/`, target), { recursive: true });

await cp(join(source, 'build/pdf.worker.min.mjs'), new URL('pdf.worker.min.mjs', target));
