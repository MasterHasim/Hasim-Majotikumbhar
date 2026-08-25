/**
 * Development-only customer export for a separately supplied Zoho Function.
 *
 * This is deliberately independent from zohoCrm.ts: it never changes the production OAuth
 * Contact sync and its secret-bearing endpoint never leaves the Worker. Until the external
 * Function contract is documented and explicitly confirmed, the public route only prepares a
 * bounded payload; it does not make a network request.
 */
import { ApiError } from '../types';
import type {
  CallLog, Conversation, Customer, CustomerStage, Lead, LeadStageAssignment, Message, MessageMedia,
  Product, Quotation, Reminder, WhatsAppNumber,
} from '../domain/types';
import { Repository } from '../lib/repository';
import { AppDb } from '../lib/appDb';
import { normalizePhoneTail } from './exotelProvider';

const MAX_CONVERSATIONS = 25;
const MAX_MESSAGES_PER_CONVERSATION = 25;
const MAX_REMINDERS = 25;
const MAX_CALLS = 25;
const MAX_QUOTATIONS = 25;
const MAX_TEXT_LENGTH = 500;
const MAX_NOTE_LENGTH = 300;
/** Zoho Functions accepts up to 95,000 characters in POST form-data arguments; leave margin for multipart encoding. */
const MAX_ZOHO_ARGUMENTS_CHARACTERS = 90_000;

export interface ZohoTestFunctionConfig {
  /** Full external Function URL, including its API key query value. Must be a Worker secret. */
  ZOHO_TEST_FUNCTION_URL?: string;
  /** Must be exactly "true" before a development Worker is allowed to send a live request. */
  ZOHO_TEST_FUNCTION_CONTRACT_VERIFIED?: string;
  /** Comma-separated custom-field keys approved for this test payload. Defaults to none. */
  ZOHO_TEST_CUSTOM_FIELD_ALLOWLIST?: string;
  ENVIRONMENT: string;
}

type Preview = { value: string; truncated: boolean };

function preview(value: string, max: number): Preview {
  const chars = Array.from(value || '');
  return { value: chars.slice(0, max).join(''), truncated: chars.length > max };
}

function newestFirst<T extends { createdAt?: string; updatedAt?: string; timestamp?: string; initiatedAt?: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => String(b.updatedAt || b.timestamp || b.initiatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.timestamp || a.initiatedAt || a.createdAt || '')));
}

/** The bounded, allowlisted payload shape sent to the testing Function. No auth/security fields or unbounded content are represented. */
export interface CustomerSyncTestPayload {
  schemaVersion: 'customer-sync-test-v1';
  event: { type: 'customer.manual_test_sync'; occurredAt: string; source: 'firebase-realtime-database'; environment: string };
  customer: Customer;
  customerStage: CustomerStage | null;
  relatedLeads: Array<{ relationship: { matchMethod: 'normalized_phone_tail'; customerId: string; leadId: string }; lead: Lead; stageAssignment: LeadStageAssignment | null }>;
  conversations: Array<{
    id: string; customerId: string; numberId: string; assignedUserId: string; status: Conversation['status']; needsResponse: boolean;
    lastMessageAt: string; lastCustomerMessageAt?: string; interestedProductIds?: string[]; createdAt: string; updatedAt: string;
    whatsAppNumber: Pick<WhatsAppNumber, 'id' | 'displayName' | 'phoneNumber' | 'active'> | null;
    messageSummary: { totalCount: number; inboundCount: number; outboundCount: number; latestMessageAt: string | null };
    recentMessages: Array<{
      id: string; conversationId: string; numberId: string; senderUserId: string; direction: Message['direction']; messageType: string;
      messageTextPreview: string; messageTextTruncated: boolean; providerMessageId: string; status: Message['status']; timestamp: string;
      templateName?: string; referral?: { headline?: string; bodyPreview?: string; bodyTruncated?: boolean; mediaType?: string };
      media?: { id: string; messageId: string; mediaType: string; captionPreview: string; captionTruncated: boolean };
    }>;
    reminders: Array<{ id: string; conversationId?: string; ownerUserId: string; textPreview: string; textTruncated: boolean; dueAt: string; status: Reminder['status']; createdAt: string; updatedAt: string }>;
    calls: Array<Omit<CallLog, 'agentPhone' | 'leadPhone' | 'callerId' | 'recordingUrl'>>;
    interestedProducts: Product[];
  }>;
  leadReminders: Array<{ id: string; leadId?: string; ownerUserId: string; textPreview: string; textTruncated: boolean; dueAt: string; status: Reminder['status']; createdAt: string; updatedAt: string }>;
  quotations: Array<Omit<Quotation, 'notes'> & { notesPreview: string; notesTruncated: boolean }>;
  limits: { conversations: number; messagesPerConversation: number; reminders: number; calls: number; quotations: number; messageTextCharacters: number; noteCharacters: number };
}

export interface ZohoTestSyncResult {
  status: 'prepared' | 'sent';
  customerId: string;
  summary: { relatedLeads: number; conversations: number; messages: number; reminders: number; calls: number; quotations: number };
}

function approvedCustomFields(values: Record<string, string | number> | undefined, allowedKeys: ReadonlySet<string>): Record<string, string | number> | undefined {
  if (!values || allowedKeys.size === 0) return undefined;
  const result = Object.fromEntries(Object.entries(values).filter(([key]) => allowedKeys.has(key)));
  return Object.keys(result).length ? result : undefined;
}

function safeCustomer(customer: Customer, allowedKeys: ReadonlySet<string>): Customer {
  const customFields = approvedCustomFields(customer.customFields, allowedKeys);
  return { id: customer.id, phone: customer.phone, name: customer.name, email: customer.email, company: customer.company, source: customer.source, createdAt: customer.createdAt, updatedAt: customer.updatedAt, ...(customer.tags ? { tags: [...customer.tags] } : {}), ...(customFields ? { customFields } : {}), ...(customer.zohoContactId ? { zohoContactId: customer.zohoContactId } : {}) };
}

function safeLead(lead: Lead, allowedKeys: ReadonlySet<string>): Lead {
  const customFields = approvedCustomFields(lead.customFields, allowedKeys);
  return { id: lead.id, name: lead.name, phone: lead.phone, location: lead.location, status: lead.status, assignedUserId: lead.assignedUserId, assignedAt: lead.assignedAt, uploadBatchId: lead.uploadBatchId, uploadedBy: lead.uploadedBy, createdAt: lead.createdAt, updatedAt: lead.updatedAt, ...(lead.stageId ? { stageId: lead.stageId } : {}), ...(lead.tags ? { tags: [...lead.tags] } : {}), ...(customFields ? { customFields } : {}) };
}

function safeProduct(product: Product): Product {
  return { id: product.id, numberId: product.numberId, name: product.name, sku: product.sku, unitPrice: product.unitPrice, description: product.description, active: product.active, sequenceOrder: product.sequenceOrder, createdAt: product.createdAt, updatedAt: product.updatedAt };
}

export async function buildCustomerSyncTestPayload(db: AppDb, customerId: string, environment: string, allowedCustomFieldKeys: readonly string[] = []): Promise<CustomerSyncTestPayload> {
  const customers = new Repository<Customer>(db, 'customers');
  const customer = await customers.get(customerId);
  if (!customer) throw new ApiError(404, 'NOT_FOUND', 'Customer was not found.');
  const allowedCustomFields = new Set(allowedCustomFieldKeys);

  const [customerStage, allConversations, allMessages, allMedia, allLeads, allLeadStages, allReminders, allCalls, allProducts, allQuotations, allNumbers] = await Promise.all([
    new Repository<CustomerStage>(db, 'customerStages').get(customerId),
    new Repository<Conversation>(db, 'webapp_conversations').list(),
    new Repository<Message>(db, 'webapp_messages').list(),
    new Repository<MessageMedia>(db, 'messageMedia').list(),
    new Repository<Lead>(db, 'leads').list(),
    new Repository<LeadStageAssignment>(db, 'leadStageAssignments').list(),
    new Repository<Reminder>(db, 'reminders').list(),
    new Repository<CallLog>(db, 'callLog').list(),
    new Repository<Product>(db, 'products').list(),
    new Repository<Quotation>(db, 'quotations').list(),
    new Repository<WhatsAppNumber>(db, 'numbers').list(),
  ]);

  const customerTail = normalizePhoneTail(customer.phone);
  const relatedLeads = allLeads
    .filter((lead) => !!customerTail && normalizePhoneTail(lead.phone) === customerTail)
    .map((lead) => ({
      relationship: { matchMethod: 'normalized_phone_tail' as const, customerId: customer.id, leadId: lead.id },
      lead: safeLead(lead, allowedCustomFields),
      stageAssignment: allLeadStages.find((stage) => stage.leadId === lead.id) ?? null,
    }));
  const leadIds = new Set(relatedLeads.map(({ lead }) => lead.id));
  const numberById = new Map(allNumbers.map((number) => [number.id, number]));
  const mediaByMessageId = new Map(allMedia.map((media) => [media.messageId, media]));
  const productById = new Map(allProducts.map((product) => [product.id, product]));

  const conversations = newestFirst(allConversations.filter((conversation) => conversation.customerId === customer.id))
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => {
      const messages = newestFirst(allMessages.filter((message) => message.conversationId === conversation.id));
      const recentMessages = messages.slice(0, MAX_MESSAGES_PER_CONVERSATION).map((message) => {
        const text = preview(message.messageText, MAX_TEXT_LENGTH);
        const media = mediaByMessageId.get(message.id);
        const referralBody = message.referral?.body ? preview(message.referral.body, MAX_NOTE_LENGTH) : null;
        return {
          id: message.id, conversationId: message.conversationId, numberId: message.numberId, senderUserId: message.senderUserId,
          direction: message.direction, messageType: message.messageType, messageTextPreview: text.value, messageTextTruncated: text.truncated,
          providerMessageId: message.providerMessageId, status: message.status, timestamp: message.timestamp,
          ...(message.templateName ? { templateName: message.templateName } : {}),
          ...(message.referral ? { referral: { headline: message.referral.headline, ...(referralBody ? { bodyPreview: referralBody.value, bodyTruncated: referralBody.truncated } : {}), mediaType: message.referral.mediaType } } : {}),
          ...(media ? (() => { const caption = preview(media.caption, MAX_NOTE_LENGTH); return { media: { id: media.id, messageId: media.messageId, mediaType: media.mediaType, captionPreview: caption.value, captionTruncated: caption.truncated } }; })() : {}),
        };
      });
      const reminders = newestFirst(allReminders.filter((reminder) => reminder.conversationId === conversation.id))
        .slice(0, MAX_REMINDERS)
        .map((reminder) => {
          const text = preview(reminder.text, MAX_NOTE_LENGTH);
          return { id: reminder.id, conversationId: reminder.conversationId, ownerUserId: reminder.ownerUserId, textPreview: text.value, textTruncated: text.truncated, dueAt: reminder.dueAt, status: reminder.status, createdAt: reminder.createdAt, updatedAt: reminder.updatedAt };
        });
      const calls = newestFirst(allCalls.filter((call) => call.conversationId === conversation.id || call.leadPhone === customer.phone))
        .slice(0, MAX_CALLS)
        .map((call) => ({ id: call.id, leadId: call.leadId, agentUserId: call.agentUserId, exotelCallSid: call.exotelCallSid, status: call.status, initiatedAt: call.initiatedAt, updatedAt: call.updatedAt, ...(call.conversationId ? { conversationId: call.conversationId } : {}), ...(call.numberId ? { numberId: call.numberId } : {}), ...(call.duration !== undefined ? { duration: call.duration } : {}), ...(call.endedAt ? { endedAt: call.endedAt } : {}) }));
      const interestedProducts = (conversation.interestedProductIds || []).map((id) => productById.get(id)).filter((product): product is Product => !!product).map(safeProduct);
      const number = numberById.get(conversation.numberId);
      return {
        id: conversation.id, customerId: conversation.customerId, numberId: conversation.numberId, assignedUserId: conversation.assignedUserId,
        status: conversation.status, needsResponse: conversation.needsResponse, lastMessageAt: conversation.lastMessageAt,
        ...(conversation.lastCustomerMessageAt ? { lastCustomerMessageAt: conversation.lastCustomerMessageAt } : {}),
        ...(conversation.interestedProductIds ? { interestedProductIds: conversation.interestedProductIds } : {}),
        createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
        whatsAppNumber: number ? { id: number.id, displayName: number.displayName, phoneNumber: number.phoneNumber, active: number.active } : null,
        messageSummary: { totalCount: messages.length, inboundCount: messages.filter((message) => message.direction === 'INBOUND').length, outboundCount: messages.filter((message) => message.direction === 'OUTBOUND').length, latestMessageAt: messages[0]?.timestamp ?? null },
        recentMessages, reminders, calls, interestedProducts,
      };
    });

  const leadReminders = newestFirst(allReminders.filter((reminder) => !!reminder.leadId && leadIds.has(reminder.leadId)))
    .slice(0, MAX_REMINDERS)
    .map((reminder) => {
      const text = preview(reminder.text, MAX_NOTE_LENGTH);
      return { id: reminder.id, leadId: reminder.leadId, ownerUserId: reminder.ownerUserId, textPreview: text.value, textTruncated: text.truncated, dueAt: reminder.dueAt, status: reminder.status, createdAt: reminder.createdAt, updatedAt: reminder.updatedAt };
    });
  const quotations = newestFirst(allQuotations.filter((quotation) => leadIds.has(quotation.leadId))).slice(0, MAX_QUOTATIONS)
    .map((quotation) => {
      const note = preview(quotation.notes, MAX_NOTE_LENGTH);
      return { id: quotation.id, leadId: quotation.leadId, numberId: quotation.numberId, lineItems: quotation.lineItems.map((item) => ({ productId: item.productId, productName: item.productName, unitPrice: item.unitPrice, quantity: item.quantity, discountPercent: item.discountPercent })), overallDiscountPercent: quotation.overallDiscountPercent, status: quotation.status, createdByUserId: quotation.createdByUserId, createdAt: quotation.createdAt, updatedAt: quotation.updatedAt, ...(quotation.sentAt ? { sentAt: quotation.sentAt } : {}), notesPreview: note.value, notesTruncated: note.truncated };
    });

  return {
    schemaVersion: 'customer-sync-test-v1',
    event: { type: 'customer.manual_test_sync', occurredAt: new Date().toISOString(), source: 'firebase-realtime-database', environment },
    customer: safeCustomer(customer, allowedCustomFields), customerStage: customerStage ? { id: customerStage.id, customerId: customerStage.customerId, stageId: customerStage.stageId, setByUserId: customerStage.setByUserId, updatedAt: customerStage.updatedAt } : null, relatedLeads, conversations, leadReminders, quotations,
    limits: { conversations: MAX_CONVERSATIONS, messagesPerConversation: MAX_MESSAGES_PER_CONVERSATION, reminders: MAX_REMINDERS, calls: MAX_CALLS, quotations: MAX_QUOTATIONS, messageTextCharacters: MAX_TEXT_LENGTH, noteCharacters: MAX_NOTE_LENGTH },
  };
}

function safeSummary(payload: CustomerSyncTestPayload): ZohoTestSyncResult['summary'] {
  return {
    relatedLeads: payload.relatedLeads.length,
    conversations: payload.conversations.length,
    messages: payload.conversations.reduce((sum, conversation) => sum + conversation.recentMessages.length, 0),
    reminders: payload.leadReminders.length + payload.conversations.reduce((sum, conversation) => sum + conversation.reminders.length, 0),
    calls: payload.conversations.reduce((sum, conversation) => sum + conversation.calls.length, 0),
    quotations: payload.quotations.length,
  };
}

/**
 * Isolated for a mocked test. Zoho Functions APIs accept POST arguments as multipart form-data.
 * DashboardReq's verified Deluge signature is `string crmAPIRequest`, so its one function
 * argument carries the serialized payload; it then emails that string internally.
 */
export async function sendCustomerSyncTestPayload(payload: CustomerSyncTestPayload, secretBearingUrl: string): Promise<void> {
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_ZOHO_ARGUMENTS_CHARACTERS) {
    throw new ApiError(413, 'ZOHO_TEST_PAYLOAD_TOO_LARGE', `Zoho Function arguments exceed the ${MAX_ZOHO_ARGUMENTS_CHARACTERS}-character safety limit.`);
  }
  const form = new FormData();
  form.set('arguments', JSON.stringify({ crmAPIRequest: serialized }));
  const response = await fetch(secretBearingUrl, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: form,
  });
  if (!response.ok) throw new ApiError(502, 'ZOHO_TEST_FUNCTION_FAILED', `Zoho test Function returned HTTP ${response.status}.`);
}

/** Builds locally in every development environment; only sends after the undocumented external contract is explicitly confirmed. */
export async function syncCustomerToZohoTestFunction(db: AppDb, customerId: string, env: ZohoTestFunctionConfig): Promise<ZohoTestSyncResult> {
  if (env.ENVIRONMENT !== 'development') throw new ApiError(403, 'FORBIDDEN', 'Zoho test Function sync is available only in development.');
  const allowedCustomFields = (env.ZOHO_TEST_CUSTOM_FIELD_ALLOWLIST || '').split(',').map((key) => key.trim()).filter(Boolean);
  const payload = await buildCustomerSyncTestPayload(db, customerId, env.ENVIRONMENT, allowedCustomFields);
  const summary = safeSummary(payload);
  if (env.ZOHO_TEST_FUNCTION_CONTRACT_VERIFIED !== 'true') return { status: 'prepared', customerId: payload.customer.id, summary };
  if (!env.ZOHO_TEST_FUNCTION_URL) throw new ApiError(500, 'CONFIGURATION_ERROR', 'ZOHO_TEST_FUNCTION_URL is not configured.');
  await sendCustomerSyncTestPayload(payload, env.ZOHO_TEST_FUNCTION_URL);
  return { status: 'sent', customerId: payload.customer.id, summary };
}
