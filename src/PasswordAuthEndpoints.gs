function passwordAuthApi_() { return new PasswordAuthApi(); }
function login(email, password) { return passwordAuthApi_().login(email, password); }
function logout(token) { return passwordAuthApi_().logout(token); }
function requestPasswordReset(email) { return passwordAuthApi_().requestPasswordReset(email); }
function resetPassword(token, newPassword) { return passwordAuthApi_().resetPassword(token, newPassword); }
function sendPasswordSetupLink(userId) { return passwordAuthApi_().sendPasswordSetupLink(userId); }
function setTemporaryPassword(userId) { return passwordAuthApi_().setTemporaryPassword(userId); }
function changePassword(currentPassword, newPassword) { return passwordAuthApi_().changePassword(currentPassword, newPassword); }
function sendWelcomeEmail(userId) { return passwordAuthApi_().sendWelcomeEmail(userId); }

// Every real public endpoint reachable via the password-session dispatcher below.
// bootstrapPhase1/doGet are deliberately excluded — one-time setup and page-render
// paths, not meant to run through a password session at all.
var PASSWORD_AUTH_API_ALLOWLIST_ = [
  'listRemarks', 'listTeams', 'listCustomers', 'listTeamMembers', 'addTeamMember', 'updateCustomer', 'updateTeamMember',
  'grantNumberAccess', 'revokeNumberAccess', 'listNumberAccess', 'setAvailability', 'setUserAvailability', 'getAvailability',
  'getAssignmentEligibility', 'setAssignmentEligibility', 'authorizeConversationOperation', 'listAuditLog', 'whoAmI',
  'getConversationWorkspace', 'backupNow', 'createDraftTemplate', 'createNumber', 'createQuickReply', 'createReminder',
  'getDashboardMetrics', 'getNumberAssignmentConfig', 'listMyNumbers', 'reassignConversation', 'searchConversations',
  'seedDefaultLeadStages', 'sendReply', 'createStage', 'createUser', 'getNeedsResponseCounts', 'installDailyBackupTrigger',
  'listAssignmentHistory', 'listConversations', 'sendTemplateReply', 'setNumberAssignmentConfig', 'updateDraftTemplate',
  'updateNumber', 'updateQuickReply', 'updateReminderStatus', 'getConversationDetail', 'listAssignableUsers',
  'listAssignmentParticipants', 'listNumbers', 'listQuickReplies', 'listReminders', 'listTemplates', 'removeDailyBackupTrigger',
  'sendMediaReply', 'updateStage', 'updateUser', 'addAssignmentParticipant', 'getBackupTriggerStatus', 'getTemplate',
  'listMyReminders', 'listStages', 'listUsers', 'uploadConversationMedia', 'listRoles', 'resolveConversation',
  'setCustomerStage', 'snoozeConversation', 'submitTemplateForReview', 'updateAssignmentParticipant', 'createTeam',
  'getCustomerStage', 'getDashboardSummary', 'syncTemplatesFromProvider', 'unsnoozeConversation', 'addRemark',
  'getSnoozeStatus', 'updateTeam', 'sendPasswordSetupLink', 'logout', 'setTemporaryPassword', 'changePassword', 'sendWelcomeEmail'
];

// While mustChangePassword is set, every other allowlisted call is blocked server-
// side (not just hidden client-side) — the temp password is a real credential, but
// it's meant to be short-lived, so this closes the gap rather than only relying on
// the login screen's own gating.
var PASSWORD_CHANGE_REQUIRED_ALLOWLIST_ = ['whoAmI', 'changePassword', 'logout'];

/**
 * Dispatcher for the email/password auth path (2026-08-10, see
 * memory/DECISIONS.md). google.script.run has no ambient session/cookie mechanism,
 * so a password-authenticated client must pass its session token on every call —
 * impractical to thread through every individual endpoint's signature (~75
 * functions). Instead the client routes every call through this one dispatcher
 * (see scriptRun() in frontend/Index.html), which resolves the token once, sets it
 * as the current identity for the duration of this single execution (see
 * setSessionIdentity_ in Phase1AccessControl.gs), and invokes the real, completely
 * unmodified endpoint function by name — every endpoint's own AccessControl checks
 * apply exactly as they do for Google-signed-in users. functionName is checked
 * against an explicit allowlist so this can't be used to invoke arbitrary global
 * functions (e.g. internal "_"-suffixed helpers).
 */
function callApi(sessionToken, functionName, args) {
  if (PASSWORD_AUTH_API_ALLOWLIST_.indexOf(functionName) === -1) throw new Phase1Error('NOT_FOUND', 'Unknown API function.');
  var resolved = passwordAuthApi_().resolveSession(sessionToken);
  if (!resolved) throw new Phase1Error('UNAUTHENTICATED', 'Your session has expired — please sign in again.');
  if (resolved.user.mustChangePassword && PASSWORD_CHANGE_REQUIRED_ALLOWLIST_.indexOf(functionName) === -1) {
    throw new Phase1Error('FORBIDDEN', 'You must change your temporary password before continuing.');
  }
  setSessionIdentity_(resolved.user.email);
  try {
    var fn = globalThis[functionName];
    if (typeof fn !== 'function') throw new Phase1Error('NOT_FOUND', 'Unknown API function.');
    return fn.apply(null, args || []);
  } finally {
    clearSessionIdentity_();
  }
}
