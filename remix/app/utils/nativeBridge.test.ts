import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsNativeLopuVoice, supportsNativeVoiceHistory, type ThingtimeNativeBridge } from './nativeBridge';

const bridge: ThingtimeNativeBridge = { version: '1.1.0', platform: 'ios', isNativeWebView: true, postMessage: () => {} };
test('durable native direct voice and history require bridge 1.3 or newer', () => {
  for (const version of ['1.3.0', '1.4.0', '1.3.1']) assert.equal(supportsNativeVoiceHistory({ ...bridge, lopuVoiceVersion: version }), true);
  for (const version of ['1.2.9', '1.0.0', '2.0.0', '1.3.0-beta', '']) assert.equal(supportsNativeVoiceHistory({ ...bridge, lopuVoiceVersion: version }), false);
});
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
