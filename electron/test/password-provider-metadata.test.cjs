const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const contract = import('../scripts/verify-password-provider.mjs');
const info = (identifier = 'com.thingtime.passwords') => ({ CFBundleIdentifier: identifier, CFBundleDisplayName: 'Thingtime', CFBundleName: 'Thingtime', CFBundleIconFile: 'Thingtime.icns', CFBundleIconName: 'Thingtime', CFBundleShortVersionString: '1.0.8', CFBundleVersion: '9' });

test('packaged verification rejects stale host or provider branding and mismatched sibling builds', async () => {
 const { assertPasswordProviderMetadata } = await contract;
 const version = assertPasswordProviderMetadata(info(), 'com.thingtime.passwords');
 assert.equal(version,'1.0.8/9');
 assert.equal(assertPasswordProviderMetadata(info('com.thingtime.passwords.provider'), 'com.thingtime.passwords.provider',version), version);
 for (const field of ['CFBundleDisplayName','CFBundleName']) {
  assert.throws(()=>assertPasswordProviderMetadata({...info(),[field]:'Thingtime Passwords'}, 'com.thingtime.passwords'), /display name/);
 }
 assert.throws(()=>assertPasswordProviderMetadata({...info(),CFBundleIconFile:'generic.icns'}, 'com.thingtime.passwords'), /tree app icon/);
 assert.throws(()=>assertPasswordProviderMetadata({...info(),CFBundleVersion:'4'}, 'com.thingtime.passwords', version), /versions must match/);
 assert.throws(()=>assertPasswordProviderMetadata(info('com.other'), 'com.thingtime.passwords'), /identifier mismatch/);
});

test('source plists ship Thingtime branding while bundle and executable identities remain build settings', {skip:process.platform!=='darwin'}, async()=>{
 const {assertPasswordProviderMetadata}=await contract;
 for(const filename of ['Info.plist','Extension-Info.plist']) {
  const file=path.resolve(__dirname,'../../macos/ThingtimePasswords/Resources',filename);
  const parsed=spawnSync('/usr/bin/plutil',['-convert','json','-o','-',file],{encoding:'utf8'});
  assert.equal(parsed.status,0);
  const metadata=JSON.parse(parsed.stdout);
  assert.equal(metadata.CFBundleExecutable,'$(EXECUTABLE_NAME)');
  const branding=filename==='Info.plist'?{
   hostName:'Thingtime Passwords',
   localizedInfo:JSON.parse(spawnSync('/usr/bin/plutil',['-convert','json','-o','-',path.resolve(path.dirname(file),'en.lproj/InfoPlist.strings')],{encoding:'utf8'}).stdout)
  }:{};
  assert.equal(assertPasswordProviderMetadata(metadata,'$(PRODUCT_BUNDLE_IDENTIFIER)',undefined,branding), '$(MARKETING_VERSION)/$(CURRENT_PROJECT_VERSION)');
 }
});

test('browser adapter branding and explicit local QR keep the existing permission inventory',()=>{
 const root=path.resolve(__dirname,'../../browser-extension');
 const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
 assert.equal(manifest.name,'Thingtime'); assert.equal(manifest.action.default_title,'Thingtime');
 assert.deepEqual(manifest.permissions,['storage','tabs','webNavigation','alarms']);
 assert.deepEqual(manifest.host_permissions,['https://*/*','http://localhost/*','http://127.0.0.1/*']);
 const popup=readFileSync(path.join(root,'popup.html'),'utf8');
 assert.match(popup,/<title>Thingtime · Password workspace<\/title>/); assert.match(popup,/<h1>Thingtime<\/h1>/);
});


test('host branding accepts its intentional raw basename only with complete Thingtime localization',async()=>{
 const {assertPasswordProviderMetadata}=await contract;
 const host={...info(),CFBundleDisplayName:'Thingtime Passwords'};
 const branding={hostName:'Thingtime Passwords',localizedInfo:{CFBundleDisplayName:'Thingtime',CFBundleName:'Thingtime'}};
 assert.equal(assertPasswordProviderMetadata(host,'com.thingtime.passwords',undefined,branding),'1.0.8/9');
 for(const localizedInfo of [undefined,{}, {CFBundleDisplayName:'Thingtime'}, {CFBundleDisplayName:'Thingtime Passwords',CFBundleName:'Thingtime'}, {CFBundleDisplayName:'Thingtime',CFBundleName:'Wrong'}]) {
  assert.throws(()=>assertPasswordProviderMetadata(host,'com.thingtime.passwords',undefined,{...branding,localizedInfo}),/localization/);
 }
 assert.throws(()=>assertPasswordProviderMetadata(info(),'com.thingtime.passwords',undefined,branding),/display name/);
 assert.throws(()=>assertPasswordProviderMetadata(host,'com.thingtime.passwords',undefined,{...branding,hostName:'Renamed'}),/display name/);
});

test('native provider resources carry the official tree rather than a generic or invented icon',()=>{
 const resources=path.resolve(__dirname,'../../macos/ThingtimePasswords/Resources');
 const official=readFileSync(path.resolve(__dirname,'../../remix/public/branding/generated/icon/thingtime-icon-512x512.png'));
 assert.deepEqual(readFileSync(path.join(resources,'ThingtimeTree.png')),official);
 const icon=readFileSync(path.join(resources,'Thingtime.icns'));assert.equal(icon.toString('ascii',0,4),'icns');assert.equal(icon.readUInt32BE(4),icon.length);
});


test('provider picker icon metadata rejects missing catalog names and incomplete compiled assets',async()=>{
 const {assertPasswordProviderMetadata,assertPasswordProviderIconCatalog}=await contract;
 assert.equal(assertPasswordProviderMetadata({...info(),CFBundleIconFile:'Thingtime'},'com.thingtime.passwords'),'1.0.8/9');
 for(const CFBundleIconName of [undefined,'Generic']) {
  assert.throws(()=>assertPasswordProviderMetadata({...info(),CFBundleIconName},'com.thingtime.passwords'),/compiled asset name/);
 }
 const renditions=[16,32,128,256,512].flatMap(points=>[1,2].map(scale=>({AssetType:'Icon Image',Name:'Thingtime',Scale:scale,PixelWidth:points*scale,PixelHeight:points*scale})));
 assert.doesNotThrow(()=>assertPasswordProviderIconCatalog(renditions));
 for(const invalid of [null,[],renditions.slice(1),renditions.map(icon=>({...icon,Name:'Placeholder'}))]) {
  assert.throws(()=>assertPasswordProviderIconCatalog(invalid),/required macOS rendition/);
 }
 const root=path.resolve(__dirname,'../../');
 const iconset=path.join(root,'macos/ThingtimePasswords/Resources/Assets.xcassets/Thingtime.appiconset');
 const catalog=JSON.parse(readFileSync(path.join(iconset,'Contents.json'),'utf8'));
 assert.equal(catalog.images.length,10);
 for(const image of catalog.images) {
  const pixels=Number(image.size.split('x')[0])*Number(image.scale.slice(0,-1));
  assert.equal(image.idiom,'mac');
  assert.deepEqual(readFileSync(path.join(iconset,image.filename)),readFileSync(path.join(root,`remix/public/branding/generated/icon/thingtime-icon-${pixels}x${pixels}.png`)));
 }
});
