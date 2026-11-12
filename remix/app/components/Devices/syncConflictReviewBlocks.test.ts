import assert from 'node:assert/strict';
import test from 'node:test';
import { syncConflictReviewBlocks, syncConflictReviewDisplay } from './syncConflictReviewBlocks';
import { resolveBlockProps } from '../Builder/templateBlocks';
import { findBlock } from '../Builder/webpageBlocks';
import { parseTransientBinding } from '../Builder/transientBlockActions';
import { settingsDocumentBlocks } from '../Settings/settingsDocument';
import type { ConflictReviewView } from '~/fileSync/conflictReviewController';

test('editable choice bindings preserve numeric revisions and contain no runtime paths', () => {
 const document = settingsDocumentBlocks(syncConflictReviewBlocks);
 for(const id of ['review-choice','review-history']) {
  const props = resolveBlockProps(findBlock(document,id)!.props!, {review:{busy:false},item:{path:'private/sample.txt',revision:7,choice:'remote'}});
  const binding = parseTransientBinding(JSON.stringify(props['data-tt-action-inputs']));
  assert.equal(binding?.inputs.revision,7);assert.equal(binding.inputs.path,'private/sample.txt');
 }
 assert.ok(!JSON.stringify(document).includes('private/sample.txt'));
 assert.equal(findBlock(document,'review-retention')?.css?.color,'var(--tt-muted, #71717a)');
});

test('an interrupted page retains its display but cannot authorize apply or ignore',()=>{
 const view: ConflictReviewView = {busy:false,closed:false,error:'Read failed',page:{rows:[],next:null,previous:null,start:20,
  progress:{phase:'reviewing',read:22,total:22,count:22,selected:22,blocked:0,retentionBlocked:0,revision:9}}};
 const display=syncConflictReviewDisplay(view,'two-way').review;
 assert.equal(display.resolveDisabled,true);assert.equal(display.retainDisabled,true);assert.equal(display.hasError,true);
 const loaded=syncConflictReviewDisplay({...view,error:null},'two-way').review;
 assert.equal(loaded.resolveDisabled,false);assert.equal(loaded.retainDisabled,false);
 assert.match(loaded.retentionMessage,/After saving/);
 const blocked=syncConflictReviewDisplay({...view,error:null,page:{...view.page!,progress:{...view.page!.progress,blocked:1,retentionBlocked:1}}},'two-way').review;
 assert.equal(blocked.resolveDisabled,true);assert.equal(blocked.retainDisabled,true);
});
