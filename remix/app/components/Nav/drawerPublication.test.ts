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

test('a top-level section keeps its own auth rules under the publication filter', () => {
	const ids = (items: { id: string }[]) => items.map((item) => item.id);
	// both call sites moved from filterDrawerItemsByAuth to filterDrawerTopItems,
	// so the section's own authOnly/guestOnly/adminOnly must survive the move
	const adminSection = { ...drawerMenuItems[0], id: 'admin-only-section', adminOnly: true };
	const guestSection = { ...drawerMenuItems[0], id: 'guest-only-section', guestOnly: true };
	const authSection = { ...drawerMenuItems[0], id: 'auth-only-section', authOnly: true };
	const items = [adminSection, guestSection, authSection];
	assert.deepEqual(ids(filterDrawerTopItems(items, false, false, nothing)), ['guest-only-section']);
	assert.deepEqual(ids(filterDrawerTopItems(items, true, false, nothing)), ['auth-only-section']);
	assert.deepEqual(ids(filterDrawerTopItems(items, true, true, nothing)), ['admin-only-section', 'auth-only-section']);
});

// UserSettingsModal's "Close after click" list mirrors the drawer, so it must
// use the SAME pair of filters. Gating a top-level section on its own key
// (filterDrawerItemsByAuth over drawerMenuItems) would hide Marketing from the
// settings list while DrawerContent still renders it.
test('a section is listed by its children, not by its own key', () => {
	const ids = (items: { id: string }[]) => items.map((item) => item.id);
	// a published category with an unpublished hub: the section IS reachable,
	// so both the drawer and the settings mirror must list it
	const live = only('category:landing');
	assert.ok(ids(filterDrawerTopItems(drawerMenuItems, false, false, live)).includes('marketing'));
	// filtering the top level on its own key would drop it — the two helpers
	// genuinely disagree here, which is why both call sites use the same one
	assert.ok(!ids(filterDrawerItemsByAuth(drawerMenuItems, false, false, live)).includes('marketing'));
	// and they agree once the hub itself is published
	assert.ok(ids(filterDrawerItemsByAuth(drawerMenuItems, false, false, only('hub'))).includes('marketing'));
});
