import assert from 'node:assert/strict';
import {test} from 'node:test';
import {passwordAutofillOrigins, passwordWebsiteOrigin} from './websites';

test('saved bare websites mean HTTPS, with exact port and subdomain origins', () => {
  for (const [input, expected] of [
    ['thingtime.com', 'https://thingtime.com'],
    ['THINGTIME.com/login?return=home', 'https://thingtime.com'],
    ['thingtime.com:8443/login', 'https://thingtime.com:8443'],
    ['https://thingtime.com:443/@profile', 'https://thingtime.com'],
    ['https://sub.thingtime.com:8443/login', 'https://sub.thingtime.com:8443'],
    ['https://192.0.2.1:8443/path', 'https://192.0.2.1:8443'],
    ['https://internal/path', 'https://internal'],
    ['localhost:9443', 'https://localhost:9443'],
    ['127.0.0.1:9443/path', 'https://127.0.0.1:9443'],
  ]) assert.equal(passwordWebsiteOrigin(input), expected, input);
  assert.deepEqual(passwordAutofillOrigins([
    {type:'url',value:'thingtime.com'}, {type:'url',value:'https://thingtime.com/login'},
    {type:'url',value:'sub.thingtime.com:8443'}, {type:'text',value:'https://foreign.test'},
  ]), ['https://thingtime.com','https://sub.thingtime.com:8443']);
});

test('only approved first-party AWS websites add the exact default-port AWS sign-in origin', () => {
  const fields=(value:string)=>[{type:'url',value}];
  const signin='https://signin.aws.amazon.com';
  for(const host of ['aws.amazon.com','console.aws.amazon.com','portal.aws.amazon.com']){
    assert.deepEqual(passwordAutofillOrigins(fields(`https://${host}/path?private=example`)),[`https://${host}`,signin]);
  }
  for(const unrelated of [signin,'https://aws.amazon.com:8443','https://signin.aws.amazon.com:8443','https://other.aws.amazon.com','https://aws.amazon.com.evil.test','https://fake-aws.amazon.com','https://signin.aws.amazon.com.evil.test','https://example.awsapps.com','https://bucket.amazonaws.com','https://amazon.com','https://github.io']){
    assert.deepEqual(passwordAutofillOrigins(fields(unrelated)),[unrelated]);
  }
  assert.deepEqual(passwordAutofillOrigins(fields('http://aws.amazon.com')),[]);
  assert.deepEqual(passwordAutofillOrigins([{type:'notes',value:'https://aws.amazon.com'}]),[]);
  assert.deepEqual(passwordAutofillOrigins([{type:'url',value:'https://aws.amazon.com',concealed:true},{type:'url',value:'https://example.test',structured:true}]),[]);
});

test('ambiguous, wildcard, credential-bearing and non-HTTPS websites cannot authorize fill', () => {
  for (const input of [null, '', ' thingtime.com', 'thing time.com', '//thingtime.com',
    'thingtime.com\\@evil.test', 'https://user:secret@thingtime.com', 'thingtime.com@evil.test',
    '*.thingtime.com', 'https://*.thingtime.com', 'javascript:alert(1)', 'data:text/html,example.com',
    'https:thingtime.com', 'http://thingtime.com', 'http://localhost:9443', 'ftp://thingtime.com',
    'example..com', '-example.com', 'example-.com', 'internal', '127.1', '0x7f000001',
    'https://thingtime.com:99999',
  ]) assert.equal(passwordWebsiteOrigin(input), null, String(input));
});
