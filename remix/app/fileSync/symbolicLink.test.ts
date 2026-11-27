import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbolicLink, symbolicLinkBytes, symbolicLinkFingerprint } from './symbolicLink';
import { validSyncEntry, sameSyncContent } from './reconcile';
import { cloudFileSyncEntry, parseCloudFileCommit, parseCloudFile } from './cloudFile';
import { fileRestoreCommand, parseFileRestoreCommand, fileContentId } from './fileVersions';
import { assertNativeSymbolicLinkRequest } from './mobileFolders.client';
const link = { format: 'posix-symlink-v1' as const, targetBase64: 'Li4=' };
test('POSIX targets preserve inert absolute, escaping, dangling and non-UTF8 bytes with canonical framing', async () => {
 for (const bytes of [Buffer.from('../outside'), Buffer.from('/absent'), Buffer.from([255,254,47,120])]) {
  const metadata = { ...link, targetBase64: bytes.toString('base64') }; assert.deepEqual(Buffer.from(symbolicLinkBytes(parseSymbolicLink(metadata))), bytes);
  const entry = { path:'link',id:'id',version:'v',kind:'file' as const,size:bytes.length,sha256:null,fingerprint:await symbolicLinkFingerprint(metadata),symbolicLink:metadata };
  assert.equal(validSyncEntry(entry),true); assert.equal(sameSyncContent(entry,{...entry,symbolicLink:undefined}),false);
  assert.equal(validSyncEntry({...entry,kind:'folder',size:0,sha256:null,fingerprint:undefined}),false);
 }
 for(const bad of [null, { ...link,targetBase64:'' },{...link,targetBase64:'AA=='},{...link,targetBase64:'Lh=='},{...link,targetBase64:'Li4=\n'},{...link, extra:true}]) assert.throws(()=>parseSymbolicLink(bad));
});
test('cloud versions and guarded historical restore preserve link kind and target metadata', async () => {
 const fingerprint=await symbolicLinkFingerprint(link), content={attachmentId:'attachment',version:'a'.repeat(64),size:2,fingerprint};
 const version=parseCloudFile({id:'00000000-0000-4000-8000-000000000001',revision:'old',name:'link',folderId:null,trashed:false,content,symbolicLink:link});
 assert.deepEqual(cloudFileSyncEntry(version,'link').symbolicLink,link);
 const ordinary={...version,revision:'new',symbolicLink:undefined};assert.notEqual(fileContentId(version),fileContentId(ordinary));
 const command=fileRestoreCommand(ordinary,version,'00000000-0000-4000-8000-000000000002');assert.deepEqual(command.symbolicLink,link);assert.deepEqual(parseCloudFileCommit(command),command);
 assert.throws(()=>parseFileRestoreCommand({...command,symbolicLink:undefined},version));
 assert.throws(()=>parseCloudFile({...version,content:{...content,size:3}}));
});
test('older native hosts cannot silently turn tagged link restores into ordinary target-text files', () => {
 const request={action:'stage-begin',rootId:'root',transfer:{operation:{mutation:{source:{symbolicLink:link}}}}} as any;
 assert.throws(()=>assertNativeSymbolicLinkRequest(request,{platform:'macos',fileAccessVersion:'1.16.0'}),/preserve symbolic links/);
 assert.doesNotThrow(()=>assertNativeSymbolicLinkRequest(request,{platform:'macos',fileAccessVersion:'1.17.0',fileSymbolicLinksVersion:'1.0.0'}));
});
