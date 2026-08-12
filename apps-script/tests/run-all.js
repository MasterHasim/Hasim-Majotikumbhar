/**
 * Runs every tests/*.js verification suite in-process and prints a pass/fail summary.
 * Each suite is a standalone script (its own mocks, its own `console.log('...: PASS')`
 * on success) — this just sequences them and catches failures without stopping early,
 * so one broken suite doesn't hide results from the rest.
 *
 * Run with: node tests/run-all.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir)
  .filter(file => file.endsWith('.js') && file !== path.basename(__filename))
  .sort();

const results = [];
files.forEach(file => {
  const fullPath = path.join(testsDir, file);
  try {
    const output = execFileSync(process.execPath, [fullPath], { encoding: 'utf8' });
    results.push({ file, ok: true, output: output.trim() });
  } catch (error) {
    results.push({ file, ok: false, output: (error.stdout || '') + (error.stderr || error.message) });
  }
});

console.log('');
results.forEach(result => {
  console.log((result.ok ? 'PASS' : 'FAIL') + '  ' + result.file);
  if (!result.ok) console.log('  ' + result.output.split('\n').join('\n  '));
});

const failed = results.filter(r => !r.ok);
console.log('');
console.log(results.length + ' suites, ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed.');
if (failed.length) process.exit(1);
