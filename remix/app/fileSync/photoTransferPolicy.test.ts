import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectivePhotoTransferPolicy, parsePhotoTransferPolicy, supportsNativePhotoTransferPolicy } from './photoTransferPolicy';
import { parseMobileFolderResult } from './mobileFolders.client';
test('Photos scopes preserve historical five megabits and choose strictest separate ceilings', () => {
 assert.deepEqual(effectivePhotoTransferPolicy({uploadBytesPerSecond:1_000_000}, {uploadBytesPerSecond:500_000,uploadBytesPerHour:900_000_000}, {uploadBytesPerSecond:625_000,uploadBytesPerHour:1_000_000_000}), {uploadBytesPerSecond:500_000,uploadBytesPerHour:900_000_000});
 assert.deepEqual(parsePhotoTransferPolicy({}), {});
 assert.equal(supportsNativePhotoTransferPolicy({platform:'ios',filePhotoAutomationVersion:'1.6.0'}),true);
 assert.equal(supportsNativePhotoTransferPolicy({platform:'ios',filePhotoAutomationVersion:'1.5.0'}),false);
 for (const value of [undefined,null,[],{uploadBytesPerSecond:0},{uploadBytesPerSecond:0.5},{uploadBytesPerHour:Infinity},{cpuPercent:15}]) assert.throws(() => parsePhotoTransferPolicy(value));
});
test('policy bridge requires exact scope and acknowledged bytes', () => {
 const request = {action:'set-photo-transfer-policy' as const,deviceId:'device',rootId:'photos',photoTransferPolicy:{uploadBytesPerSecond:625000}};
 const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://thingtime.com' };
 const parse = (payload: unknown) => parseMobileFolderResult({type:'mobile-files-result',payload:{...expected,...payload as object}},expected,request);
 const response = {roots:[],deviceId:'device',rootId:'photos',photoTransferPolicy:{uploadBytesPerSecond:625000}};
 assert.deepEqual(parse(response)?.photoTransferPolicy,{uploadBytesPerSecond:625000});
 for (const invalid of [{...response,deviceId:'other'},{...response,rootId:undefined},{...response,photoTransferPolicy:undefined},{...response,photoTransferPolicy:{uploadBytesPerSecond:5_000_000}}]) assert.throws(() => parse(invalid));
});
