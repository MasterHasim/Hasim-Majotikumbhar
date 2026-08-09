/**
 * Phase 2 data contracts: column schemas for the Sheets-backed repository layer.
 * Reuses Phase1Error / Phase1Ids / Phase1Validation from Phase1Domain.gs — those are
 * already generic, not Phase-1-specific, so they are not duplicated here.
 *
 * Users, Teams, Team_Members, User_Number_Access, and Audit_Log remain on Phase 1's
 * PropertiesRepository by deliberate decision (see memory/DECISIONS.md) and have no
 * entry below.
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
  Quick_Replies: ['shortcut', 'text', 'active', 'createdAt', 'updatedAt']
};
