// Print/check the importable TXT snapshot directly from the extension's defaults.
// No browser storage, credentials, reason text, or running session is accessed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
function defaultOptionsText() {
  const context = vm.createContext({ URL });
  for (const name of ['common.js', 'shared-session.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'leechblock-shared', name), 'utf8'), context);
  }
  // Match the format produced by options.js -> compileExportOptions/exportOptions.
  return vm.runInContext(`(() => {
    const options = reasonGateDefaults();
    const lines = [];
    for (let set = 1; set <= +options.numSets; set++) {
      for (const [name, spec] of Object.entries(PER_SET_OPTIONS)) {
        if (!spec.id || name.startsWith('passwordSetSpec')) continue;
        const value = options[name + set];
        const encoded = spec.type == 'array' ? encodeDays(value)
          : spec.type == 'string' && name != 'sites' && name != 'times' ? escape(value) : value;
        lines.push(name + set + '=' + encoded);
      }
    }
    for (const [name, spec] of Object.entries(GENERAL_OPTIONS)) {
      if (!spec.id || ['password', 'orp'].includes(name)) continue;
      const value = options[name];
      lines.push(name + '=' + (spec.type == 'string' ? escape(value) : value));
    }
    return lines.join('\\n') + '\\n';
  })()`, context);
}

if (require.main === module) {
  const content = defaultOptionsText();
  if (process.argv.includes('--check')) {
    const saved = fs.readFileSync(path.join(root, 'config', 'default-options.txt'), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(saved, content, 'default-options.txt must match the live fresh-install defaults');
    console.log('Default configuration snapshot matches: both sets enabled, 30/5 minutes.');
  } else {
    process.stdout.write(content);
  }
}

module.exports = { defaultOptionsText };
