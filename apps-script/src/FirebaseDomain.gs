/**
 * OAuth2 (service-account JWT-bearer flow) authentication to Firebase Realtime
 * Database, added 2026-08-11 to move Messages/Conversations off Sheets (see
 * memory/DECISIONS.md — those two tables are what actually get re-read repeatedly;
 * everything else stays on Sheets/PropertiesRepository, no benefit to moving tiny
 * rarely-touched reference tables).
 *
 * Apps Script has no Firebase Admin SDK, so this signs a JWT by hand
 * (Utilities.computeRsaSha256Signature) and exchanges it for a bearer token via
 * Google's OAuth2 token endpoint — the standard service-account server-to-server
 * flow. Requires two Script Properties, set directly by the user (never pasted into
 * chat, same discipline as every other credential in this project):
 *   FIREBASE_DATABASE_URL       — e.g. https://x-default-rtdb.asia-southeast1.firebasedatabase.app
 *   FIREBASE_SERVICE_ACCOUNT_B64 — base64 of the full downloaded service-account JSON key
 *
 * The exchanged access token is cached in a Script Property (not CacheService —
 * this is credential material, not user-facing data, and PropertiesService is
 * already the established place secrets live in this project) for 50 of its 60
 * real minutes of validity, so most calls don't re-authenticate.
 */
var FirebaseConfig_ = {
  DATABASE_URL_PROPERTY: 'FIREBASE_DATABASE_URL',
  SERVICE_ACCOUNT_PROPERTY: 'FIREBASE_SERVICE_ACCOUNT_B64',
  TOKEN_CACHE_PROPERTY: 'FIREBASE_TOKEN_CACHE',
  // 2026-08-11: firebase.database alone was rejected by Firebase with a 401
  // "Unauthorized request" on the actual database call, even though the OAuth2
  // token exchange itself succeeded — Google's documented service-account pattern
  // for Realtime Database REST access pairs it with userinfo.email.
  TOKEN_SCOPE: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
  TOKEN_URI: 'https://oauth2.googleapis.com/token',
  TOKEN_TTL_MS: 50 * 60 * 1000, // real token is valid 60 min; refresh a bit early to never use a stale one

  databaseUrl_: function () {
    var url = PropertiesService.getScriptProperties().getProperty(this.DATABASE_URL_PROPERTY);
    if (!url) throw new Phase1Error('CONFIGURATION_ERROR', 'Script Property ' + this.DATABASE_URL_PROPERTY + ' is not configured.');
    return url.replace(/\/$/, '');
  },
  serviceAccount_: function () {
    var b64 = PropertiesService.getScriptProperties().getProperty(this.SERVICE_ACCOUNT_PROPERTY);
    if (!b64) throw new Phase1Error('CONFIGURATION_ERROR', 'Script Property ' + this.SERVICE_ACCOUNT_PROPERTY + ' is not configured.');
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString());
  },
  accessToken_: function () {
    var props = PropertiesService.getScriptProperties();
    var cached = props.getProperty(this.TOKEN_CACHE_PROPERTY);
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed.expiresAt > Date.now()) return parsed.token;
    }
    var token = this.fetchNewToken_();
    props.setProperty(this.TOKEN_CACHE_PROPERTY, JSON.stringify({ token: token, expiresAt: Date.now() + this.TOKEN_TTL_MS }));
    return token;
  },
  clearTokenCache_: function () {
    PropertiesService.getScriptProperties().deleteProperty(this.TOKEN_CACHE_PROPERTY);
  },
  fetchNewToken_: function () {
    var serviceAccount = this.serviceAccount_();
    var now = Math.floor(Date.now() / 1000);
    var header = base64UrlEncodeString_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    var claimSet = base64UrlEncodeString_(JSON.stringify({
      iss: serviceAccount.client_email, scope: this.TOKEN_SCOPE, aud: this.TOKEN_URI, iat: now, exp: now + 3600
    }));
    var unsigned = header + '.' + claimSet;
    var signature = base64UrlEncodeBytes_(Utilities.computeRsaSha256Signature(unsigned, serviceAccount.private_key));
    var jwt = unsigned + '.' + signature;
    var response = UrlFetchApp.fetch(this.TOKEN_URI, {
      method: 'post', contentType: 'application/x-www-form-urlencoded', muteHttpExceptions: true,
      payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
    });
    var body = JSON.parse(response.getContentText());
    if (!body.access_token) throw new Phase1Error('CONFIGURATION_ERROR', 'Firebase authentication failed: ' + response.getContentText());
    return body.access_token;
  },
  /**
   * Mints a Firebase Auth "custom token" (2026-08-11, for real-time listening — see
   * RealtimeListenServices.gs) — a different JWT shape/audience than the OAuth2
   * service-account token above, but signed the same way with the same key. The
   * browser can't use this directly; it exchanges it for a real Firebase ID token
   * via signInWithCustomToken (client-side, needs the public Web API Key, not this).
   * `claims` are embedded in the resulting ID token and checked by Realtime Database
   * security rules — this is what scopes a given user's live-listen access to
   * exactly the numbers they already have access to, not the whole database.
   */
  mintCustomToken_: function (uid, claims) {
    var serviceAccount = this.serviceAccount_();
    var now = Math.floor(Date.now() / 1000);
    var header = base64UrlEncodeString_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    var claimSet = base64UrlEncodeString_(JSON.stringify({
      iss: serviceAccount.client_email, sub: serviceAccount.client_email,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now, exp: now + 3600, uid: uid, claims: claims || {}
    }));
    var unsigned = header + '.' + claimSet;
    var signature = base64UrlEncodeBytes_(Utilities.computeRsaSha256Signature(unsigned, serviceAccount.private_key));
    return unsigned + '.' + signature;
  }
};

function base64UrlEncodeBytes_(bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); }
function base64UrlEncodeString_(str) { return base64UrlEncodeBytes_(Utilities.newBlob(str).getBytes()); }
