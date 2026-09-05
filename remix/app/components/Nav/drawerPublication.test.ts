import assert from 'node:assert/strict';
import test from 'node:test';

import { drawerMenuItems, filterDrawerItemsByAuth, filterDrawerTopItems } from './Drawer/drawerMenu';

// The Marketing drawer section is gated by marketing publishing
// (marketing/publishingCore.ts): admins always see it, visitors only once
// something under it is published, and every child names its own key.

const marketing = drawerMenuItems.find((item) => item.id === 'marketing')!;
const nothing = () => false;
const only = (...keys: string[]) => (key: string) => keys.includes(key);

test('every marketing drawer entry names a publication key', () => {
	assert.equal(marketing.publication, 'hub');
	for (const child of marketing.children) assert.ok(child.publication, child.id);
	assert.deepEqual(
		marketing.children.map((child) => child.publication),
		['hub', 'social', 'category:landing', 'category:guides', 'category:walkthroughs', 'category:compare', 'category:for']
	);
	// every other section stays ungated
	for (const item of drawerMenuItems) if (item.id !== 'marketing') assert.equal(item.publication, undefined, item.id);
});

test('visitors see no marketing entries until something is published; admins always do', () => {
	assert.deepEqual(filterDrawerItemsByAuth(marketing.children, false, false, nothing), []);
	assert.deepEqual(filterDrawerItemsByAuth(marketing.children, true, false), [], 'unknown state fails closed');
	assert.equal(filterDrawerItemsByAuth(marketing.children, false, true, nothing).length, marketing.children.length);
	assert.deepEqual(
		filterDrawerItemsByAuth(marketing.children, false, false, only('category:compare', 'social')).map((child) => child.id),
		['marketing-social', 'marketing-compare']
	);
});

test('the marketing section itself follows its children for visitors', () => {
	const ids = (items: typeof drawerMenuItems) => items.map((item) => item.id);
	assert.ok(!ids(filterDrawerTopItems(drawerMenuItems, false, false, nothing)).includes('marketing'));
	assert.ok(!ids(filterDrawerTopItems(drawerMenuItems, true, false)).includes('marketing'));
	assert.ok(ids(filterDrawerTopItems(drawerMenuItems, false, true, nothing)).includes('marketing'), 'admins keep the section');
	assert.ok(ids(filterDrawerTopItems(drawerMenuItems, false, false, only('category:landing'))).includes('marketing'), 'one published child is enough');
	// nothing else is ever dropped by the publication filter
	assert.equal(filterDrawerTopItems(drawerMenuItems, false, false, nothing).length, drawerMenuItems.length - 1);
	// the auth-only rules still apply unchanged
	const messages = drawerMenuItems.find((item) => item.id === 'messages')!;
	assert.deepEqual(filterDrawerItemsByAuth(messages.children, false, false, nothing), []);
});
