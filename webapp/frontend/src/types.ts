/** Frontend-side mirror of the subset of webapp/backend/src/domain/types.ts the Inbox UI needs. Kept independent (separate package) rather than imported across the build boundary. */

export interface WhatsAppNumber {
  id: string;
  displayName: string;
  phoneNumber: string;
  active: boolean;
  wabaId?: string;
}

export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string;
  company: string;
  tags?: string[];
  customFields?: Record<string, string | number>;
}

export interface Conversation {
  id: string;
  customerId: string;
  numberId: string;
  assignedUserId: string;
  status: 'OPEN' | 'CLOSED';
  needsResponse: boolean;
  lastMessageAt: string;
  /** Anchor for WhatsApp's 24-hour customer service window — see backend Conversation type. */
  lastCustomerMessageAt?: string;
  /** Product IDs (from this number's catalog) the customer has expressed interest in during this conversation. */
  interestedProductIds?: string[];
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

/** Best-effort Meta "Click-to-WhatsApp" ad context on an inbound message — populated only
 * when the customer tapped through from a Facebook/Instagram ad. Shape is unverified against
 * real Exotel traffic (Meta documents it, Exotel doesn't) so treat missing fields as normal. */
export interface MessageReferral {
  headline?: string;
  body?: string;
  sourceUrl?: string;
  mediaType?: string;
  imageUrl?: string;
  videoUrl?: string;
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
  referral?: MessageReferral | null;
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

/** Attaches to exactly one of conversationId/leadId (never both) — extended 2026-08-24 so a
 * sales follow-up can be set on a Lead directly, before any WhatsApp conversation exists. */
export interface Reminder {
  id: string;
  conversationId?: string;
  leadId?: string;
  ownerUserId: string;
  text: string;
  dueAt: string;
  status: ReminderStatus;
}

export interface SnoozeStatus {
  snoozed: boolean;
  snoozedUntil?: string;
}

/** listMyReminders' return shape — a Reminder enriched with who it's for and where to jump
 * to, computed server-side in one bulk read. Conversation-context fields are set for a
 * conversation-attached reminder, lead-context fields for a lead-attached one — never both. */
export interface ReminderWithContext extends Reminder {
  numberId?: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  leadName?: string;
  leadPhone?: string;
  leadLocation?: string;
}

/** Account-wide Auto Dialer on/off switches (Admin → Auto Dialer). */
export interface AutoDialerSettings {
  missedCallReminderEnabled: boolean;
  callPromptEnabled: boolean;
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
  calls: CallLog[] | null;
  /** The Leads-side record for this same phone number, if one exists (matched by phone tail) —
   * Leads and Customers are separate entities that happen to share a phone number, not a formal
   * relationship, so this is best-effort context (location, custom fields), not an authoritative link. */
  matchingLead: Pick<Lead, 'id' | 'name' | 'location' | 'customFields'> | null;
  realtime?: RealtimeListenToken | null;
}

export interface WhoAmI {
  id: string;
  email: string;
  displayName: string;
  roleKeys: string[];
}

export type AvailabilityStatus = 'available' | 'busy' | 'offline' | 'on_leave';

export interface Availability {
  userId: string;
  status: AvailabilityStatus;
}

// --- Phase 22 (location leads + Exotel click-to-call) ---

// Keep in sync with backend's Phase22Locations (src/domain/phase22.ts) — one per registered
// WhatsApp Number, so every number's conversations can fall under a real Lead.
export const LEAD_LOCATIONS = [
  'Raipur', 'Rajsamand', 'Coimbatore', 'Prayagraj', 'Alibaug', 'Saraighat', 'ECHT Marine',
  'Compliances', 'Entartica Partner Desk', 'Entartica CRM',
] as const;

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
  /** Denormalized on the lead record when setLeadStage is called — see backend Lead type. */
  stageId?: string;
  tags?: string[];
  customFields?: Record<string, string | number>;
}

/** 'campaign' behaves exactly like 'text' for storage — the editor renders a dropdown fetched
 * live from currently-active Meta campaigns (backendApi.listActiveCampaigns) instead of a
 * static admin-authored options list like 'select' uses. */
export type CustomFieldType = 'text' | 'number' | 'select' | 'date' | 'campaign';
export type CustomFieldEntityType = 'lead' | 'customer';

export interface CustomFieldDefinition {
  id: string;
  entityType: CustomFieldEntityType;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  active: boolean;
  sequenceOrder: number;
}

export interface Product {
  id: string;
  numberId: string;
  name: string;
  sku: string;
  unitPrice: number;
  description: string;
  active: boolean;
  sequenceOrder: number;
}

export interface QuotationLineItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  discountPercent: number;
}

export type QuotationStatus = 'DRAFT' | 'SENT';

export interface Quotation {
  id: string;
  leadId: string;
  numberId: string;
  lineItems: QuotationLineItem[];
  overallDiscountPercent: number;
  notes: string;
  status: QuotationStatus;
  createdAt: string;
  sentAt?: string;
}

export interface PublicQuotationView {
  id: string;
  leadName: string;
  numberDisplayName: string;
  lineItems: QuotationLineItem[];
  overallDiscountPercent: number;
  notes: string;
  createdAt: string;
  totals: { subtotal: number; overallDiscountAmount: number; total: number };
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
  leadPhone: string;
  status: string;
  initiatedAt: string;
  conversationId?: string;
  numberId?: string;
}

export interface CallLogWithContext extends CallLog {
  agentName: string;
  subjectName: string;
  subjectLocation?: string;
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

export interface AssignmentEligibility {
  id: string;
  userId: string;
  numberId: string;
  teamId: string;
  eligible: boolean;
  updatedAt: string;
}

/** getAssignmentEligibility's live evaluation — combines the eligible grant with
 * availability, number access, and team enablement so a manager can see not just
 * "is eligibility granted" but "would this agent actually get the next conversation." */
export interface AssignmentEligibilityStatus {
  assignmentEligible: boolean;
  availability: string | null;
  assignableNow: boolean;
  reasons: string[];
}

export interface SearchFilters {
  numberId?: string;
  query?: string;
  assignedUserId?: string;
  status?: string;
  needsResponse?: boolean;
  unassigned?: boolean;
  customerId?: string;
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

export interface AuditEntryWithActor extends AuditEntry {
  actorName: string;
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

export type AdPlatform = 'meta';

export interface AdAccount {
  id: string;
  platform: AdPlatform;
  name: string;
  externalAccountId: string;
  active: boolean;
}

export interface AdInsightRow {
  campaignName: string;
  spend: number;
  reach: number;
  messagesInitiated: number;
  isTotal?: boolean;
}

export interface AdInsights {
  platform: string;
  rows: AdInsightRow[];
}

export interface LeadFunnel {
  stages: { stageId: string; name: string; sequenceOrder: number; count: number; pctOfTotal: number | null; pctOfFirstStage: number | null }[];
  noStage: number;
  total: number;
}

/** getHomeMetrics()'s return shape — the Home page's cross-location counterpart to
 * DashboardMetrics, covering factors Dashboard doesn't (where leads come from, whether calls
 * connect, sales pipeline value). */
export interface HomeMetrics {
  leadsByLocation: { location: string; count: number }[];
  callOutcomes: { label: string; count: number }[];
  quotationPipeline: { status: string; count: number; totalValue: number }[];
}
