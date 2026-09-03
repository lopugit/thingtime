import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_PREVIEW_COMMENT_MARKER,
  adminPreviewCommentBody,
  adminPreviewPersistentHostname,
  adminPreviewSnapshotUrl,
  isOwnedAdminPreviewComment
} from './adminPreviewPublicationCore';

test('persistent preview hosts stay separated by selected environment', () => {
  const suffixes = { develop: 'previews.dev.thingtime.com', production: 'previews.thingtime.com' };
  assert.equal(adminPreviewPersistentHostname(505, 'develop', suffixes), 'pr-505.previews.dev.thingtime.com');
  assert.equal(adminPreviewPersistentHostname(505, 'production', suffixes), 'pr-505.previews.thingtime.com');
  assert.throws(() => adminPreviewPersistentHostname(505, 'production', { ...suffixes, production: 'thingtime.com/path' }));
});

test('snapshot URLs accept only immutable Vercel HTTPS hosts', () => {
  assert.equal(adminPreviewSnapshotUrl('thingtime-abc.vercel.app'), 'https://thingtime-abc.vercel.app/');
  assert.equal(adminPreviewSnapshotUrl('https://thingtime-abc.vercel.app'), 'https://thingtime-abc.vercel.app/');
  assert.equal(adminPreviewSnapshotUrl('https://thingtime.com'), null);
  assert.equal(adminPreviewSnapshotUrl('https://user:secret@thingtime-abc.vercel.app'), null);
});

test('one PR comment renders snapshot and persistent links for every selected environment', () => {
  const body = adminPreviewCommentBody({
    prNumber: 505,
    sha: 'a'.repeat(40),
    rows: [
      {
        environment: 'production',
        status: 'building',
        snapshotUrl: 'https://thingtime-production.vercel.app/',
        persistentUrl: 'https://pr-505.previews.thingtime.com/',
        expectedReadyAt: '2026-09-03T03:15:00.000Z'
      },
      {
        environment: 'develop',
        status: 'ready',
        snapshotUrl: 'https://thingtime-develop.vercel.app/',
        persistentUrl: 'https://pr-505.previews.dev.thingtime.com/'
      }
    ]
  });
  assert.match(body, new RegExp(ADMIN_PREVIEW_COMMENT_MARKER));
  assert.match(body, /Develop \| ✅ Ready \| Ready now \| \[Open snapshot\]\(https:\/\/thingtime-develop\.vercel\.app\/\)/);
  assert.match(body, /Production \/ main \| 🟡 Building \| 2026-09-03 03:15 UTC \| \[Open snapshot\]\(https:\/\/thingtime-production\.vercel\.app\/\)/);
  assert.match(body, /https:\/\/pr-505\.previews\.dev\.thingtime\.com\//);
  assert.match(body, /https:\/\/pr-505\.previews\.thingtime\.com\//);
  assert.ok(body.indexOf('| Develop |') < body.indexOf('| Production / main |'));
});

test('queued comments publish the expected persistent URL before Vercel returns a snapshot', () => {
  const body = adminPreviewCommentBody({
    prNumber: 505,
    sha: 'b'.repeat(40),
    rows: [
      {
        environment: 'develop',
        status: 'queued',
        snapshotUrl: null,
        persistentUrl: 'https://pr-505.previews.dev.thingtime.com/',
        expectedReadyAt: '2026-09-03T03:20:00.000Z'
      }
    ]
  });
  assert.match(body, /Develop \| 🟡 Queued \| 2026-09-03 03:20 UTC \| Waiting for Vercel/);
  assert.match(body, /\[Open persistent preview\]\(https:\/\/pr-505\.previews\.dev\.thingtime\.com\/\)/);
  assert.match(body, /Expected-ready times are estimates/);
});

test('only the configured GitHub App can own the marker comment', () => {
  assert.equal(
    isOwnedAdminPreviewComment(
      { body: ADMIN_PREVIEW_COMMENT_MARKER, performed_via_github_app: { id: 42 } },
      42
    ),
    true
  );
  assert.equal(
    isOwnedAdminPreviewComment(
      { body: ADMIN_PREVIEW_COMMENT_MARKER, performed_via_github_app: { id: 99 } },
      42
    ),
    false
  );
  assert.equal(isOwnedAdminPreviewComment({ body: ADMIN_PREVIEW_COMMENT_MARKER, user: { type: 'Bot' } }, 42), false);
});
