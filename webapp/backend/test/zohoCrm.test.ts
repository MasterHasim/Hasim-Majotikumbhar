import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupMockFirebase, type MockFirebaseContext } from './helpers/mockFirebase';
import { FirebaseDb } from '../src/lib/firebaseAdmin';
import { Repository } from '../src/lib/repository';
import type { Customer } from '../src/domain/types';
import { __resetZohoTokenCacheForTests, enqueueCustomerSync, syncCustomerToZoho, type CustomerSyncQueue } from '../src/services/zohoCrm';
import { Phase4Api } from '../src/services/phase4Api';
import type { WhatsAppNumber } from '../src/domain/types';

describe('Zoho CRM customer synchronization', () => {
  let mock: MockFirebaseContext;
  let db: FirebaseDb;

  beforeEach(async () => {
    __resetZohoTokenCacheForTests();
    mock = await setupMockFirebase();
    db = new FirebaseDb(mock.serviceAccount, mock.databaseUrl);
  });

  afterEach(() => {
    __resetZohoTokenCacheForTests();
    mock.restore();
  });

  it('upserts the Firebase-authoritative customer by unique external id and stores the Zoho Contact id back locally', async () => {
    const customers = new Repository<Customer>(db, 'customers');
    await customers.create({
      id: 'customer-1', phone: '+919876543210', name: 'Asha Patel', email: 'asha@example.com', company: 'ECHT', source: 'whatsapp', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const contactId = await syncCustomerToZoho(db, 'customer-1', mock.zohoEnv);

    expect(contactId).toBe('zoho-contact-1');
    expect(mock.zohoContactUpserts).toHaveLength(1);
    expect(mock.zohoContactUpserts[0]).toMatchObject({
      authorization: 'Zoho-oauthtoken mock-zoho-access-token',
      body: {
        duplicate_check_fields: ['Echt_Customer_ID'],
        data: [{ Echt_Customer_ID: 'customer-1', Last_Name: 'Asha Patel', Mobile: '+919876543210', Email: 'asha@example.com' }],
      },
    });
    expect((await customers.get('customer-1'))?.zohoContactId).toBe('zoho-contact-1');
  });

  it('puts only an opaque customer id on the queue', async () => {
    const jobs: unknown[] = [];
    const queue: CustomerSyncQueue = { send: async (job) => { jobs.push(job); } };

    await enqueueCustomerSync(queue, 'customer-42');

    expect(jobs).toEqual([{ customerId: 'customer-42' }]);
    expect(JSON.stringify(jobs)).not.toContain('refresh');
    expect(JSON.stringify(jobs)).not.toContain('secret');
  });

  it('queues a newly-created WhatsApp customer after Firebase has been written', async () => {
    const jobs: unknown[] = [];
    const queue: CustomerSyncQueue = { send: async (job) => { jobs.push(job); } };
    const numbers = new Repository<WhatsAppNumber>(db, 'numbers');
    await numbers.create({ id: 'number-1', displayName: 'Test', phoneNumber: '+917948502801', provider: 'exotel', providerAccountId: '', wabaId: '', providerNumberId: '', active: true, createdAt: '', updatedAt: '' });

    const result = await new Phase4Api(db, queue).ingestInboundMessage({ providerMessageId: 'provider-message-1', fromPhone: '+919876543210', providerNumberId: '+917948502801', direction: 'INBOUND', messageType: 'text', text: 'Hi', timestamp: '2026-01-01T00:00:00.000Z', status: 'RECEIVED' });

    expect(jobs).toEqual([{ customerId: result.customerId }]);
    expect(await new Repository<Customer>(db, 'customers').get(result.customerId!)).not.toBeNull();
  });
});
