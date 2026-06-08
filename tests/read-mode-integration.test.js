const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('loads the read-mode core before content.js in every injection path', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts[0].js;
  const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

  assert.ok(scripts.indexOf('read-mode-core.js') >= 0);
  assert.ok(scripts.indexOf('read-mode-core.js') < scripts.indexOf('content.js'));
  assert.match(popup, /files:\s*\[[^\]]*'read-mode-core\.js'[^\]]*'content\.js'/s);
  assert.match(popup, /\{ action: 'exportPDF', mode \}, 600000/g);
});

test('read mode uses stable snapshots and verifies every turn was rendered', () => {
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

  assert.match(content, /collectConversationSnapshots/);
  assert.match(content, /assertCompleteRender/);
  assert.match(content, /assertCompleteRender\(sorted\.map/);
  assert.doesNotMatch(content, /data-message-author-role'\) \+ '-' \+ Math\.random\(\)/);
});

test('read mode refuses to save when images or rendered turns are incomplete', () => {
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

  assert.match(content, /cloned\.querySelectorAll\('source\[srcset\]'\)/);
  assert.match(content, /if \(failedCount > 0\)/);
  assert.match(content, /totalImagesAdded !== expectedImageCount/);
  assert.match(content, /src\.startsWith\('blob:'\)/);
  assert.match(content, /src\.startsWith\('data:image\/'\)/);
  assert.match(content, /img:not\(\[data-cg2p-src\]\)/);
  assert.match(content, /replaceImageWithCleanBlock/);
  assert.match(content, /cg2p-image-block/);
  assert.match(content, /aspect-ratio:\s*auto/);
  assert.match(content, /padding-top:\s*0/);
});

test('read mode prints one compact reconstructed document with selectable text', () => {
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

  assert.match(content, /createSelectableReadDocument/);
  assert.match(content, /__chatgpt2pdf_read_document__/);
  assert.match(content, /@media print/);
  assert.match(content, /window\.print\(\)/);
  assert.match(content, /page-break-after:\s*auto/);
  assert.match(content, /break-inside:\s*auto/);
  assert.doesNotMatch(content, /const BATCH_SIZE = 1/);
});
