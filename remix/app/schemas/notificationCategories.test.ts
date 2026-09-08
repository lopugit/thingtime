import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMAIL_DEFAULT_OFF_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_CATEGORY,
  isNotificationCategory,
  isNotificationType,
  normalizeNotificationPrefs,
  notificationCategoryOf,
  notificationTypesInCategory
} from './registry';

test('every notification type belongs to exactly one known category', () => {
  for (const type of NOTIFICATION_TYPES) {
    const category = NOTIFICATION_TYPE_CATEGORY[type];
    assert.ok(isNotificationCategory(category), `${type} needs a category`);
    assert.equal(notificationCategoryOf(type), category);
  }
  const partitioned = NOTIFICATION_CATEGORIES.flatMap((category) => notificationTypesInCategory(category)).sort();
  assert.deepEqual(partitioned, [...NOTIFICATION_TYPES].sort());
  for (const category of NOTIFICATION_CATEGORIES) {
    assert.ok(NOTIFICATION_CATEGORY_META[category].label.trim(), `${category} needs a label`);
  }
});

test('unknown types read as social, unknown categories are rejected', () => {
  assert.equal(notificationCategoryOf('not-a-type'), 'social');
  assert.equal(notificationCategoryOf(undefined), 'social');
  assert.equal(isNotificationType('action-run'), true);
  assert.equal(isNotificationType('ACTION-RUN'), false);
  assert.equal(isNotificationCategory('system'), true);
  assert.equal(isNotificationCategory('all'), false);
});

test('action-run is the system family: bell on by default, email opt-in', () => {
  assert.equal(NOTIFICATION_TYPE_CATEGORY['action-run'], 'system');
  assert.deepEqual(notificationTypesInCategory('system'), ['action-run']);
  assert.ok(EMAIL_DEFAULT_OFF_TYPES.includes('action-run'));
  const prefs = normalizeNotificationPrefs(null);
  assert.equal(prefs.push['action-run'], true);
  assert.equal(prefs.email['action-run'], false);
  assert.equal(normalizeNotificationPrefs({ email: { 'action-run': true } }).email['action-run'], true);
});
