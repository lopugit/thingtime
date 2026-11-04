import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pruneFunctionImagePlatforms } from './prune-function-platforms.mjs';
test('function image pruning keeps target binaries and portable wrappers only', async () => {
 const root = await mkdtemp(join(tmpdir(), 'tt-image-platform-'));
 try {
  for (const name of ['@img/sharp-linux-x64','@img/sharp-libvips-linux-x64','@img/sharp-libvips-darwin-arm64','@img/sharp-libvips-linuxmusl-x64','@img/colour','@resvg/resvg-js','@resvg/resvg-js-linux-x64-gnu','@resvg/resvg-js-linux-x64-musl','@resvg/resvg-js-darwin-arm64']) await mkdir(join(root,'node_modules',name),{recursive:true});
  await pruneFunctionImagePlatforms(root,{platform:'linux',arch:'x64'});
  assert.deepEqual((await readdir(join(root,'node_modules/@img'))).sort(), ['colour','sharp-libvips-linux-x64','sharp-linux-x64']);
  assert.deepEqual((await readdir(join(root,'node_modules/@resvg'))).sort(), ['resvg-js','resvg-js-linux-x64-gnu']);
  await assert.rejects(pruneFunctionImagePlatforms(root,{platform:'other',arch:'x64'}));
 } finally { await rm(root,{recursive:true,force:true}); }
});
test('image pruning refuses a scope symlink outside the built function', async () => {
 const root = await mkdtemp(join(tmpdir(), 'tt-image-scope-'));
 try {
  await mkdir(join(root,'function/node_modules'),{recursive:true}); await mkdir(join(root,'external'));
  await symlink(join(root,'external'),join(root,'function/node_modules/@img'));
  await assert.rejects(pruneFunctionImagePlatforms(join(root,'function'),{platform:'darwin',arch:'arm64'}), /escapes/);
 } finally { await rm(root,{recursive:true,force:true}); }
});
