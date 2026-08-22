import { Ids } from '../domain/phase1';
import { Repository, type Record_ } from './repository';
import type { FirebaseDb } from './firebaseAdmin';

export interface AuditEntry extends Record_ {
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

/** listLeadActivity/listConversationActivity's enrichment — same "denormalize for one read
 * instead of a per-viewer users list" reasoning as CallLogWithContext, since a plain AGENT
 * can't call listUsers() to resolve someone else's actorUserId into a name themselves. */
export interface AuditEntryWithActor extends AuditEntry {
  actorName: string;
}

export class AuditLogService {
  private repo: Repository<AuditEntry>;
  constructor(db: FirebaseDb) {
    this.repo = new Repository<AuditEntry>(db, 'auditLog');
  }
  async write(actorUserId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.repo.create({ id: Ids.create('audit'), occurredAt: Ids.now(), actorUserId, action, targetType, targetId, metadata });
    } catch {
      // Mirrors the Apps Script build's denied_()/audit_() — auditing must never
      // block the actual authorization decision it's recording.
    }
  }
  async list(): Promise<AuditEntry[]> {
    const rows = await this.repo.list();
    return rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
}
