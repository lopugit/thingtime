import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUserVaultGroup, normalizeUserVaultSecret, normalizeUserVaultProvider, normalizeLopuProviderEndpointSyntax, validUserVaultValue } from './userVaultModel';
import { normalizeLopuProviderEndpoint } from './userVaultCore';
test('shared vault fields normalize metadata while preserving secret whitespace and Unicode',()=>{
 assert.deepEqual(normalizeUserVaultGroup({name:'  Work  '}),{name:'Work'});
 assert.deepEqual(normalizeUserVaultSecret({name:' Key ',key:' TOKEN ',value:' \n🦄 secret\n ',groupId:''}),{name:'Key',key:'TOKEN',value:' \n🦄 secret\n ',groupId:null});
 assert.equal(validUserVaultValue('🦄'.repeat(8192))?.length,16384);assert.equal(validUserVaultValue('🦄'.repeat(8193)),null);assert.equal(validUserVaultValue(''),null);
 assert.throws(()=>normalizeUserVaultGroup({name:'x'.repeat(81)}));assert.throws(()=>normalizeUserVaultSecret({name:'Key',key:'TOKEN',value:'ok',groupId:{id:'foreign'}}));
});
test('provider metadata validation never treats a malformed supplied token as keep-existing',()=>{
 const provider={name:' Provider ',provider:'openai',endpoint:'https://api.openai.com/v1/',model:' custom/model '};
 assert.deepEqual(normalizeUserVaultProvider({...provider,token:''}),{name:'Provider',provider:'openai',endpoint:'https://api.openai.com/v1',model:'custom/model',token:null,groupId:null});
 for(const token of [42,{},[],false,'x'.repeat(32769)])assert.throws(()=>normalizeUserVaultProvider({...provider,token}),/token/);
 assert.throws(()=>normalizeUserVaultProvider({...provider,token:'ok',model:'invalid model'}),/Model id/);
});
test('syntax validation is data authoring only; server network restrictions remain mandatory',()=>{
 const local='https://127.0.0.1/v1';assert.equal(normalizeLopuProviderEndpointSyntax(local),local);assert.equal(normalizeLopuProviderEndpoint(local),null);
 assert.throws(()=>normalizeUserVaultProvider({name:'Local',provider:'compatible',endpoint:local,token:'synthetic'},normalizeLopuProviderEndpoint),/HTTPS endpoint/);
 for(const endpoint of ['http://example.com','https://name:secret@example.com','https://example.com?token=secret','https://example.com#fragment'])assert.equal(normalizeLopuProviderEndpointSyntax(endpoint),null);
});
