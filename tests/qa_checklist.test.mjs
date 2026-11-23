import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('Even Hub Store QA checks in bridge.ts and .gitignore', () => {
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'src', 'bridge.ts'), 'utf8');
  assert.match(bridgeSrc, /shutDownPageContainer\(1\)/, 'Must use mode 1 root exit dialog');
  assert.match(bridgeSrc, /textContainerUpgrade/, 'Must use flicker-free textContainerUpgrade');
  assert.match(bridgeSrc, /case undefined:/, 'Must handle SDK CLICK_EVENT 0 -> undefined quirk');
  assert.match(bridgeSrc, /AudioInputSource\.Glasses/, 'Must support G2 microphone capture');

  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env$/m, '.env must be gitignored');
  assert.match(gitignore, /^node_modules\/$/m, 'node_modules/ must be gitignored');
});

test('README includes required hackathon disclosures and 5 API feature requests', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /Paper Trading Only/i);
  assert.match(readme, /5 API Feature Requests/i);
  assert.match(readme, /1\.\s+\*\*/);
  assert.match(readme, /5\.\s+\*\*/);
});
