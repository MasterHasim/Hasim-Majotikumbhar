import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Phase1Api } from '../src/services/phase1Api';
import { Phase3Api } from '../src/services/phase3Api';
import { Phase4Api } from '../src/services/phase4Api';
import { Phase6Api } from '../src/services/phase6Api';
import { Phase10Api } from '../src/services/phase10Api';
import { Phase11Api } from '../src/services/phase11Api';
import { WorkspaceApi } from '../src/services/workspaceApi';
import { Roles } from '../src/domain/phase1';

const ADMIN_EMAIL = 'admin@example.com';
const AGENT_EMAIL = 'agent@example.com';

describe('Phase10Api / Phase11Api / Phase6Api template+media additions', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;
  let agentId: string;
  let numberId: string;

  beforeEach(async () => {
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);

    await new Phase1Api(db, ADMIN_EMAIL).bootstrap({ email: ADMIN_EMAIL, displayName: 'Admin' }, ADMIN_EMAIL, ADMIN_EMAIL);
    const roles = await new Phase1Api(db, ADMIN_EMAIL).listRoles();
    const agentRoleId = roles.find((r) => r.key === Roles.AGENT)!.id;
    const agent = await new Phase1Api(db, ADMIN_EMAIL).createUser({ email: AGENT_EMAIL, displayName: 'Agent', roleIds: [] });
    agentId = agent.id;
    await new Phase1Api(db, ADMIN_EMAIL).updateUser(agentId, { roleIds: [agentRoleId] });

    const number = await new Phase3Api(db, ADMIN_EMAIL).createNumber({ displayName: 'Test Number', phoneNumber: '079-485-02801', provider: 'exotel' });
    numberId = number.id;
    await new Phase1Api(db, ADMIN_EMAIL).grantNumberAccess({ userId: agentId, numberId });
  });

  afterEach(() => mock.restore());

  describe('Phase10Api — templates', () => {
    it('drafts, edits, and denies a non-manager', async () => {
      const draft = await new Phase10Api(db, ADMIN_EMAIL).createDraftTemplate({ name: 'welcome', language: 'en', category: 'MARKETING' });
      expect(draft.status).toBe('LOCAL_DRAFT');
      const updated = await new Phase10Api(db, ADMIN_EMAIL).updateDraftTemplate(draft.id, { wabaId: 'waba-1' });
      expect(updated.wabaId).toBe('waba-1');
      await expect(new Phase10Api(db, AGENT_EMAIL).createDraftTemplate({ name: 'x', language: 'en', category: 'MARKETING' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('rejects editing a template that is no longer LOCAL_DRAFT', async () => {
      const draft = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).createDraftTemplate({ name: 'welcome', language: 'en', category: 'MARKETING', wabaId: 'waba-1' });
      await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).submitTemplateForReview(draft.id);
      await expect(new Phase10Api(db, ADMIN_EMAIL).updateDraftTemplate(draft.id, { name: 'x' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('submits a draft for review and moves it to PENDING', async () => {
      const draft = await new Phase10Api(db, ADMIN_EMAIL).createDraftTemplate({ name: 'welcome', language: 'en', category: 'MARKETING', wabaId: 'waba-1' });
      const submitted = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).submitTemplateForReview(draft.id);
      expect(submitted.status).toBe('PENDING');
      expect(mock.exotelCalls.some((c) => c.path === 'templates')).toBe(true);
    });

    it('rejects submitting without a wabaId', async () => {
      const draft = await new Phase10Api(db, ADMIN_EMAIL).createDraftTemplate({ name: 'welcome', language: 'en', category: 'MARKETING' });
      await expect(new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).submitTemplateForReview(draft.id)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('syncs templates from the provider, creating new and updating existing by providerTemplateId', async () => {
      mock.setNextExotelResponse(200, { response: { whatsapp: { templates: [{ data: { id: 'ptpl-1', name: 'greet', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [] } }] } } });
      const first = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).syncTemplatesFromProvider('waba-1');
      expect(first).toHaveLength(1);
      expect(first[0]!.status).toBe('APPROVED');

      mock.setNextExotelResponse(200, { response: { whatsapp: { templates: [{ data: { id: 'ptpl-1', name: 'greet', language: 'en', category: 'UTILITY', status: 'REJECTED', components: [] } }] } } });
      const second = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).syncTemplatesFromProvider('waba-1');
      expect(second).toHaveLength(1);
      expect(second[0]!.id).toBe(first[0]!.id); // same local record, upserted
      expect(second[0]!.status).toBe('REJECTED');
    });

    it('listTemplates/getTemplate are readable by any authenticated user', async () => {
      const draft = await new Phase10Api(db, ADMIN_EMAIL).createDraftTemplate({ name: 'welcome', language: 'en', category: 'MARKETING' });
      const list = await new Phase10Api(db, AGENT_EMAIL).listTemplates();
      expect(list.map((t) => t.id)).toContain(draft.id);
      const fetched = await new Phase10Api(db, AGENT_EMAIL).getTemplate(draft.id);
      expect(fetched.id).toBe(draft.id);
    });

    it('updateTemplateVariableLabels sets per-placeholder labels on an APPROVED template (unlike updateDraftTemplate, not restricted to LOCAL_DRAFT), enforces the label count matches the placeholder count, and denies a non-manager', async () => {
      mock.setNextExotelResponse(200, { response: { whatsapp: { templates: [{ data: { id: 'ptpl-2', name: 'greet', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, your order {{2}} is ready.' }] } }] } } });
      const [synced] = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).syncTemplatesFromProvider('waba-1');

      const labeled = await new Phase10Api(db, ADMIN_EMAIL).updateTemplateVariableLabels(synced!.id, ['Customer Name', 'Order ID']);
      expect(labeled.variables).toEqual(['Customer Name', 'Order ID']);
      expect(labeled.status).toBe('APPROVED'); // still approved — labels don't touch template content/status

      await expect(new Phase10Api(db, ADMIN_EMAIL).updateTemplateVariableLabels(synced!.id, ['Only One'])).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      await expect(new Phase10Api(db, AGENT_EMAIL).updateTemplateVariableLabels(synced!.id, ['Customer Name', 'Order ID'])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('Phase11Api — quick replies', () => {
    it('creates, denies non-manager, rejects duplicate shortcut', async () => {
      const qr = await new Phase11Api(db, ADMIN_EMAIL).createQuickReply({ shortcut: '/hi', text: 'Hello there!' });
      expect(qr.active).toBe(true);
      await expect(new Phase11Api(db, AGENT_EMAIL).createQuickReply({ shortcut: '/bye', text: 'Bye' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(new Phase11Api(db, ADMIN_EMAIL).createQuickReply({ shortcut: '/hi', text: 'Dup' })).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('lists only active quick replies, sorted by shortcut, for any authenticated user', async () => {
      await new Phase11Api(db, ADMIN_EMAIL).createQuickReply({ shortcut: '/zeta', text: 'Z' });
      const inactive = await new Phase11Api(db, ADMIN_EMAIL).createQuickReply({ shortcut: '/alpha', text: 'A' });
      await new Phase11Api(db, ADMIN_EMAIL).updateQuickReply(inactive.id, { active: false });
      await new Phase11Api(db, ADMIN_EMAIL).createQuickReply({ shortcut: '/beta', text: 'B' });

      const list = await new Phase11Api(db, AGENT_EMAIL).listQuickReplies();
      expect(list.map((q) => q.shortcut)).toEqual(['/beta', '/zeta']);
    });
  });

  describe('Phase6Api — sendTemplateReply / sendMediaReply', () => {
    let conversationId: string;
    beforeEach(async () => {
      const result = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      conversationId = result.conversationId!;
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), assignedUserId: agentId });
    });

    it('rejects sending a template that is not APPROVED', async () => {
      const draft = await new Phase10Api(db, ADMIN_EMAIL).createDraftTemplate({ name: 'welcome', language: 'en', category: 'MARKETING' });
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendTemplateReply(conversationId, draft.id, {})).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('sends an approved template with variables substituted into the body', async () => {
      mock.setNextExotelResponse(200, { response: { whatsapp: { templates: [{ data: { id: 'ptpl-1', name: 'greet', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}, welcome!' }] } }] } } });
      const [synced] = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).syncTemplatesFromProvider('waba-1');

      const message = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendTemplateReply(conversationId, synced!.id, { 1: 'Priya' });
      expect(message.status).toBe('SENT');
      expect(message.messageType).toBe('template');
      // The Inbox should show the customer-facing text, not a bracketed placeholder — and the
      // template name is tracked separately (templateName) so Dashboard reporting doesn't depend on parsing messageText.
      expect(message.messageText).toBe('Hi Priya, welcome!');
      expect(message.templateName).toBe('greet');
      expect(mock.exotelCalls.at(-1)!.path).toBe('messages');
      const sentBody = mock.exotelCalls.at(-1)!.body as { whatsapp: { messages: [{ content: { type: string; template: { language: { code: string; policy: string }; components: [{ type: string; parameters: { type: string; text: string }[] }] } } }] } };
      const sentContent = sentBody.whatsapp.messages[0]!.content;
      expect(sentContent.type).toBe('template');
      expect(sentContent.template.language).toEqual({ code: 'en', policy: 'deterministic' });
      expect(sentContent.template.components[0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: 'Priya' }] });
    });

    it('sends a media message and records a MessageMedia entry', async () => {
      const message = await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendMediaReply(conversationId, 'image', 'https://example.com/photo.jpg', 'A photo');
      expect(message.status).toBe('SENT');
      expect(message.messageType).toBe('media');

      const workspace = await new WorkspaceApi(db, ADMIN_EMAIL, { FIREBASE_WEB_API_KEY: 'test-key' }).getConversationWorkspace(conversationId, false);
      const sentMessage = workspace.messages.find((m) => m.id === message.id);
      expect(sentMessage?.media).toMatchObject({ mediaType: 'image', mediaUrl: 'https://example.com/photo.jpg', caption: 'A photo' });
    });

    it('sends the correct Exotel payload shape for image and document media (recipient_type required, document uses filename not caption)', async () => {
      await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendMediaReply(conversationId, 'image', 'https://example.com/photo.jpg', 'A photo');
      const imageContent = (mock.exotelCalls.at(-1)!.body as { whatsapp: { messages: [{ content: Record<string, unknown> }] } }).whatsapp.messages[0]!.content;
      expect(imageContent).toEqual({ recipient_type: 'individual', type: 'image', image: { link: 'https://example.com/photo.jpg', caption: 'A photo' } });

      await new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendMediaReply(conversationId, 'document', 'https://example.com/invoice.pdf', 'Invoice #42');
      const docContent = (mock.exotelCalls.at(-1)!.body as { whatsapp: { messages: [{ content: Record<string, unknown> }] } }).whatsapp.messages[0]!.content;
      expect(docContent).toEqual({ recipient_type: 'individual', type: 'document', document: { link: 'https://example.com/invoice.pdf', filename: 'Invoice #42' } });
    });
  });

  describe('24-hour customer service window', () => {
    let conversationId: string;
    beforeEach(async () => {
      const result = await new Phase4Api(db).ingestInboundMessage({ providerMessageId: 'msg-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: new Date().toISOString(), status: null });
      conversationId = result.conversationId!;
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), assignedUserId: agentId });
    });

    async function backdateLastCustomerMessage(hoursAgo: number) {
      const stale = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
      await db.put(`webapp_conversations/${conversationId}`, { ...(await db.get(`webapp_conversations/${conversationId}`) as object), lastCustomerMessageAt: stale, lastMessageAt: stale });
    }

    it('sendReply/sendMediaReply succeed within 24h of the customer\'s last message', async () => {
      await backdateLastCustomerMessage(1);
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(conversationId, 'Still here')).resolves.toMatchObject({ status: 'SENT' });
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendMediaReply(conversationId, 'image', 'https://example.com/x.jpg', '')).resolves.toMatchObject({ status: 'SENT' });
    });

    it('sendReply/sendMediaReply are rejected more than 24h after the customer\'s last message, but sendTemplateReply still works', async () => {
      await backdateLastCustomerMessage(25);
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(conversationId, 'Still here?')).rejects.toMatchObject({ code: 'OUTSIDE_MESSAGE_WINDOW' });
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendMediaReply(conversationId, 'image', 'https://example.com/x.jpg', '')).rejects.toMatchObject({ code: 'OUTSIDE_MESSAGE_WINDOW' });

      mock.setNextExotelResponse(200, { response: { whatsapp: { templates: [{ data: { id: 'ptpl-1', name: 'reopen', language: 'en', category: 'UTILITY', status: 'APPROVED', components: [] } }] } } });
      const [synced] = await new Phase10Api(db, ADMIN_EMAIL, mock.exotelConfig as never).syncTemplatesFromProvider('waba-1');
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendTemplateReply(conversationId, synced!.id, {})).resolves.toMatchObject({ status: 'SENT' });
    });

    it('a brand-new conversation with no inbound message at all is treated as outside the window, even though lastMessageAt is stamped at creation', async () => {
      // Mirrors what startWhatsAppFromLead does: creates a conversation with lastMessageAt set
      // to "now" but no lastCustomerMessageAt, since no customer message has actually arrived.
      const now = new Date().toISOString();
      const freshId = 'conversation_fresh_no_inbound';
      await db.put(`webapp_conversations/${freshId}`, { id: freshId, customerId: 'cust-x', numberId, assignedUserId: agentId, status: 'OPEN', needsResponse: false, lastMessageAt: now, createdAt: now, updatedAt: now });
      await db.put(`customers/cust-x`, { id: 'cust-x', phone: '+919876500099', name: 'Fresh', email: '', company: '', source: 'location_lead', createdAt: now, updatedAt: now });
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(freshId, 'Hi')).rejects.toMatchObject({ code: 'OUTSIDE_MESSAGE_WINDOW' });
    });

    it('backfillCustomerServiceWindow migrates a legacy conversation from its real inbound message history, is ADMIN-only, and is safe to re-run', async () => {
      const record = (await db.get(`webapp_conversations/${conversationId}`)) as Record<string, unknown>;
      delete record.lastCustomerMessageAt;
      await db.put(`webapp_conversations/${conversationId}`, record);
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(conversationId, 'Hi')).rejects.toMatchObject({ code: 'OUTSIDE_MESSAGE_WINDOW' });

      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).backfillCustomerServiceWindow()).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const result = await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).backfillCustomerServiceWindow();
      expect(result.updated).toBe(1);
      await expect(new Phase6Api(db, AGENT_EMAIL, mock.exotelConfig as never).sendReply(conversationId, 'Hi')).resolves.toMatchObject({ status: 'SENT' });

      const again = await new Phase6Api(db, ADMIN_EMAIL, mock.exotelConfig as never).backfillCustomerServiceWindow();
      expect(again.updated).toBe(0); // already set — re-running touches nothing
    });
  });

  describe('Phase4Api — inbound media persistence', () => {
    it('creates a MessageMedia record when the webhook payload includes a mediaUrl', async () => {
      const normalized = await new Phase4Api(db).ingestInboundMessage({
        providerMessageId: 'msg-img-1', fromPhone: '+919876543210', providerNumberId: '+917948502801',
        direction: 'INBOUND', messageType: 'image', text: '', mediaUrl: 'https://cdn.exotel.com/inbound/photo.jpg', timestamp: new Date().toISOString(), status: null,
      });
      const workspace = await new WorkspaceApi(db, ADMIN_EMAIL, { FIREBASE_WEB_API_KEY: 'test-key' }).getConversationWorkspace(normalized.conversationId!, false);
      const inboundMessage = workspace.messages.find((m) => m.id === normalized.messageId);
      expect(inboundMessage?.media).toMatchObject({ mediaType: 'image', mediaUrl: 'https://cdn.exotel.com/inbound/photo.jpg' });
    });
  });
});
