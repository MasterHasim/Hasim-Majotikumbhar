/**
 * Email+password login, alongside (not replacing) Google Sign-In. Sessions and
 * password-reset tokens live on Phase 1's PropertiesRepository ('sessions',
 * 'passwordResets' collections) — actively pruned of expired entries on every
 * mutation so they can't grow unbounded the way Audit_Log once did (see
 * memory/DECISIONS.md, 2026-08-10). Team size here is small, so this stays cheap.
 */
class PasswordAuthApi {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
  }

  login(email, password) {
    email = Phase1Validation.requiredString(email, 'email').toLowerCase();
    password = Phase1Validation.requiredString(password, 'password');
    var user = this.repository_.findOne('users', function (u) { return u.email === email; });
    var genericError = new Phase1Error('UNAUTHENTICATED', 'Incorrect email or password.');
    if (!user || user.status !== Phase1Constants.ACTIVE || !user.passwordHash) {
      this.audit_.write(user ? user.id : null, 'passwordAuth.loginDenied', 'identity', email,
        { reason: !user ? 'UNKNOWN_USER' : !user.passwordHash ? 'NO_PASSWORD_SET' : 'USER_NOT_ACTIVE' });
      throw genericError; // deliberately generic — never reveal which part was wrong
    }
    if (!verifyPassword_(password, user.passwordSalt, user.passwordHash)) {
      this.audit_.write(user.id, 'passwordAuth.loginDenied', 'identity', email, { reason: 'BAD_PASSWORD' });
      throw genericError;
    }
    var token = this.createSession_(user.id);
    this.audit_.write(user.id, 'passwordAuth.loginAccepted', 'user', user.id, {});
    return { token: token, user: this.publicUser_(user) };
  }

  logout(token) {
    this.pruneSessions_();
    if (token) { try { this.repository_.remove('sessions', token); } catch (ignored) {} }
    return { ok: true };
  }

  /** Not a public endpoint — called directly by callApi() (PasswordAuthEndpoints.gs) to resolve the current caller. */
  resolveSession(token) {
    if (!token) return null;
    var session = this.repository_.get('sessions', token);
    if (!session || session.expiresAt < Phase1Ids.now()) return null;
    var user = this.repository_.get('users', session.userId);
    if (!user || user.status !== Phase1Constants.ACTIVE) return null;
    return { session: session, user: user };
  }

  requestPasswordReset(email) {
    email = Phase1Validation.requiredString(email, 'email').toLowerCase();
    var user = this.repository_.findOne('users', function (u) { return u.email === email; });
    // Always report success regardless of whether the account exists — don't leak registered emails.
    if (user && user.status === Phase1Constants.ACTIVE) {
      var token = this.createResetToken_(user.id);
      this.sendResetEmail_(user, token);
      this.audit_.write(user.id, 'passwordAuth.resetRequested', 'user', user.id, {});
    }
    return { ok: true };
  }

  /** Admin-triggered equivalent of "forgot password" — the flow for first-time password setup too, same token mechanism. Needs email delivery to work. */
  sendPasswordSetupLink(userId) {
    var access = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    var actor = access.require(Phase1Permissions.USERS_MANAGE);
    var user = this.repository_.get('users', userId);
    if (!user) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    var token = this.createResetToken_(user.id);
    this.sendResetEmail_(user, token);
    this.audit_.write(actor.id, 'passwordAuth.setupLinkSent', 'user', user.id, {});
    return { ok: true };
  }

  /**
   * Alternative to sendPasswordSetupLink that needs no email delivery at all — for
   * users on a domain/email where the reset email can't be verified to arrive (see
   * memory/DECISIONS.md, 2026-08-10). Returns the plaintext temporary password once,
   * to the admin, who shares it however they like; it is never stored in plaintext
   * or retrievable again. mustChangePassword forces a change before the user can use
   * the app (enforced both at login and on every subsequent whoAmI() check, so it
   * can't be bypassed by staying signed in past the login moment).
   */
  setTemporaryPassword(userId) {
    var access = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    var actor = access.require(Phase1Permissions.USERS_MANAGE);
    var user = this.repository_.get('users', userId);
    if (!user) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    var temporaryPassword = generateTemporaryPassword_();
    var salt = generateSalt_();
    this.repository_.update('users', user.id, { passwordSalt: salt, passwordHash: hashPassword_(temporaryPassword, salt), mustChangePassword: true });
    this.audit_.write(actor.id, 'passwordAuth.temporaryPasswordSet', 'user', user.id, {});
    return { temporaryPassword: temporaryPassword };
  }

  /** Called while already signed in (via callApi, so AccessControl.currentUser() resolves the caller from the session). */
  changePassword(currentPassword, newPassword) {
    var access = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    var actor = access.currentUser();
    currentPassword = Phase1Validation.requiredString(currentPassword, 'currentPassword');
    newPassword = Phase1Validation.requiredString(newPassword, 'newPassword');
    if (newPassword.length < 8) throw new Phase1Error('VALIDATION_ERROR', 'Password must be at least 8 characters.');
    if (!verifyPassword_(currentPassword, actor.passwordSalt, actor.passwordHash)) throw new Phase1Error('UNAUTHENTICATED', 'Current password is incorrect.');
    var salt = generateSalt_();
    this.repository_.update('users', actor.id, { passwordSalt: salt, passwordHash: hashPassword_(newPassword, salt), mustChangePassword: false });
    this.audit_.write(actor.id, 'passwordAuth.passwordChanged', 'user', actor.id, {});
    return { ok: true };
  }

  resetPassword(token, newPassword) {
    token = Phase1Validation.requiredString(token, 'token');
    newPassword = Phase1Validation.requiredString(newPassword, 'newPassword');
    if (newPassword.length < 8) throw new Phase1Error('VALIDATION_ERROR', 'Password must be at least 8 characters.');
    this.pruneResetTokens_();
    var reset = this.repository_.get('passwordResets', token);
    if (!reset || reset.expiresAt < Phase1Ids.now()) throw new Phase1Error('NOT_FOUND', 'This link has expired or was already used — ask for a new one.');
    var user = this.repository_.get('users', reset.userId);
    if (!user) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    var salt = generateSalt_();
    this.repository_.update('users', user.id, { passwordSalt: salt, passwordHash: hashPassword_(newPassword, salt), mustChangePassword: false });
    try { this.repository_.remove('passwordResets', token); } catch (ignored) {}
    this.audit_.write(user.id, 'passwordAuth.passwordSet', 'user', user.id, {});
    return { ok: true };
  }

  publicUser_(user) { return { id: user.id, email: user.email, displayName: user.displayName, roleIds: user.roleIds, status: user.status, mustChangePassword: !!user.mustChangePassword }; }

  createSession_(userId) {
    this.pruneSessions_();
    var token = generateToken_();
    this.repository_.create('sessions', { id: token, userId: userId, createdAt: Phase1Ids.now(), expiresAt: new Date(Date.now() + PasswordAuthConfig_.SESSION_TTL_MS).toISOString() });
    return token;
  }
  pruneSessions_() {
    var self = this, now = Phase1Ids.now();
    this.repository_.list('sessions').forEach(function (s) { if (s.expiresAt < now) { try { self.repository_.remove('sessions', s.id); } catch (ignored) {} } });
  }
  createResetToken_(userId) {
    this.pruneResetTokens_();
    var token = generateToken_();
    this.repository_.create('passwordResets', { id: token, userId: userId, expiresAt: new Date(Date.now() + PasswordAuthConfig_.RESET_TOKEN_TTL_MS).toISOString() });
    return token;
  }
  pruneResetTokens_() {
    var self = this, now = Phase1Ids.now();
    this.repository_.list('passwordResets').forEach(function (r) { if (r.expiresAt < now) { try { self.repository_.remove('passwordResets', r.id); } catch (ignored) {} } });
  }
  /**
   * MailApp.sendEmail — UNVERIFIED whether reset emails actually arrive/aren't
   * spam-filtered, same live-test caveat as every other external delivery in this
   * project (Exotel sends, etc.). Requires the script.send_mail OAuth scope, added
   * 2026-08-10 — expect a fresh consent screen on next authorization.
   */
  sendResetEmail_(user, token) {
    var url = ScriptApp.getService().getUrl() + '?resetToken=' + encodeURIComponent(token);
    MailApp.sendEmail(user.email, 'Set your WhatsApp Panel password',
      'Hi ' + user.displayName + ',\n\nUse this link to set your password (valid for 1 hour):\n' + url + '\n\nIf you did not request this, you can ignore this email.');
  }
}
