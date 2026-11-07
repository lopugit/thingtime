import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { parseBackupWorkspaceCommand } from './backupWorkspace.server';
test('workspace admits only fixed scalar selectors and reviewed certificate identities',()=>{
 const requestId=randomUUID(),snapshotId=randomUUID(),reviewId=randomUUID();
 const review={action:'review',requestId,selection:{snapshotId,sourceRootId:'saved-root',destination:{id:'folder',revision:'head'}}};
 assert.deepEqual(parseBackupWorkspaceCommand(review),review);
 for(const destination of [{id:'folder',revision:'head',path:'/tmp/private'},{id:'folder',revision:'head',name:'caller authority'},{id:'folder',revision:'../head'}])assert.throws(()=>parseBackupWorkspaceCommand({...review,selection:{...review.selection,destination}}));
 assert.throws(()=>parseBackupWorkspaceCommand({action:'snapshot',requestId,destinationId:'https://arbitrary.invalid'}));
 assert.throws(()=>parseBackupWorkspaceCommand({action:'snapshot',requestId,destinationId:'registered',secret:'not-a-contract'}));
 assert.deepEqual(parseBackupWorkspaceCommand({action:'restore',requestId,reviewId,reviewHash:'a'.repeat(64)}),{action:'restore',requestId,reviewId,reviewHash:'a'.repeat(64)});
 assert.throws(()=>parseBackupWorkspaceCommand({action:'restore',requestId,reviewId,reviewHash:'a'.repeat(64),intents:[]}));
 assert.throws(()=>parseBackupWorkspaceCommand({action:'restore',requestId,reviewId,reviewHash:'bad'}));
});
