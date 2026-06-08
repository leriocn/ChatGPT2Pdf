const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertCompleteRender,
  collectConversationSnapshots,
  mergeSnapshot
} = require('../read-mode-core.js');

test('snapshots visible turns before virtual scrolling reuses their nodes', async () => {
  const reusedNode = { id: 'turn-0', text: 'first message' };
  let position = 0;

  const collected = await collectConversationSnapshots({
    getVisibleTurns: () => [reusedNode],
    snapshotTurn: turn => ({ id: turn.id, html: turn.text, textLength: turn.text.length, imageURLs: [] }),
    getPosition: () => position,
    getMaxPosition: () => 100,
    getViewportHeight: () => 100,
    scrollTo: next => {
      position = next;
      reusedNode.id = 'turn-1';
      reusedNode.text = 'second message';
    },
    wait: async () => {},
    stableBottomPasses: 2
  });

  assert.equal(collected.get('turn-0').html, 'first message');
  assert.equal(collected.get('turn-1').html, 'second message');
});

test('keeps collecting when lazy loading increases the scroll range at the bottom', async () => {
  let position = 0;
  let maxPosition = 100;

  const collected = await collectConversationSnapshots({
    getVisibleTurns: () => [{ id: `turn-${position}`, text: `message at ${position}` }],
    snapshotTurn: turn => ({ id: turn.id, html: turn.text, textLength: turn.text.length, imageURLs: [] }),
    getPosition: () => position,
    getMaxPosition: () => maxPosition,
    getViewportHeight: () => 100,
    scrollTo: next => {
      position = next;
      if (position === 100) maxPosition = 200;
    },
    wait: async () => {},
    stableBottomPasses: 2
  });

  assert.ok(collected.has('turn-200'));
});

test('keeps the richer snapshot when a turn finishes loading later', () => {
  const early = { id: 'turn-1', html: 'partial', textLength: 7, imageURLs: [] };
  const complete = { id: 'turn-1', html: 'complete response', textLength: 17, imageURLs: ['image'] };
  const imagePending = { id: 'turn-2', html: 'image', textLength: 5, imageURLs: ['image'], imageData: [{ url: 'image', base64: null }] };
  const imageLoaded = { id: 'turn-2', html: 'image', textLength: 5, imageURLs: ['image'], imageData: [{ url: 'image', base64: 'data:image/png;base64,abc' }] };
  const sameLengthDraft = { id: 'turn-3', html: 'draft1', textLength: 6, imageURLs: [] };
  const sameLengthFinal = { id: 'turn-3', html: 'final1', textLength: 6, imageURLs: [] };

  assert.equal(mergeSnapshot(early, complete), complete);
  assert.equal(mergeSnapshot(complete, early), complete);
  assert.equal(mergeSnapshot(imagePending, imageLoaded), imageLoaded);
  assert.equal(mergeSnapshot(sameLengthDraft, sameLengthFinal), sameLengthFinal);
});

test('throws instead of silently producing an incomplete PDF', () => {
  assert.throws(
    () => assertCompleteRender(['turn-0', 'turn-1'], ['turn-0']),
    /turn-1/
  );
});
