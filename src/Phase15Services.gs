/**
 * Phase 15 Audit, Security, Backup & Reliability.
 *
 * Audit coverage: the roadmap's minimum audited-event list is already satisfied by
 * every prior phase's own `audit_.write(...)` calls (LOGIN → `authentication.accepted`
 * in `src/Phase1AccessControl.gs`; SEND_MESSAGE → `message.sent`/`message.ingested`;
 * ASSIGN_CONVERSATION/REASSIGN_CONVERSATION → `conversation.assigned`;
 * CHANGE_STAGE → `customer.stageChanged`; ADD_REMARK → `remark.added`;
 * ADD_REMINDER/COMPLETE_REMINDER → `reminder.created`/`reminder.statusChanged`;
 * CREATE_TEMPLATE/UPDATE_TEMPLATE/SYNC_TEMPLATES → `template.*`/`templates.synced`;
 * CREATE_USER → `user.created`; DISABLE_USER → `user.updated`; ASSIGN_NUMBER/
 * REMOVE_NUMBER → `numberAccess.granted`/`.revoked`). See docs/DATABASE.md for the
 * full mapping. There is no LOGOUT event: authentication here is Google's own session
 * cookie, not an app-level session the code controls, so there is nothing for the app
 * to log a logout against.
 *
 * Secrets hygiene: verified clean (grepped source for hardcoded key/token/secret
 * patterns — everything reads from Script Properties; `.gitignore` already excludes
 * `.clasp.json`/`.clasprc.json`/credential files).
 *
 * Backup: `backupNow()` is the one genuinely new piece — an ADMIN-triggered full copy
 * of the application spreadsheet into Drive. `runScheduledBackup()` (the trigger
 * handler `installDailyBackupTrigger()` installs) is a system-level operation with no
 * Google Workspace identity available in trigger-execution context — same reasoning as
 * Phase 4's webhook ingestion — so it calls `performBackup_(null)` directly, bypassing
 * `AccessControl` entirely rather than trying to authenticate a trigger as a user.
 */
class Phase15Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
  }

  backupNow() {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    return this.performBackup_(actor.id);
  }

  performBackup_(actorUserId) {
    var spreadsheetId = Phase2Spreadsheet.requireSpreadsheetId_();
    var original = SpreadsheetApp.openById(spreadsheetId);
    var name = 'Backup - ' + original.getName() + ' - ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd HH:mm');
    var copy = original.copy(name);
    this.audit_.write(actorUserId, 'backup.created', 'spreadsheet', copy.getId(), { name: name });
    return { id: copy.getId(), name: name, url: copy.getUrl() };
  }

  installDailyBackupTrigger() {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    this.removeExistingBackupTriggers_();
    ScriptApp.newTrigger('runScheduledBackup').timeBased().everyDays(1).atHour(2).create();
    this.audit_.write(actor.id, 'backup.triggerInstalled', 'trigger', 'runScheduledBackup', {});
    return { installed: true };
  }

  removeDailyBackupTrigger() {
    var actor = this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    var removed = this.removeExistingBackupTriggers_();
    this.audit_.write(actor.id, 'backup.triggerRemoved', 'trigger', 'runScheduledBackup', { removed: removed });
    return { removed: removed };
  }

  getBackupTriggerStatus() {
    this.access_.require(Phase1Permissions.SETTINGS_MANAGE);
    return { installed: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'runScheduledBackup'; }) };
  }

  removeExistingBackupTriggers_() {
    var existing = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'runScheduledBackup'; });
    existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });
    return existing.length;
  }
}

/** Time-driven trigger handler, installed by Phase15Api.installDailyBackupTrigger(). No Google identity in this execution context — a system operation, same as Phase 4's webhook ingestion. */
function runScheduledBackup() {
  new Phase15Api().performBackup_(null);
}
