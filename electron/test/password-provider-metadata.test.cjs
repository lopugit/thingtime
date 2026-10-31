const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const contract = import('../scripts/verify-password-provider.mjs');
const info = (identifier = 'com.thingtime.passwords') => ({ CFBundleIdentifier: identifier, CFBundleDisplayName: 'Thingtime', CFBundleName: 'Thingtime', CFBundleShortVersionString: '1.0.6', CFBundleVersion: '7' });

test('packaged verification rejects stale host or provider branding and mismatched sibling builds', async () => {
 const { assertPasswordProviderMetadata } = await contract;
 const version = assertPasswordProviderMetadata(info(), 'com.thingtime.passwords');
 assert.equal(version,'1.0.6/7');
 assert.equal(assertPasswordProviderMetadata(info('com.thingtime.passwords.provider'), 'com.thingtime.passwords.provider',version), version);
 for (const field of ['CFBundleDisplayName','CFBundleName']) {
  assert.throws(()=>assertPasswordProviderMetadata({...info(),[field]:'Thingtime Passwords'}, 'com.thingtime.passwords'), /display name/);
 }
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

test('browser adapter manifest, action and popup all display Thingtime without expanding permissions',()=>{
 const root=path.resolve(__dirname,'../../browser-extension');
 const manifest=JSON.parse(readFileSync(path.join(root,'manifest.json'),'utf8'));
 assert.equal(manifest.name,'Thingtime'); assert.equal(manifest.action.default_title,'Thingtime');
 assert.deepEqual(manifest.permissions,['storage','tabs','webNavigation','alarms']);
 assert.deepEqual(manifest.host_permissions,['https://*/*','http://localhost/*','http://127.0.0.1/*']);
 const popup=readFileSync(path.join(root,'popup.html'),'utf8');
 assert.match(popup,/<title>Thingtime<\/title>/); assert.match(popup,/<h1>Thingtime<\/h1>/);
});


test('host branding accepts its intentional raw basename only with complete Thingtime localization',async()=>{
 const {assertPasswordProviderMetadata}=await contract;
 const host={...info(),CFBundleDisplayName:'Thingtime Passwords'};
 const branding={hostName:'Thingtime Passwords',localizedInfo:{CFBundleDisplayName:'Thingtime',CFBundleName:'Thingtime'}};
 assert.equal(assertPasswordProviderMetadata(host,'com.thingtime.passwords',undefined,branding),'1.0.6/7');
 for(const localizedInfo of [undefined,{}, {CFBundleDisplayName:'Thingtime'}, {CFBundleDisplayName:'Thingtime Passwords',CFBundleName:'Thingtime'}, {CFBundleDisplayName:'Thingtime',CFBundleName:'Wrong'}]) {
  assert.throws(()=>assertPasswordProviderMetadata(host,'com.thingtime.passwords',undefined,{...branding,localizedInfo}),/localization/);
 }
 assert.throws(()=>assertPasswordProviderMetadata(info(),'com.thingtime.passwords',undefined,branding),/display name/);
 assert.throws(()=>assertPasswordProviderMetadata(host,'com.thingtime.passwords',undefined,{...branding,hostName:'Renamed'}),/display name/);
});
