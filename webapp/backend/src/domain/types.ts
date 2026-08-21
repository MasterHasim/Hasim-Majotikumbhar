import type { Record_ } from '../lib/repository';
import type { Permission, RoleKey } from './phase1';

export interface User extends Record_ {
  email: string;
  displayName: string;
  status: 'active' | 'inactive' | 'suspended';
  roleIds: string[];
  /** Own phone number, for Exotel Voice click-to-call (Phase 22) to ring first — blank until the user/admin sets it. */
  phone: string;
  createdAt: string;
  updatedAt: string;
}

export interface Role extends Record_ {
  key: RoleKey;
  name: string;
  permissions: Permission[];
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Team extends Record_ {
  name: string;
  ownerUserId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember extends Record_ {
  teamId: string;
  userId: string;
  status: 'active' | 'inactive';
  numberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NumberAccess extends Record_ {
  userId: string;
  numberId: string;
  granted: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Availability extends Record_ {
  userId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentEligibility extends Record_ {
  userId: string;
  numberId: string;
  teamId: string;
  eligible: boolean;
  updatedAt: string;
}

// --- Messaging core (port of apps-script/src/Phase2Domain.gs's Phase2Schemas) ---

export interface WhatsAppNumber extends Record_ {
  displayName: string;
  phoneNumber: string;
  provider: string;
  providerAccountId: string;
  wabaId: string;
  providerNumberId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer extends Record_ {
  phone: string;
  name: string;
  email: string;
  company: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation extends Record_ {
  customerId: string;
  numberId: string;
  assignedUserId: string;
  status: 'OPEN' | 'CLOSED';
  needsResponse: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'RECEIVED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNKNOWN';

export interface Message extends Record_ {
  conversationId: string;
  numberId: string;
  senderUserId: string;
  direction: MessageDirection;
  messageType: string;
  messageText: string;
  providerMessageId: string;
  status: MessageStatus;
  timestamp: string;
}

// --- CRM core (port of Phase7/8/9/12's slice of Phase2Domain.gs's Phase2Schemas) ---

export interface AssignmentRecord extends Record_ {
  conversationId: string;
  userId: string;
  assignedBy: string;
  assignedAt: string;
  reason: string;
}

export interface NumberAssignmentConfig extends Record_ {
  numberId: string;
  roundRobinEnabled: boolean;
  fallbackUserId: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  lastAssignedUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface NumberAssignmentUser extends Record_ {
  numberId: string;
  userId: string;
  sequenceOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Stage extends Record_ {
  key: string;
  name: string;
  sequenceOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerStage extends Record_ {
  customerId: string;
  stageId: string;
  setByUserId: string;
  updatedAt: string;
}

export interface Remark extends Record_ {
  conversationId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
}

export type ReminderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface Reminder extends Record_ {
  conversationId: string;
  ownerUserId: string;
  text: string;
  dueAt: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}

/** listMyReminders' return shape — a Reminder enriched with just enough conversation/customer
 * context (in one bulk read, not per-reminder) for a cross-conversation "My Reminders" list to
 * be useful: who it's for, and which number/conversation to jump into. */
export interface ReminderWithContext extends Reminder {
  numberId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
}

export interface ConversationSnooze extends Record_ {
  conversationId: string;
  snoozedUntil: string;
  snoozedByUserId: string;
  createdAt: string;
}

// --- Phase 10/11 (templates, quick replies, media) ---

export type TemplateStatus = 'LOCAL_DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Template extends Record_ {
  wabaId: string;
  providerTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  components: unknown[];
  variables: string[];
  createdAt: string;
  updatedAt: string;
  lastSyncedAt: string;
}

export interface QuickReply extends Record_ {
  shortcut: string;
  text: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageMedia extends Record_ {
  messageId: string;
  mediaType: string;
  mediaUrl: string;
  caption: string;
}

// --- Phase 22 (location leads + Exotel click-to-call, port of Phase22Domain.gs's slice of Phase2Schemas) ---

export type LeadStatus = 'NEW' | 'ASSIGNED' | 'UNASSIGNED' | 'CALLED';

export interface Lead extends Record_ {
  name: string;
  phone: string;
  location: string;
  status: LeadStatus;
  assignedUserId: string;
  assignedAt: string;
  uploadBatchId: string;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Denormalized copy of the current leadStageAssignments row for this lead — lets
   * listLeads() return every lead's stage in one read (for the Kanban board) instead
   * of needing a separate getLeadStage() call per lead. leadStageAssignments stays
   * the source of truth (setByUserId, audit trail); this is a read-speed mirror. */
  stageId?: string;
  /** Free-form labels (e.g. "Hot", "Budget constrained", "Decision maker") an agent or
   * manager attaches to help others reading the lead understand context at a glance —
   * unlike stage there's no fixed vocabulary or admin CRUD, just per-lead tags. */
  tags?: string[];
}

export type LocationAssignmentMode = 'single' | 'round_robin' | 'manual';

export interface LocationAssignmentConfig extends Record_ {
  location: string;
  mode: LocationAssignmentMode;
  singleUserId: string;
  lastAssignedUserId: string;
  active: boolean;
  callerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocationAssignmentUser extends Record_ {
  location: string;
  userId: string;
  sequenceOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CallLog extends Record_ {
  leadId: string;
  agentUserId: string;
  exotelCallSid: string;
  agentPhone: string;
  leadPhone: string;
  callerId: string;
  status: string;
  initiatedAt: string;
  updatedAt: string;
}

export interface LeadStageAssignment extends Record_ {
  leadId: string;
  stageId: string;
  setByUserId: string;
  updatedAt: string;
}

export interface LeadRemark extends Record_ {
  leadId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
}
