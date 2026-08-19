/** Frontend-side mirror of the subset of webapp/backend/src/domain/types.ts the Inbox UI needs. Kept independent (separate package) rather than imported across the build boundary. */

export interface WhatsAppNumber {
  id: string;
  displayName: string;
  phoneNumber: string;
  active: boolean;
}

export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string;
  company: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  numberId: string;
  assignedUserId: string;
  status: 'OPEN' | 'CLOSED';
  needsResponse: boolean;
  lastMessageAt: string;
  createdAt: string;
}

export interface ConversationListItem extends Conversation {
  customerName: string;
  customerPhone: string;
}

export type MessageStatus = 'RECEIVED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNKNOWN';

export interface MessageMedia {
  mediaType: string;
  mediaUrl: string;
  caption: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderUserId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  messageType: string;
  messageText: string;
  status: MessageStatus;
  timestamp: string;
  senderName?: string | null;
  media?: MessageMedia | null;
}

export type TemplateStatus = 'LOCAL_DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface Template {
  id: string;
  wabaId: string;
  providerTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  components: { type?: string; text?: string }[];
  variables: string[];
}

export interface QuickReply {
  id: string;
  shortcut: string;
  text: string;
  active: boolean;
}

export interface Stage {
  id: string;
  key: string;
  name: string;
  sequenceOrder: number;
  active: boolean;
}

export interface CustomerStage {
  customerId: string;
  stageId: string;
  setByUserId: string;
  updatedAt: string;
}

export interface Remark {
  id: string;
  conversationId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
}

export type ReminderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface Reminder {
  id: string;
  conversationId: string;
  ownerUserId: string;
  text: string;
  dueAt: string;
  status: ReminderStatus;
}

export interface SnoozeStatus {
  snoozed: boolean;
  snoozedUntil?: string;
}

export interface AssignableUser {
  id: string;
  displayName: string;
  email: string;
}

/** Scoped realtime credentials minted by the backend (RealtimeListenApi) — a Firebase custom token, never admin access, good only for the numbers the signed-in user can already see. */
export interface RealtimeListenToken {
  token: string;
  databaseUrl: string;
  webApiKey: string;
}

export interface Workspace {
  conversation: Conversation;
  customer: Customer | null;
  number: WhatsAppNumber | null;
  messages: Message[];
  assignedUserName: string | null;
  stage: CustomerStage | null;
  remarks: Remark[] | null;
  reminders: Reminder[] | null;
  snoozeStatus: SnoozeStatus | null;
  assignableUsers: AssignableUser[];
  realtime?: RealtimeListenToken | null;
}

export interface WhoAmI {
  id: string;
  email: string;
  displayName: string;
  roleKeys: string[];
}

// --- Phase 22 (location leads + Exotel click-to-call) ---

export const LEAD_LOCATIONS = ['Raipur', 'Rajsamand', 'Coimbatore', 'Prayagraj', 'Alibaug', 'Saraighat'] as const;

export type LeadStatus = 'NEW' | 'ASSIGNED' | 'UNASSIGNED' | 'CALLED';

export interface Lead {
  id: string;
  name: string;
  phone: string;
  location: string;
  status: LeadStatus;
  assignedUserId: string;
  assignedAt: string;
  createdAt: string;
}

export type LocationAssignmentMode = 'single' | 'round_robin' | 'manual';

export interface LocationAssignmentConfig {
  id: string;
  location: string;
  mode: LocationAssignmentMode;
  singleUserId: string;
  active: boolean;
  callerId: string;
}

export interface LocationAssignmentUser {
  id: string;
  location: string;
  userId: string;
  sequenceOrder: number;
  active: boolean;
}

export interface LeadStageAssignment {
  leadId: string;
  stageId: string;
  setByUserId: string;
  updatedAt: string;
}

export interface LeadRemark {
  id: string;
  leadId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
}

export interface CallLog {
  id: string;
  leadId: string;
  agentUserId: string;
  exotelCallSid: string;
  status: string;
  initiatedAt: string;
}

export interface UploadLeadsResult {
  batchId: string;
  created: number;
  skipped: number;
  errors: { index: number; row: unknown; message: string }[];
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  status: string;
  phone: string;
  roleIds: string[];
}

// --- Phase 12 (admin panel: users, teams, numbers, number access, assignment rules, audit log) ---

export interface Role {
  id: string;
  key: string;
  name: string;
  permissions: string[];
  status: 'active' | 'inactive';
}

export interface Team {
  id: string;
  name: string;
  ownerUserId: string;
  status: 'active' | 'inactive';
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  status: 'active' | 'inactive';
  numberIds: string[];
}

export interface NumberAccess {
  id: string;
  userId: string;
  numberId: string;
  granted: boolean;
  status: 'active' | 'inactive';
}

export interface NumberAssignmentConfig {
  id: string;
  numberId: string;
  roundRobinEnabled: boolean;
  fallbackUserId: string;
  workingHoursStart: string;
  workingHoursEnd: string;
}

export interface NumberAssignmentUser {
  id: string;
  numberId: string;
  userId: string;
  sequenceOrder: number;
  active: boolean;
}

export interface SearchFilters {
  numberId?: string;
  query?: string;
  assignedUserId?: string;
  status?: string;
  needsResponse?: boolean;
  unassigned?: boolean;
}

export interface SearchResultItem extends ConversationListItem {
  numberDisplayName: string;
}

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

// --- Phase 14 (dashboard & analytics) ---

export interface ConversationSummary {
  total: number;
  open: number;
  unassigned: number;
  needsResponse: number;
  resolved: number;
}

export interface DashboardMetrics {
  conversations: ConversationSummary;
  totalCustomers: number;
  assignedToMe: number;
  byNumber: (ConversationSummary & { numberId: string; displayName: string })[];
  byAgent: { userId: string; displayName: string; open: number; needsResponse: number }[];
  responseTime: { averageFirstResponseMinutes: number | null; sampleSize: number };
  stageDistribution: { stageId: string; name: string; count: number }[];
  templateUsage: { name: string; count: number }[];
  leadConversion: { totalCustomersWithStage: number; wonCount: number; conversionRate: number | null };
}
