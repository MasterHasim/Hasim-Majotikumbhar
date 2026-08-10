/**
 * Static regression guard for the authorization gap found during the Phase 16 QA pass
 * (Phase8Api.getCustomerStage had no access check at all — any signed-in Google
 * account, even one with no Users record, could read any customer's lead stage).
 *
 * This doesn't execute anything — it parses every src/Phase*Endpoints.gs file to build
 * the full public-endpoint inventory (function name -> which PhaseNApi method it
 * calls), then parses the matching src/Phase*Services.gs file to check that method's
 * body references `this.access_` somewhere, either directly or via a private helper
 * (name ending in `_`) that itself references `this.access_` (two-pass: first find
 * every helper that's "safe", then check every public method calls this.access_
 * directly or calls a safe helper).
 *
 * Two endpoints are intentionally exempt (not just missed): `bootstrapPhase1` (there
 * is no user to check permissions against yet — that's the entire point of bootstrap;
 * it enforces its own email-allowlist check instead, via
 * `PropertiesService`/`wap.phase1.bootstrapAdminEmail`) and `whoAmI` (deliberately
 * exposes only the signed-in user's own identity/roles, gated by `currentUser()`,
 * which is present but doesn't need a *permission* check beyond being signed in).
 *
 * Run with: node tests/authorization-sweep-verification.js
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const endpointFiles = fs.readdirSync(srcDir).filter(f => /^Phase\d+Endpoints\.gs$/.test(f));

// endpointFunction -> { className, methodName }
const endpoints = {};
endpointFiles.forEach(file => {
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const phaseMatch = file.match(/^Phase(\d+)Endpoints\.gs$/);
  const apiFactory = 'phase' + phaseMatch[1] + 'Api_';
  const lines = text.split('\n');
  lines.forEach(line => {
    // e.g. function createUser(input) { return phase1Api_().createUser(input); }
    const m = line.match(/^function (\w+)\([^)]*\)\s*\{\s*return\s+phase\d+Api_\(\)\.(\w+)\(/);
    if (m) endpoints[m[1]] = { file: file.replace('Endpoints', 'Services'), methodName: m[2] };
  });
});

// Known intentional exemptions: bootstrap has no user yet to authorize against (it
// enforces its own allowlist check instead); whoAmI exposes only your own identity.
delete endpoints['bootstrapPhase1'];
delete endpoints['whoAmI'];
// authorizeConversationOperation calls access_.requireConversationOperation directly
// (not through a PhaseNApi method) — already an authorization check by definition.
delete endpoints['authorizeConversationOperation'];

function extractMethodBody(source, methodName) {
  const startPattern = new RegExp('(?:^|\\n)\\s*' + methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\([^)]*\\)\\s*\\{');
  const startMatch = startPattern.exec(source);
  if (!startMatch) return null;
  let depth = 0, i = startMatch.index + startMatch[0].length - 1; // position of the opening {
  const bodyStart = i + 1;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(bodyStart, i); }
  }
  return null;
}

const failures = [];
const byFile = {};
Object.keys(endpoints).forEach(fn => { const e = endpoints[fn]; (byFile[e.file] = byFile[e.file] || []).push({ fn, methodName: e.methodName }); });

Object.keys(byFile).forEach(file => {
  const fullPath = path.join(srcDir, file);
  if (!fs.existsSync(fullPath)) { failures.push(file + ': services file not found'); return; }
  const source = fs.readFileSync(fullPath, 'utf8');

  // Pass 1: find every private helper (name ending in `_`) whose own body references this.access_.
  const helperNames = Array.from(source.matchAll(/(\w+_)\([^)]*\)\s*\{/g)).map(m => m[1]);
  const safeHelpers = new Set();
  helperNames.forEach(name => {
    const body = extractMethodBody(source, name);
    if (body && body.indexOf('this.access_') !== -1) safeHelpers.add(name);
  });
  // A helper can itself call another safe helper — resolve transitively (a couple of passes is enough for this codebase's shallow call depth).
  for (let pass = 0; pass < 3; pass++) {
    helperNames.forEach(name => {
      if (safeHelpers.has(name)) return;
      const body = extractMethodBody(source, name);
      if (body && Array.from(safeHelpers).some(safe => body.indexOf('this.' + safe + '(') !== -1)) safeHelpers.add(name);
    });
  }

  // Constructor fields assigned `new PhaseNApi()` (a *different* class) are treated as
  // pre-audited delegates — e.g. Phase13Api composes Phase5Api's already-authorized
  // listMyNumbers()/listConversations() rather than re-checking access itself
  // (see the class-level comment in Phase13Services.gs). This sweep can't recursively
  // verify the delegated class's own methods; that's covered by the manual audit and
  // each delegate class's own test suite, not by this static check.
  const delegateFields = Array.from(source.matchAll(/this\.(\w+_)\s*=\s*new\s+Phase\d+Api\(/g)).map(m => m[1]);

  byFile[file].forEach(({ fn, methodName }) => {
    const body = extractMethodBody(source, methodName);
    if (body === null) { failures.push(fn + '() -> ' + methodName + '(): could not locate method body in ' + file + ' (parser gap, not necessarily a real issue — verify manually)'); return; }
    const callsAccessDirectly = body.indexOf('this.access_') !== -1;
    const callsSafeHelper = Array.from(safeHelpers).some(safe => body.indexOf('this.' + safe + '(') !== -1);
    const callsDelegate = delegateFields.some(field => body.indexOf('this.' + field + '.') !== -1);
    if (!callsAccessDirectly && !callsSafeHelper && !callsDelegate) {
      failures.push(fn + '() -> ' + methodName + '() in ' + file + ' has no reference to this.access_ (direct, via a helper, or via a delegated PhaseNApi) — likely missing an authorization check.');
    }
  });
});

if (failures.length) {
  console.error('Authorization sweep found ' + failures.length + ' issue(s):');
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}

console.log('Authorization sweep verification: PASS (' + Object.keys(endpoints).length + ' endpoints checked)');
