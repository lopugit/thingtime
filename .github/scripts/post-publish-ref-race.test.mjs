import test from 'node:test';
import assert from 'node:assert/strict';
import { postPublishRefRace } from './post-publish-ref-race.mjs';
const snapshot = {repository:'owner/repo',number:592,headRef:'feature',baseRef:'develop',publishedSha:'a'.repeat(40),baseSha:'b'.repeat(40),liveBaseSha:'c'.repeat(40)};
const current = () => ({state:'open',number:592,head:{repo:{full_name:'owner/repo'},ref:'feature',sha:snapshot.publishedSha},base:{repo:{full_name:'owner/repo'},ref:'develop',sha:'c'.repeat(40)},labels:[]});
test('a new base after publication re-enters the bounded normal detector', () => {
  assert.equal(postPublishRefRace(current(), snapshot), true);
  assert.equal(postPublishRefRace(current(), {...snapshot,liveBaseSha:snapshot.baseSha}), false);
  assert.equal(postPublishRefRace(current(), {...snapshot,liveBaseSha:null}), false);
  const cached = current(); cached.base.sha = snapshot.baseSha;
  assert.equal(postPublishRefRace(cached, snapshot), true);
});
test('closed, retargeted, human-updated, foreign, unknown and paused PRs do not requeue', () => {
  for (const mutate of [p=>p.state='closed',p=>p.number=1,p=>p.base.ref='main',p=>p.head.sha='d'.repeat(40),p=>p.head.repo.full_name='fork/repo',
    ...['ai-merge-paused','no-ai-merge','ai-rebase-in-progress','ai-rebase-paused'].map(name=>p=>p.labels=[{name}])]) {
    const pr=current(); mutate(pr); assert.equal(postPublishRefRace(pr,snapshot),false);
  }
});
