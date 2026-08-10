/**
 * Phase 2 concrete repositories. Each is a SheetRepository pre-configured for one
 * entity/tab — no business logic or validation beyond what SheetRepository provides
 * generically, matching how thin PropertiesRepository itself is.
 *
 * AccessRepository is the one exception: Number_Assignment_Config and
 * Number_Assignment_Users are two related tabs (per-number round-robin config plus
 * its ordered participant list), so it composes two SheetRepository instances rather
 * than extending SheetRepository directly.
 */
class NumberRepository extends SheetRepository {
  constructor() { super('WhatsApp_Numbers', Phase2Schemas.WhatsApp_Numbers); }
}

class AccessRepository {
  constructor() {
    this.config = new SheetRepository('Number_Assignment_Config', Phase2Schemas.Number_Assignment_Config);
    this.users = new SheetRepository('Number_Assignment_Users', Phase2Schemas.Number_Assignment_Users);
  }
}

class CustomerRepository extends SheetRepository {
  constructor() { super('Customers', Phase2Schemas.Customers); }
}

class ConversationRepository extends SheetRepository {
  constructor() { super('Conversations', Phase2Schemas.Conversations); }
}

class AssignmentRepository extends SheetRepository {
  constructor() { super('Conversation_Assignments', Phase2Schemas.Conversation_Assignments); }
}

class MessageRepository extends SheetRepository {
  constructor() { super('Messages', Phase2Schemas.Messages); }
}

class RemarkRepository extends SheetRepository {
  constructor() { super('Remarks', Phase2Schemas.Remarks); }
}

class ReminderRepository extends SheetRepository {
  constructor() { super('Reminders', Phase2Schemas.Reminders); }
}

class StageRepository extends SheetRepository {
  constructor() { super('Lead_Stages', Phase2Schemas.Lead_Stages); }
}

class TemplateRepository extends SheetRepository {
  constructor() { super('WhatsApp_Templates', Phase2Schemas.WhatsApp_Templates); }
}

class QuickReplyRepository extends SheetRepository {
  constructor() { super('Quick_Replies', Phase2Schemas.Quick_Replies); }
}

class CustomerStageRepository extends SheetRepository {
  constructor() { super('Customer_Stage', Phase2Schemas.Customer_Stage); }
}

class ConversationSnoozeRepository extends SheetRepository {
  constructor() { super('Conversation_Snooze', Phase2Schemas.Conversation_Snooze); }
}

class MessageMediaRepository extends SheetRepository {
  constructor() { super('Message_Media', Phase2Schemas.Message_Media); }
}

class AuditLogRepository extends SheetRepository {
  constructor() { super('Audit_Log', Phase2Schemas.Audit_Log); }
}
