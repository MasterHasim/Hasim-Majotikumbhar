import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Repository } from '../src/lib/repository';
import type { CallLog, Conversation, Customer, CustomerStage, Lead, LeadStageAssignment, Message, MessageMedia, Product, Quotation, Reminder, WhatsAppNumber } from '../src/domain/types';
import { buildCustomerSyncTestPayload, sendCustomerSyncTestPayload, syncCustomerToZohoTestFunction } from '../src/services/zohoTestFunction';

describe('development-only Zoho Function customer payload', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
  });
  afterEach(() => mock.restore());

  async function seedCustomerGraph() {
    const customer: Customer = { id: 'customer-1', phone: '+919876543210', name: 'Asha Patel', email: 'asha@example.com', company: 'ECHT', source: 'whatsapp', tags: ['Hot'], customFields: { campaign_name: 'Monsoon' }, zohoContactId: 'production-contact-1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
    await new Repository<Customer>(db, 'customers').create(customer);
    await new Repository<CustomerStage>(db, 'customerStages').create({ id: customer.id, customerId: customer.id, stageId: 'stage-1', setByUserId: 'user-admin', updatedAt: '2026-01-02T00:00:00.000Z' });
    await new Repository<WhatsAppNumber>(db, 'numbers').create({ id: 'number-1', displayName: 'Raipur', phoneNumber: '+917948502801', provider: 'exotel', providerAccountId: 'internal-provider-account', wabaId: 'internal-waba', providerNumberId: 'internal-provider-number', active: true, createdAt: '', updatedAt: '' });
    const lead: Lead = { id: 'lead-1', name: 'Asha Patel', phone: '9876543210', location: 'Raipur', status: 'CALLED', assignedUserId: 'user-agent', assignedAt: '2026-01-02T00:00:00.000Z', uploadBatchId: 'batch-1', uploadedBy: 'whatsapp', stageId: 'stage-1', tags: ['Hot'], customFields: { campaign_name: 'Monsoon' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
    await new Repository<Lead>(db, 'leads').create(lead);
    await new Repository<LeadStageAssignment>(db, 'leadStageAssignments').create({ id: lead.id, leadId: lead.id, stageId: 'stage-1', setByUserId: 'user-agent', updatedAt: '2026-01-02T00:00:00.000Z' });
    const conversation: Conversation = { id: 'conversation-1', customerId: customer.id, numberId: 'number-1', assignedUserId: 'user-agent', status: 'OPEN', needsResponse: true, lastMessageAt: '2026-01-02T12:00:00.000Z', lastCustomerMessageAt: '2026-01-02T11:00:00.000Z', interestedProductIds: ['product-1'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T12:00:00.000Z' };
    await new Repository<Conversation>(db, 'webapp_conversations').create(conversation);
    const messages = new Repository<Message>(db, 'webapp_messages');
    for (let i = 0; i < 26; i++) await messages.create({ id: `message-${i}`, conversationId: conversation.id, numberId: conversation.numberId, senderUserId: '', direction: 'INBOUND', messageType: 'text', messageText: `message-${i}-${'x'.repeat(600)}`, providerMessageId: `provider-${i}`, status: 'RECEIVED', timestamp: `2026-01-02T12:${String(i).padStart(2, '0')}:00.000Z` });
    await new Repository<MessageMedia>(db, 'messageMedia').create({ id: 'media-1', messageId: 'message-25', mediaType: 'image', mediaUrl: 'https://private.example/media-secret', caption: `caption-${'y'.repeat(400)}` });
    const reminders = new Repository<Reminder>(db, 'reminders');
    for (let i = 0; i < 26; i++) await reminders.create({ id: `conversation-reminder-${i}`, conversationId: conversation.id, ownerUserId: 'user-agent', text: `reminder-${'z'.repeat(400)}`, dueAt: `2026-01-${String((i % 9) + 1).padStart(2, '0')}T00:00:00.000Z`, status: 'PENDING', createdAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z` });
    await reminders.create({ id: 'lead-reminder-1', leadId: lead.id, ownerUserId: 'user-agent', text: 'Lead follow-up', dueAt: '2026-01-03T00:00:00.000Z', status: 'PENDING', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' });
    await new Repository<CallLog>(db, 'callLog').create({ id: 'call-1', leadId: '', conversationId: conversation.id, numberId: conversation.numberId, agentUserId: 'user-agent', exotelCallSid: 'provider-call-1', agentPhone: '+919111111111', leadPhone: customer.phone, callerId: '+917948502801', status: 'completed', initiatedAt: '2026-01-02T10:00:00.000Z', updatedAt: '2026-01-02T10:04:00.000Z', duration: 240, recordingUrl: 'https://private.example/recording', endedAt: '2026-01-02T10:04:00.000Z' });
    await new Repository<Product>(db, 'products').create({ id: 'product-1', numberId: conversation.numberId, name: 'Solar Kit', sku: 'SOL-1', unitPrice: 25000, description: 'Solar product', active: true, sequenceOrder: 1, createdAt: '', updatedAt: '' });
    await new Repository<Quotation>(db, 'quotations').create({ id: 'quotation-1', leadId: lead.id, numberId: conversation.numberId, lineItems: [{ productId: 'product-1', productName: 'Solar Kit', unitPrice: 25000, quantity: 1, discountPercent: 0 }], overallDiscountPercent: 0, notes: `note-${'n'.repeat(400)}`, status: 'SENT', createdByUserId: 'user-agent', createdAt: '2026-01-02T09:00:00.000Z', updatedAt: '2026-01-02T09:00:00.000Z', sentAt: '2026-01-02T09:00:00.000Z' });
    return customer;
  }

  it('builds the complete bounded graph with Firebase ids while excluding sensitive fields and large content', async () => {
    await seedCustomerGraph();
    const payload = await buildCustomerSyncTestPayload(db, 'customer-1', 'development');
    const json = JSON.stringify(payload);

    expect(payload.schemaVersion).toBe('customer-sync-test-v1');
    expect(payload.customer.id).toBe('customer-1');
    expect(payload.relatedLeads[0]?.relationship).toEqual({ matchMethod: 'normalized_phone_tail', customerId: 'customer-1', leadId: 'lead-1' });
    expect(payload.conversations[0]?.recentMessages).toHaveLength(25);
    expect(payload.conversations[0]?.recentMessages[0]?.messageTextPreview).toHaveLength(500);
    expect(payload.conversations[0]?.reminders).toHaveLength(25);
    expect(payload.conversations[0]?.recentMessages[0]?.media?.captionPreview).toHaveLength(300);
    expect(payload.quotations[0]?.notesPreview).toHaveLength(300);
    expect(payload.conversations[0]?.interestedProducts[0]?.id).toBe('product-1');
    expect(json).not.toContain('internal-provider-account');
    expect(json).not.toContain('internal-waba');
    expect(json).not.toContain('internal-provider-number');
    expect(json).not.toContain('private.example/media-secret');
    expect(json).not.toContain('private.example/recording');
    expect(json).not.toContain('+919111111111');
    expect(json).not.toContain('callerId');
    expect(json).not.toContain('leadPhone');
  });

  it('prepares without a network request until the Zoho Function contract is explicitly verified', async () => {
    await seedCustomerGraph();
    const originalFetch = globalThis.fetch;
    let sent = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).startsWith('https://test-function.example/')) sent = true;
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      const result = await syncCustomerToZohoTestFunction(db, 'customer-1', { ENVIRONMENT: 'development', ZOHO_TEST_FUNCTION_URL: 'https://test-function.example/execute?secret=fake', ZOHO_TEST_FUNCTION_CONTRACT_VERIFIED: 'false' });
      expect(result.status).toBe('prepared');
      expect(result.customerId).toBe('customer-1');
      expect(result.summary).toMatchObject({ relatedLeads: 1, conversations: 1, messages: 25, quotations: 1 });
      expect(sent).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('uses POST multipart form-data with the Zoho-required arguments wrapper when the isolated request sender is invoked by a verified test harness', async () => {
    await seedCustomerGraph();
    const payload = await buildCustomerSyncTestPayload(db, 'customer-1', 'development');
    const originalFetch = globalThis.fetch;
    let request: Request | null = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === 'https://test-function.example/execute?secret=fake') {
        request = new Request(input, init);
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      await sendCustomerSyncTestPayload(payload, 'https://test-function.example/execute?secret=fake');
      expect(request?.method).toBe('POST');
      expect(request?.headers.get('Content-Type')).toContain('multipart/form-data');
      expect(request?.headers.get('Accept')).toBe('application/json');
      const argumentsEnvelope = JSON.parse(String((await request?.formData()).get('arguments')));
      expect(JSON.parse(argumentsEnvelope.crmAPIRequest).schemaVersion).toBe('customer-sync-test-v1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
