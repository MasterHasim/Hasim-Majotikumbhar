/**
 * Direct port of apps-script/src/Phase15Services.gs's Phase15Api, scoped to what
 * actually has a free-tier equivalent here — see PROGRESS.md for the full reasoning.
 *
 * Audit coverage and secrets hygiene (the other two thirds of the source's Phase 15)
 * aren't a new backend feature: every prior phase's own `audit.write(...)` calls
 * already satisfy the same audited-event list the source's own comment enumerates,
 * and no secret is ever hardcoded in this codebase (`wrangler secret put`, `.dev.vars`
 * gitignored) — nothing to port beyond what already exists.
 *
 * Backup: the source's `backupNow()` was a Google Sheets/Drive-specific
 * `SpreadsheetApp.copy()` — no 1:1 equivalent here since this backend has no
 * spreadsheet. The genuinely useful, zero-new-dependency equivalent is a full
 * Firebase Realtime Database JSON export (Firebase's REST API supports this at the
 * database root, same admin credentials this backend already holds), which the
 * browser downloads directly. `installDailyBackupTrigger`/`removeDailyBackupTrigger`
 * have no equivalent either: Cloudflare Cron Triggers are static wrangler.toml
 * config, not something togglable at runtime the way Apps Script's `ScriptApp`
 * triggers are — deliberately not built, see PROGRESS.md's task list.
 */
import { Ids, Permissions } from '../domain/phase1';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

export interface BackupResult {
  name: string;
  createdAt: string;
  snapshot: Record<string, unknown>;
}

export class Phase15Api {
  private access: AccessControl;
  private audit: AuditLogService;
  private phase1Repos: Phase1Repositories;

  constructor(private db: AppDb, identityEmail: string) {
    this.phase1Repos = buildPhase1Repositories(this.db);
    this.audit = new AuditLogService(this.db);
    this.access = new AccessControl(this.phase1Repos, this.audit, identityEmail);
  }

  /** A full Firebase Realtime Database JSON export, same admin credentials every other read in this backend uses — handed back to the browser as a download rather than copied to a Drive-equivalent host, since none is set up yet (see PROGRESS.md). */
  async backupNow(): Promise<BackupResult> {
    const actor = await this.access.require(Permissions.SETTINGS_MANAGE);
    const now = Ids.now();
    const snapshot = (await this.db.get<Record<string, unknown>>('')) ?? {};
    const name = `backup-${now.replace(/[:.]/g, '-')}`;
    await this.audit.write(actor.id, 'backup.created', 'database', name, { collections: Object.keys(snapshot).length });
    return { name, createdAt: now, snapshot };
  }
}
