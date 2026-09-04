import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_TABS, adminTabIndex, adminTabPath } from './adminRoutesCore';

test('every Admin tab has a stable unique subroute', () => {
  assert.deepEqual(
    ADMIN_TABS.map((tab) => tab.slug),
    ['users', 'apps', 'moderation', 'tiers', 'ci-control', 'external-integrations', 'system']
  );
  assert.equal(new Set(ADMIN_TABS.map((tab) => tab.slug)).size, ADMIN_TABS.length);
  ADMIN_TABS.forEach((tab, index) => {
    assert.equal(adminTabIndex(tab.slug), index);
    assert.equal(adminTabPath(index), `/admin/${tab.slug}`);
  });
});

test('/admin remains the Users default and unknown tabs fail closed', () => {
  assert.equal(adminTabIndex(undefined), 0);
  assert.equal(adminTabIndex(''), 0);
  assert.equal(adminTabIndex('not-a-real-admin-tab'), null);
  assert.equal(adminTabPath(999), '/admin/users');
});
