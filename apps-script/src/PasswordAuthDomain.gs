/**
 * Password hashing/token helpers for the email+password login path added
 * 2026-08-10 (runs alongside Google Sign-In, does not replace it — see
 * memory/DECISIONS.md). Apps Script has no bcrypt/scrypt/argon2 built in, so this
 * is a manually-stretched SHA-256 (salt + many rounds) — a reasonable best-effort
 * given the environment, not as strong as a real password-hashing KDF. Iteration
 * count is a judgment call balancing brute-force resistance against Utilities
 * .computeDigest()'s per-call bridging overhead (each call leaves the V8 sandbox);
 * revisit if login feels slow once live-tested.
 */
var PasswordAuthConfig_ = {
  HASH_ITERATIONS: 3000,
  SESSION_TTL_MS: 12 * 60 * 60 * 1000,
  RESET_TOKEN_TTL_MS: 60 * 60 * 1000
};

/**
 * ScriptApp.getService().getUrl() returns whichever deployment URL is CURRENTLY
 * serving the executing request — including the /dev "test deployment" URL if the
 * admin who triggered the email happened to be browsing the app via /dev at that
 * moment (Apps Script editor > Test deployments), not the real published /exec URL.
 * Real bug found live 2026-08-17: a "Send setup link" email went out with a /dev URL,
 * which 403s for anyone but the script's own editors. Script Property WEB_APP_URL
 * (set once to the real @HEAD deployment's /exec URL) makes emailed links stable
 * regardless of which URL is open in the sender's own browser tab; falls back to
 * getUrl() if unset so this doesn't hard-break for anyone who hasn't configured it.
 */
function webAppUrl_() {
  var configured = PropertiesService.getScriptProperties().getProperty('WEB_APP_URL');
  return configured || ScriptApp.getService().getUrl();
}

function generateSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}
function generateToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}
function hashPassword_(password, salt) {
  var value = salt + ':' + password;
  for (var i = 0; i < PasswordAuthConfig_.HASH_ITERATIONS; i++) {
    value = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value + ':' + salt));
  }
  return value;
}
function verifyPassword_(password, salt, expectedHash) {
  return !!expectedHash && hashPassword_(password, salt) === expectedHash;
}
// No ambiguous characters (0/O, 1/l/I) — this gets read aloud or retyped by hand.
// Derived from two UUIDs' hex digits rather than Math.random() for better entropy.
function generateTemporaryPassword_() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var raw = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var password = '';
  for (var i = 0; i < 10; i++) {
    password += alphabet.charAt(parseInt(raw.substr(i * 2, 2), 16) % alphabet.length);
  }
  return password;
}
