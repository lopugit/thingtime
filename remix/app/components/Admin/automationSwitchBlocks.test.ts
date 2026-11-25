import assert from 'node:assert/strict';
import test from 'node:test';
import type { WebpageBlock } from '../Builder/webpageBlocks';
import { AUTOMATION_SWITCHES } from '~/automation/automationSwitches';
import { AUTOMATION_SWITCH_BLOCKS } from './automationSwitchBlocks';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';

const walk = (blocks: WebpageBlock[], visit: (block: WebpageBlock) => void) => {
	for (const block of blocks) { visit(block); walk((block as { children?: WebpageBlock[] }).children ?? [], visit); }
};

test('every Automation block has a unique lowercase-dashed id and every switch has a collapsed section', () => {
	const ids: string[] = [];
	const details: WebpageBlock[] = [];
	walk(AUTOMATION_SWITCH_BLOCKS, (block) => { ids.push(block.id); if ((block as { tag?: string }).tag === 'details') details.push(block); });
	for (const id of ids) assert.match(id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(details.length, AUTOMATION_SWITCHES.length);
	assert.ok(details.every((block) => !(block as { props?: Record<string, unknown> }).props?.open), 'sections start collapsed');
});

test('the Automation layout passes the settings document validator', () => {
	assert.doesNotThrow(() => settingsDocumentBlocks(AUTOMATION_SWITCH_BLOCKS));
});
