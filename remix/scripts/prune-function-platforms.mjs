import { readdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

// NFT can trace every optional native image dependency from a cross-platform
// pnpm install. Functions run on one CPU/OS: retain that runtime plus portable
// wrappers and WASM fallbacks, rather than shipping every libvips binary.
export async function pruneFunctionImagePlatforms(root, { platform, arch }) {
  if (!['linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Unsupported function image platform.');
  const base = await realpath(root), target = `${platform}-${arch}`;
  const groups = [
    ['@img', /^sharp-(?:libvips-)?(?:darwin|linux|linuxmusl|win32|android)-/, new Set([`sharp-${target}`, `sharp-libvips-${target}`])],
    ['@resvg', /^resvg-js-(?:darwin|linux|win32|android)-/, new Set([`resvg-js-${target}${platform === 'linux' ? '-gnu' : ''}`])]
  ];
  for (const [scope, pattern, keep] of groups) {
    const directory = join(base, 'node_modules', scope);
    let actual;
    try { actual = await realpath(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const rel = relative(base, actual);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Function image package scope escapes the emitted function.');
    for (const name of await readdir(actual)) if (pattern.test(name) && !keep.has(name)) await rm(join(actual, name), { recursive: true, force: true });
  }
}
