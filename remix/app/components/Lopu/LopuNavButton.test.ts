import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { LOPU_NAV_BUTTON_LABEL } from './LopuNavButton';

// 🦄 The navbar opener's wiring: mounted in Nav's right section right before
// the ⌘K quick switcher (desktop + mobile), toggles the floating window
// through the shared settings hook, hides itself on /lopu*, and carries the
// shared streaming badge. Source-level checks (the lopuDrawerEntry.test.ts
// style) so the contract holds without rendering the app shell in node.

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative: string) => readFileSync(path.join(appDir, relative), 'utf8');

test('Nav mounts the Lopu opener in the right section immediately before the ⌘K quick switcher', () => {
	const source = read('components/Nav/Nav.tsx');
	assert.match(source, /import \{ LopuNavButton \} from '\.\.\/Lopu\/LopuNavButton';/);

	const rightSectionAt = source.indexOf('className="nav-right-section"');
	const buttonAt = source.indexOf('<LopuNavButton />');
	const quickSwitcherAt = source.indexOf('className="nav-quick-switcher-button"');
	assert.notEqual(rightSectionAt, -1);
	assert.notEqual(buttonAt, -1);
	assert.notEqual(quickSwitcherAt, -1);
	assert.ok(buttonAt > rightSectionAt, 'the opener lives inside the right section');
	assert.ok(buttonAt < quickSwitcherAt, 'the opener sits immediately before the ⌘K button');
	// nothing but a comment between the two: no other control slips in between
	const between = source.slice(buttonAt + '<LopuNavButton />'.length, quickSwitcherAt);
	assert.doesNotMatch(between, /<(Center|Box|Flex|Link|Icon)\b[^>]*>[\s\S]*?<\/(Center|Box|Flex|Link|Icon)>/, 'no other control between the opener and ⌘K');
	// not wrapped in a mobile/desktop display gate: visible on both
	const line = source.slice(source.lastIndexOf('\n', buttonAt), source.indexOf('\n', buttonAt));
	assert.doesNotMatch(line, /isMobile/);
});

test('the opener is the same ring as the launcher, toggles the window and hides on /lopu*', () => {
	const source = read('components/Lopu/LopuNavButton.tsx');
	assert.equal(LOPU_NAV_BUTTON_LABEL, 'Talk to Lopu');
	assert.match(source, /<LopuRingAvatar size=\{28\} \/>/);
	assert.match(source, /aria-label=\{open \? 'Hide Lopu' : LOPU_NAV_BUTTON_LABEL\}/);
	assert.match(source, /toggleOpen\(\)/);
	assert.match(source, /if \(isLopuHostHiddenOnPath\(pathname\)\) \{\s*return null;/);
	assert.match(source, /<LopuActivityBadge placement="corner"/);
	// tokens only — no hard-coded colours
	assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i);
	// keyboard users can see where they are
	assert.match(source, /_focusVisible=/);
});

test('the floating window can open from the navbar even with the launcher bubble turned off', () => {
	const source = read('components/Lopu/LopuHost.tsx');
	// the launcher setting hides the bubble only; the window follows `open`
	assert.match(source, /const showLauncher = !hiddenOnPath && settings\.launcher/);
	assert.match(source, /const showWindow = !hiddenOnPath && open/);
	assert.doesNotMatch(source, /isLopuHostHiddenOnPath\(pathname\) \|\| !settings\.launcher/);
});
