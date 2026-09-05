// Read-only release inventory/check. Explicit allowlist excludes local runtime,
// browser profiles, credentials, and superseded userscript experiments.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const roots = ['.gitignore', 'LICENSE', 'README.md', 'GLOBAL-GATE.md', 'THIRD-PARTY-NOTICES.md',
  '.github/workflows/test.yml', 'config', 'lb-custom', 'leechblock-shared',
  'scripts/server.py', 'scripts/install.ps1', 'scripts/start.ps1', 'scripts/stop.ps1',
  'scripts/uninstall.ps1', 'scripts/test.ps1', 'scripts/test-shared-session.cjs',
  'scripts/defaults.cjs', 'scripts/package.cjs'];

function listFiles(relative) {
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), false, `No symlinks allowed: ${relative}`);
  return stat.isDirectory() ? fs.readdirSync(absolute).flatMap(name => listFiles(`${relative}/${name}`)) : [relative];
}

function inventory() {
  return roots.flatMap(listFiles).sort().map(file => {
    assert.doesNotMatch(file, /(^|\/)(\.runtime|\.env|node_modules|__pycache__|_metadata)(\/|$)/);
    const data = fs.readFileSync(path.join(root, file));
    const sha = crypto.createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
    return { path: file, size: data.length, sha, mode: '100644', type: 'blob' };
  });
}

const files = inventory();
if (process.argv[2] === '--base64') {
  const file = process.argv[3];
  assert.ok(files.some(item => item.path === file), 'Path must be in release allowlist');
  process.stdout.write(fs.readFileSync(path.join(root, file)).toString('base64'));
} else if (process.argv[2] === '--list') {
  process.stdout.write(JSON.stringify(files));
} else {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'leechblock-shared/manifest.json'), 'utf8'));
  const referenced = [manifest.background.service_worker, manifest.options_ui.page,
    manifest.action.default_popup, ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(script => [...(script.js ?? []), ...(script.css ?? [])])];
  for (const file of referenced) assert.ok(files.some(item => item.path === `leechblock-shared/${file}`), `Missing ${file}`);
  assert.equal(manifest.key, undefined);
  assert.equal(manifest.update_url, undefined);
  for (const filename of ['LICENSE', 'leechblock-shared/LICENSE', 'leechblock-shared/fonts/LICENSE', 'leechblock-shared/jquery-ui/LICENSE.txt']) {
    assert.ok(files.some(item => item.path === filename), `Missing license: ${filename}`);
  }
  console.log(`Release inventory checked: ${files.length} files, ${files.reduce((sum, file) => sum + file.size, 0)} bytes.`);
}
