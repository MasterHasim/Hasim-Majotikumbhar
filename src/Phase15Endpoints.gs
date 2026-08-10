/** Public Phase 15 entry points. */
function phase15Api_() { return new Phase15Api(); }
function backupNow() { return phase15Api_().backupNow(); }
function installDailyBackupTrigger() { return phase15Api_().installDailyBackupTrigger(); }
function removeDailyBackupTrigger() { return phase15Api_().removeDailyBackupTrigger(); }
function getBackupTriggerStatus() { return phase15Api_().getBackupTriggerStatus(); }
