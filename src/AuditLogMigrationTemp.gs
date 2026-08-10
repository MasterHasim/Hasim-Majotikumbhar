/**
 * One-time migration (2026-08-10): move existing audit log entries out of the old,
 * now quota-exhausted PropertiesService blob ('wap.phase1.auditLog') into the new
 * Audit_Log Sheets tab (AuditLogRepository, see Phase2Repositories.gs). Run once from
 * the Apps Script editor (select migrateAuditLogToSheetOnce in the function dropdown,
 * click Run), confirm the logged count looks right, then delete this file and push
 * again — same one-time-wrapper pattern used for every prior migration in this repo.
 */
function migrateAuditLogToSheetOnce() {
  var raw = PropertiesService.getScriptProperties().getProperty('wap.phase1.auditLog');
  var records = raw ? JSON.parse(raw) : {};
  var repository = new AuditLogRepository();
  var migrated = 0;
  Object.keys(records).forEach(function (id) {
    var entry = records[id];
    repository.create({
      id: entry.id,
      occurredAt: entry.occurredAt,
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: JSON.stringify(entry.metadata || {})
    });
    migrated++;
  });
  PropertiesService.getScriptProperties().deleteProperty('wap.phase1.auditLog');
  console.log('Migrated ' + migrated + ' audit log entries to the Audit_Log sheet; cleared the old Property.');
}
