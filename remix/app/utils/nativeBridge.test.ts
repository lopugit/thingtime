import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsNativeLopuVoice, type ThingtimeNativeBridge } from './nativeBridge';

const bridge: ThingtimeNativeBridge = { version: '1.1.0', platform: 'ios', isNativeWebView: true, postMessage: () => {} };
test('build 25 general bridge must not claim that native voice exists', () => {
  assert.equal(supportsNativeLopuVoice(bridge), false);
  assert.equal(supportsNativeLopuVoice(undefined), false);
});
test('native voice negotiates its own compatible version independently of the shell', () => {
  assert.equal(supportsNativeLopuVoice({ ...bridge, lopuVoiceVersion: '1.0.0' }), true);
  assert.equal(supportsNativeLopuVoice({ ...bridge, lopuVoiceVersion: '1.2.3' }), true);
  for (const version of ['2.0.0', '0.9.0', '1', '1.0', '1.0.0-beta', '']) {
    assert.equal(supportsNativeLopuVoice({ ...bridge, lopuVoiceVersion: version }), false);
  }
});
