import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = new URL('../', import.meta.url);
const require = createRequire(new URL('../remix/package.json', root));
const { ZipReader, Uint8ArrayReader } = require('@zip.js/zip.js');
const png = async name => {
 const bytes = await readFile(new URL(name, root));
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 return bytes;
};
test('toolbar and extension identity use existing official tree artwork at real icon sizes',async()=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
 for(const [size,file] of Object.entries(manifest.icons)){
  const bytes=await png(file);assert.equal(bytes.readUInt32BE(16),Number(size));assert.equal(bytes.readUInt32BE(20),Number(size));
  if(size!=='48') assert.deepEqual(bytes,await readFile(new URL(`../remix/public/branding/generated/icon/thingtime-icon-${size}x${size}.png`,root)));
 }
 for(const file of Object.values(manifest.action.default_icon)) assert.ok(Object.values(manifest.icons).includes(file));
 const html=await readFile(new URL('popup.html',root),'utf8');assert.match(html,/<img class="mark"[^>]*src="thingtime-icon-128.png"[^>]*alt=""[^>]*aria-hidden="true"/);assert.doesNotMatch(html,/>T<\/span>/);
});
test('the canonical download package carries every manifest and workspace icon without test fixtures',async()=>{
 const build=spawnSync(process.execPath,[new URL('../remix/scripts/build-password-extension.mjs',root).pathname],{encoding:'utf8'});assert.equal(build.status,0,build.stderr);
 const bytes=await readFile(new URL('../../remix/public/downloads/thingtime-passwords-extension.zip',import.meta.url));
 const archive=new ZipReader(new Uint8ArrayReader(bytes));
 try{
  const entries=await archive.getEntries(),names=entries.map(x=>x.filename);const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
  for(const file of new Set([...Object.values(manifest.icons),...Object.values(manifest.action.default_icon),'thingtime-icon-128.png','workspace.js']))assert.ok(names.includes(file),`Missing ${file}`);
  assert.ok(!names.some(name=>name.startsWith('test/')||name.includes('test-driver')));
 }finally{await archive.close();}
});
