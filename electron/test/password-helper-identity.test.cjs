const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const load = () => import('../scripts/password-helper-identity.mjs');

test('development helper identity is explicit, private and separated from production and other hosts', async () => {
  const { isolatedPasswordIdentity: identity, passwordHelperOptions } = await load();
  const first = identity('com.thingtime.passwords.dev.one', 'AB12345678'), second = identity('com.thingtime.passwords.dev.two', 'AB12345678');
  for (const [host, team] of [['com.thingtime.passwords','AB12345678'], ['bad/path','AB12345678'], ['com.fork.dev','']]) assert.throws(() => identity(host, team));
  assert.equal(first.keychainGroup, 'AB12345678.com.thingtime.passwords.dev.one');
  assert.equal(first.notificationName, first.hostIdentifier + '.destination-changed');
  assert.notEqual(first.urlScheme, 'otpauth'); assert.notEqual(first.urlScheme, second.urlScheme);
  assert.notEqual(first.notificationName, second.notificationName);
  assert.throws(() => passwordHelperOptions(['--password-helper-app=/task/Thingtime Passwords.app']));
  assert.throws(() => passwordHelperOptions(['--password-helper-app=relative','--password-helper-host=com.fork.dev','--password-helper-team=AB12345678']));
  assert.equal(passwordHelperOptions([]), undefined);
  assert.ok(Object.isFrozen(first));
});

test('signed private helper metadata refuses production groups, global schemes, seed exposure and extra entitlements', async () => {
  const { isolatedPasswordIdentity, assertIsolatedPasswordMetadata: metadata, assertIsolatedPasswordEntitlements: signed } = await load();
  const identity = isolatedPasswordIdentity('com.thingtime.passwords.dev.one', 'AB12345678');
  const info = { CFBundleIdentifier: identity.hostIdentifier, ThingtimePasswordKeychainGroup: identity.keychainGroup,
    ThingtimePasswordNotificationName: identity.notificationName, ThingtimePasswordDevelopmentHost: identity.hostIdentifier,
    CFBundleURLTypes: [{ CFBundleURLSchemes: [identity.urlScheme] }] };
  metadata(info, identity);
  assert.throws(() => metadata(info, { ...identity, hostIdentifier: 'com.thingtime.passwords' }));
  assert.throws(() => metadata(info, { ...identity, keychainGroup: 'AB12345678.com.thingtime.passwords' }));
  for (const changed of [{ ThingtimePasswordKeychainGroup: 'AB12345678.com.thingtime.passwords' },
    { ThingtimePasswordNotificationName: 'com.thingtime.passwords.destination-changed' }, { ThingtimePasswordDevelopmentFixture: true },
    { CFBundleURLTypes: [{ CFBundleURLSchemes: ['otpauth'] }] }]) assert.throws(() => metadata({ ...info, ...changed }, identity));
  const entitlements = { 'com.apple.developer.team-identifier': identity.teamIdentifier,
    'com.apple.application-identifier': `${identity.teamIdentifier}.${identity.hostIdentifier}`,
    'com.apple.security.app-sandbox': true, 'keychain-access-groups': [identity.keychainGroup] };
  signed(entitlements, identity, identity.hostIdentifier);
  for (const changed of [{ 'keychain-access-groups': [identity.keychainGroup,'AB12345678.com.thingtime.passwords'] },
    { 'com.apple.security.application-groups': ['group.com.thingtime'] }, { 'com.apple.application-identifier': 'AB12345678.com.thingtime.passwords' }])
    assert.throws(() => signed({ ...entitlements, ...changed }, identity, identity.hostIdentifier));
});

test('actual Swift notification derivation preserves production and isolates dev/nil identities', { skip: process.platform !== 'darwin' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'tt-password-notice-'));
  try {
    const main = path.join(dir,'Check.swift');
    await fs.writeFile(main, 'import Foundation\n@main enum Check { static func main() { for id: String? in ["com.thingtime.passwords", "com.thingtime.passwords.dev.one", nil] { print(PasswordHostIdentity.destinationChanged(for:id).rawValue) } } }');
    const binary = path.join(dir,'check');
    const compiled = spawnSync('swiftc', [path.join(__dirname,'../../macos/ThingtimePasswords/PasswordHostIdentity.swift'), main, '-o', binary], { encoding:'utf8' });
    assert.equal(compiled.status,0,compiled.stderr);
    const result = spawnSync(binary,[],{encoding:'utf8'});
    assert.equal(result.status,0); assert.deepEqual(result.stdout.trim().split('\n'), ['com.thingtime.passwords.destination-changed','com.thingtime.passwords.dev.one.destination-changed','thingtime.invalid-host.destination-changed']);
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});

test('uncertain seed cleanup requires exact ownership and preserves unrelated same-origin authority', async () => {
  const { provePasswordRetirementProtocol: prove } = await import('../scripts/verify-isolated-password-helper.mjs');
  for (const competing of ['same-origin-other-owner', 'same-owner-different-connection', 'unavailable']) {
    let retirements = 0;
    assert.throws(() => prove({ assertEmpty() {}, seed() { throw Error('seed refused or receipt lost'); },
      exactState() { if (competing === 'unavailable') throw Error('locked'); return { empty:false, matches:false }; },
      status: () => 'connected', retire() { retirements++; } }), /ownership unverified|ownership unavailable/);
    assert.equal(retirements, 0, competing);
  }
  let state = 'empty', retirements = 0;
  assert.throws(() => prove({ assertEmpty() { assert.equal(state,'empty'); },
    seed() { state='this-run'; throw Error('receipt lost after commit'); }, exactState: () => ({empty:state==='empty',matches:state==='this-run'}),
    status: () => 'connected', retire() { retirements++; state='empty'; } }), /receipt lost after commit/);
  assert.equal(retirements,1); assert.equal(state,'empty');
});

test('fixture profile permits macOS exact or team-wide authorization while actual grants stay private', async () => {
  const { isolatedPasswordIdentity, assertIsolatedFixtureProfile: profile } = await load();
  const identity = isolatedPasswordIdentity('com.thingtime.passwords.dev.one','AB12345678');
  const current = { ExpirationDate: new Date(Date.now()+60000).toISOString(),TeamIdentifier:[identity.teamIdentifier],Platform:['OSX'],
    Entitlements:{'com.apple.application-identifier':`${identity.teamIdentifier}.${identity.fixtureIdentifier}`,'keychain-access-groups':[identity.keychainGroup]} };
  profile(current,identity); profile({...current,Entitlements:{'com.apple.application-identifier':'AB12345678.*','keychain-access-groups':['AB12345678.*']}},identity);
  for(const bad of [{ExpirationDate:'invalid'}, {ExpirationDate:'2000-01-01T00:00:00Z'}, {TeamIdentifier:['OTHERTEAM1']}, {Platform:['iOS']},
    {Entitlements:{'com.apple.application-identifier':'OTHERTEAM1.*','keychain-access-groups':['AB12345678.*']}},
    {Entitlements:{'com.apple.application-identifier':'AB12345678.com.thingtime.*','keychain-access-groups':['AB12345678.*']}},
    {Entitlements:{...current.Entitlements,'keychain-access-groups':['OTHERTEAM1.*']}},
    {Entitlements:{...current.Entitlements,'keychain-access-groups':['AB12345678.com.thingtime.*']}}]) assert.throws(()=>profile({...current,...bad},identity));
});

test('proof CLI executes from a path containing spaces and fails closed without selected authority', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'tt-password proof '));
  try {
    for (const file of ['verify-isolated-password-helper.mjs','verify-password-provider.mjs','password-helper-identity.mjs'])
      await fs.copyFile(path.join(__dirname,'../scripts',file),path.join(dir,file));
    const result = spawnSync(process.execPath,[path.join(dir,'verify-isolated-password-helper.mjs')],{encoding:'utf8',timeout:10000});
    assert.notEqual(result.status,0,'A path with spaces must not silently skip the CLI entry point');
    assert.match(result.stderr,/Select an isolated helper and separate fixture app/);
    assert.equal(result.stdout,'');
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
