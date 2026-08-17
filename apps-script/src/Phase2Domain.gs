/**
 * Phase 2 data contracts: column schemas for the Sheets-backed repository layer.
 * Reuses Phase1Error / Phase1Ids / Phase1Validation from Phase1Domain.gs — those are
 * already generic, not Phase-1-specific, so they are not duplicated here.
 *
 * Users, Teams, Team_Members, and User_Number_Access remain on Phase 1's
 * PropertiesRepository by deliberate decision (see memory/DECISIONS.md) and have no
 * entry below.
 *
 * Audit_Log moved off PropertiesRepository on 2026-08-10: it was originally kept there
 * as "low volume", but after a month of real daily use its single JSON-blob Property
 * value exceeded Apps Script's per-value storage quota, which started throwing
 * "exceeded the property storage quota" on every write that audit-logs unwrapped
 * (e.g. Phase8Api.addRemark). Sheets rows don't have that ceiling. metadata is stored
 * JSON-stringified since Sheets cells are flat. See memory/DECISIONS.md.
 */
var Phase2Schemas = {
  WhatsApp_Numbers: ['displayName', 'phoneNumber', 'provider', 'providerAccountId', 'wabaId', 'providerNumberId', 'active', 'createdAt', 'updatedAt'],
  Number_Assignment_Config: ['numberId', 'roundRobinEnabled', 'fallbackUserId', 'workingHoursStart', 'workingHoursEnd', 'lastAssignedUserId', 'createdAt', 'updatedAt'],
  Number_Assignment_Users: ['numberId', 'userId', 'sequenceOrder', 'active', 'createdAt', 'updatedAt'],
  Customers: ['phone', 'name', 'email', 'company', 'source', 'createdAt', 'updatedAt'],
  Conversations: ['customerId', 'numberId', 'assignedUserId', 'status', 'needsResponse', 'lastMessageAt', 'createdAt', 'updatedAt'],
  Conversation_Assignments: ['conversationId', 'userId', 'assignedBy', 'assignedAt', 'reason'],
  Messages: ['conversationId', 'numberId', 'senderUserId', 'direction', 'messageType', 'messageText', 'providerMessageId', 'status', 'timestamp'],
  Remarks: ['conversationId', 'authorUserId', 'text', 'createdAt'],
  Reminders: ['conversationId', 'ownerUserId', 'text', 'dueAt', 'status', 'createdAt', 'updatedAt'],
  Lead_Stages: ['key', 'name', 'sequenceOrder', 'active', 'createdAt', 'updatedAt'],
  WhatsApp_Templates: ['wabaId', 'providerTemplateId', 'name', 'language', 'category', 'status', 'components', 'variables', 'createdAt', 'updatedAt', 'lastSyncedAt'],
  Quick_Replies: ['shortcut', 'text', 'active', 'createdAt', 'updatedAt'],
  // Phase 8: a customer's current lead stage. Deliberately its own tab rather than a
  // new column on Customers — Customers already has real live data, and
  // SheetRepository doesn't do safe header migration (a new column added to an
  // existing schema would misalign already-written rows, since appendRow_/writeRow_
  // build values positionally from this array). See memory/DECISIONS.md.
  Customer_Stage: ['customerId', 'stageId', 'setByUserId', 'updatedAt'],
  // Phase 9: snooze state, same rationale as Customer_Stage — its own tab rather than
  // new columns on the already-live Conversations tab.
  Conversation_Snooze: ['conversationId', 'snoozedUntil', 'snoozedByUserId', 'createdAt'],
  // Phase 11: media attached to a message. Its own tab, same rationale — Messages
  // already has real live data and has no mediaUrl column.
  Message_Media: ['messageId', 'mediaType', 'mediaUrl', 'caption'],
  Audit_Log: ['occurredAt', 'actorUserId', 'action', 'targetType', 'targetId', 'metadata'],
  // Phase 22: location-wise call leads, a separate concept from Customers/Conversations
  // above — see memory/DECISIONS.md. Enums/validation live in Phase22Domain.gs; the
  // column arrays live here per this file's own established convention (Phase 8/9/11).
  Leads: ['name', 'phone', 'location', 'status', 'assignedUserId', 'assignedAt', 'uploadBatchId', 'uploadedBy', 'createdAt', 'updatedAt'],
  Location_Assignment_Config: ['location', 'mode', 'singleUserId', 'lastAssignedUserId', 'active', 'createdAt', 'updatedAt'],
  Location_Assignment_Users: ['location', 'userId', 'sequenceOrder', 'active', 'createdAt', 'updatedAt'],
  Call_Log: ['leadId', 'agentUserId', 'exotelCallSid', 'agentPhone', 'leadPhone', 'callerId', 'status', 'initiatedAt', 'updatedAt']
};
