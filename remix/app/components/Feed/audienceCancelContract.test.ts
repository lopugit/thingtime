import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// Cancelling the custom-audience picker 🎭 must never WIDEN the circle.
//
// PostComposer sets `visibility` to 'custom' the instant the Select changes,
// because that is what opens the picker. So the picker's onClose owns the
// undo, and its fallback used to be the literal 'public':
//
//   if (!audienceAppliedRef.current) setVisibility(c => c === 'custom' ? 'public' : c)
//
// For a NEW post that is right — 'public' is the composer's own seed. For an
// EDIT it silently published: open the editor on a 🔒 Private post, pick 🎭
// Custom, then cancel (button, Esc or overlay — Chakra routes all three to
// onClose), and the composer comes back reading 🌐 Public. The next Save
// hands a previously private post to everyone. Same for 👥 Friends, 👨‍👩‍👧 Family
// and 🕵️ Hidden.
//
// PostCard's equivalent path is already correct — it opens the picker WITHOUT
// touching post.visibility and only commits after the PATCH returns — so the
// composer's fallback was the odd one out rather than a deliberate product
// choice.
//
// tsc cannot see any of this: 'public' is a perfectly good PostVisibility.
// Pin it as source text, beside the onChanged and hidden-link contracts.

const feedDir = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(resolve(feedDir, ...segments), 'utf8');

test('abandoning the picker restores the previous circle instead of falling through to public', () => {
  const composer = read('PostComposer.tsx');
  const fallback = composer.match(/if \(!audienceAppliedRef\.current\)[\s\S]*?setVisibility\([\s\S]*?\);/);
  assert.ok(fallback, 'PostComposer must still undo the speculative "custom" when the picker is abandoned');

  assert.match(
    fallback[0],
    /audiencePreviousVisibilityRef\.current/,
    'the undo must restore the circle in effect before the picker opened'
  );
  assert.doesNotMatch(
    fallback[0],
    /'public'/,
    "falling back to a fixed 'public' publishes a private post the user only ever opened the picker on"
  );
});

test('the Select captures the circle it is leaving before switching to custom', () => {
  const composer = read('PostComposer.tsx');
  const handler = composer.match(/const next = event\.target\.value as PostVisibility;[\s\S]*?setVisibility\(next\);/);
  assert.ok(handler, 'the visibility Select must still route "custom" into the picker');

  const capture = handler[0].indexOf('audiencePreviousVisibilityRef.current = visibility');
  assert.ok(capture >= 0, 'switching to custom must remember the circle being left');
  assert.ok(
    capture < handler[0].indexOf('setVisibility(next)'),
    'the capture must read `visibility` BEFORE setVisibility(next) — afterwards this render still holds the old value, but the intent stops being legible'
  );
});

test('the fallback ref is seeded from the edited post, so only new posts default to public', () => {
  const composer = read('PostComposer.tsx');
  assert.match(
    composer,
    /const audiencePreviousVisibilityRef = React\.useRef<PostVisibility>\(editPost\?\.visibility \|\| 'public'\)/,
    'seed the undo target exactly like the `visibility` state itself — an edit falls back to what the post was'
  );
  assert.match(
    composer,
    /const \[visibility, setVisibility\] = React\.useState<PostVisibility>\(editPost\?\.visibility \|\| 'public'\)/,
    'if the visibility seed ever changes, the undo seed beside it has to change with it'
  );
});

test('PostCard opens the picker without committing a circle change', () => {
  const postCard = read('PostCard.tsx');
  const branch = postCard.match(/if \(next === 'custom'\) \{[\s\S]*?\}/);
  assert.ok(branch, 'PostCard must still route the custom circle through the picker');
  assert.match(branch[0], /setAudienceOpen\(true\);[\s\S]*?return;/, 'it opens the picker and returns');
  assert.doesNotMatch(
    branch[0],
    /onChanged|api\.v1\.things\.update/,
    'the card must not optimistically flip the post to custom before the audience exists — that is what makes its own cancel path safe'
  );
});
