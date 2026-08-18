/**
 * Real-time browser-to-Firebase listening (2026-08-11) — lets the open conversation
 * update the instant a new message lands, instead of only refreshing after the
 * agent takes an action. The browser never talks to Apps Script for this; it
 * connects to Firebase directly. All WRITES still go through Apps Script exactly as
 * before (sendReply, addRemark, etc.) — this only adds a read-only live channel.
 *
 * Security model: a custom Firebase Auth token is minted here, scoped with a
 * numberIds claim listing exactly the numbers this signed-in user already has
 * access to (Phase5Api.listMyNumbers() — the same grant this app already enforces
 * everywhere else). Firebase Realtime Database security rules (set by the user in
 * the Firebase console, not something this code can apply — see PROGRESS.md) check
 * that claim against each record's own numberId field, so a token minted for one
 * agent can't be used to read a number they were never granted, even though the
 * browser is now talking to Firebase directly instead of through Apps Script's own
 * per-conversation authorization checks.
 */
class RealtimeListenApi {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.phase5_ = new Phase5Api();
  }

  getRealtimeListenToken() {
    var actor = this.access_.currentUser();
    var numbers = this.phase5_.listMyNumbers();
    var numberIds = {};
    numbers.forEach(function (n) { numberIds[n.id] = true; });
    var token = FirebaseConfig_.mintCustomToken_(actor.id, { numberIds: numberIds });
    // Web API Key is public/safe to hand to the browser (it's how any Firebase web
    // app identifies its project — not a secret like the service account key), but
    // still comes from a Script Property rather than being hardcoded, so it's set
    // the same way as everything else Firebase-related in this project.
    var webApiKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_WEB_API_KEY');
    if (!webApiKey) throw new Phase1Error('CONFIGURATION_ERROR', 'Script Property FIREBASE_WEB_API_KEY is not configured.');
    return { token: token, databaseUrl: FirebaseConfig_.databaseUrl_(), webApiKey: webApiKey };
  }
}
