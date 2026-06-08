(function (global) {
  'use strict';

  function snapshotScore(snapshot) {
    if (!snapshot) return -1;
    const htmlLength = snapshot.html ? snapshot.html.length : 0;
    const textLength = snapshot.textLength || 0;
    const imageCount = snapshot.imageURLs ? snapshot.imageURLs.length : 0;
    const loadedImageCount = snapshot.imageData
      ? snapshot.imageData.filter(image => image.base64).length
      : 0;
    return htmlLength + textLength + imageCount * 10000 + loadedImageCount * 1000000;
  }

  function mergeSnapshot(existing, candidate) {
    if (!existing) return candidate;
    return snapshotScore(candidate) >= snapshotScore(existing) ? candidate : existing;
  }

  async function collectConversationSnapshots(options) {
    const {
      getVisibleTurns,
      snapshotTurn,
      getPosition,
      getMaxPosition,
      getViewportHeight,
      scrollTo,
      wait,
      isCancelled = () => false,
      onProgress = () => {},
      stepRatio = 0.65,
      stableBottomPasses = 3,
      maxPasses = 1000
    } = options;

    const collected = new Map();
    let stableAtBottom = 0;
    let lastMaxPosition = -1;
    let lastCollectedSize = -1;

    for (let pass = 0; pass < maxPasses; pass++) {
      if (isCancelled()) return null;

      const visibleTurns = getVisibleTurns();
      visibleTurns.forEach((turn, index) => {
        const snapshot = snapshotTurn(turn, index);
        if (!snapshot || !snapshot.id) return;
        collected.set(snapshot.id, mergeSnapshot(collected.get(snapshot.id), snapshot));
      });

      const position = Math.max(0, getPosition());
      const maxPosition = Math.max(0, getMaxPosition());
      const atBottom = position >= maxPosition - 2;
      const unchanged = maxPosition === lastMaxPosition && collected.size === lastCollectedSize;

      onProgress({ pass, count: collected.size, position, maxPosition, atBottom });

      if (atBottom && unchanged) stableAtBottom++;
      else stableAtBottom = 0;

      if (stableAtBottom >= stableBottomPasses) return collected;

      lastMaxPosition = maxPosition;
      lastCollectedSize = collected.size;

      if (!atBottom) {
        const step = Math.max(1, Math.floor(getViewportHeight() * stepRatio));
        scrollTo(Math.min(position + step, maxPosition));
      } else {
        scrollTo(maxPosition);
      }

      await wait(atBottom ? 600 : 350);
    }

    throw new Error('Conversation collection did not stabilize before the safety limit');
  }

  function assertCompleteRender(expectedIds, renderedIds) {
    const rendered = new Set(renderedIds);
    const missing = expectedIds.filter(id => !rendered.has(id));
    if (missing.length > 0) {
      throw new Error(`PDF rendering missed ${missing.length} conversation turn(s): ${missing.join(', ')}`);
    }
  }

  const api = {
    assertCompleteRender,
    collectConversationSnapshots,
    mergeSnapshot,
    snapshotScore
  };

  global.ChatGPT2PdfReadModeCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
