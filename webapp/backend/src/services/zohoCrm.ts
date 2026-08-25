/**
 * Server-only Zoho CRM Contact synchronization.
 *
 * Firebase Realtime Database remains authoritative: callers first persist a Customer locally,
 * then enqueue only its id. The queue consumer re-reads the current customer before calling
 * Zoho, so rapid edits coalesce naturally and no customer data or OAuth credential ever enters
 * the browser or queue payload.
 */
import { ApiError } from '../types';
import type { Customer } from '../domain/types';
import { Repository } from '../lib/repository';
import { AppDb } from '../lib/appDb';

export interface ZohoCustomerSyncJob {
  customerId: string;
}

/** Structural type keeps services testable without coupling them to the Workers Queue global. */
export interface CustomerSyncQueue {
  send(message: ZohoCustomerSyncJob): Promise<void>;
}

export interface ZohoCrmConfig {
  ZOHO_CLIENT_ID?: string;
  ZOHO_CLIENT_SECRET?: string;
  ZOHO_REFRESH_TOKEN?: string;
  /** Domain-specific OAuth account URL, e.g. https://accounts.zoho.in. */
  ZOHO_ACCOUNTS_URL?: string;
  /** Must name a Zoho Contacts custom field configured as unique, e.g. Echt_Customer_ID. */
  ZOHO_CONTACT_EXTERNAL_ID_FIELD?: string;
}

interface ZohoAccessToken {
  token: string;
  apiDomain: string;
  expiresAt: number;
}

let cachedAccessToken: ZohoAccessToken | null = null;

function requireZohoConfig(env: ZohoCrmConfig): Required<Pick<ZohoCrmConfig, 'ZOHO_CLIENT_ID' | 'ZOHO_CLIENT_SECRET' | 'ZOHO_REFRESH_TOKEN'>> & { accountsUrl: string; externalIdField: string } {
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN) {
    throw new ApiError(500, 'CONFIGURATION_ERROR', 'Zoho CRM OAuth is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, and ZOHO_REFRESH_TOKEN as Worker secrets.');
  }
  const accountsUrl = (env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/$/, '');
  const externalIdField = (env.ZOHO_CONTACT_EXTERNAL_ID_FIELD || 'Echt_Customer_ID').trim();
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(externalIdField)) {
    throw new ApiError(500, 'CONFIGURATION_ERROR', 'ZOHO_CONTACT_EXTERNAL_ID_FIELD must be a Zoho field API name.');
  }
  return { ZOHO_CLIENT_ID: env.ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET: env.ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN: env.ZOHO_REFRESH_TOKEN, accountsUrl, externalIdField };
}

async function getAccessToken(env: ZohoCrmConfig): Promise<ZohoAccessToken> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) return cachedAccessToken;
  const config = requireZohoConfig(env);
  const body = new URLSearchParams({
    refresh_token: config.ZOHO_REFRESH_TOKEN,
    client_id: config.ZOHO_CLIENT_ID,
    client_secret: config.ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${config.accountsUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await res.json().catch(() => null)) as { access_token?: string; api_domain?: string; expires_in?: number; error?: string } | null;
  if (!res.ok || !payload?.access_token || !payload.api_domain) {
    throw new ApiError(502, 'ZOHO_AUTH_FAILED', `Zoho OAuth refresh failed${payload?.error ? `: ${payload.error}` : ''}.`);
  }
  cachedAccessToken = {
    token: payload.access_token,
    apiDomain: payload.api_domain.replace(/\/$/, ''),
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
  return cachedAccessToken;
}

function contactPayload(customer: Customer, externalIdField: string): Record<string, unknown> {
  // Zoho Contacts requires Last_Name. WhatsApp-created customers may have only a phone number.
  const displayName = customer.name.trim() || customer.phone || `Customer ${customer.id}`;
  return {
    [externalIdField]: customer.id,
    Last_Name: displayName,
    Mobile: customer.phone || undefined,
    Email: customer.email || undefined,
    Description: customer.company ? `Company: ${customer.company}` : undefined,
  };
}

/** Upserts one Contact using a locally-owned, unique Zoho external-id field and persists its Zoho id locally. */
export async function syncCustomerToZoho(db: AppDb, customerId: string, env: ZohoCrmConfig): Promise<string> {
  const customerRepo = new Repository<Customer>(db, 'customers');
  const customer = await customerRepo.get(customerId);
  if (!customer) return ''; // Customer was deleted after its queued job; no remote mutation is appropriate.

  const config = requireZohoConfig(env);
  const token = await getAccessToken(env);
  const res = await fetch(`${token.apiDomain}/crm/v8/Contacts/upsert`, {
    method: 'POST',
    headers: {
      Authorization: `Zoho-oauthtoken ${token.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: [contactPayload(customer, config.externalIdField)],
      duplicate_check_fields: [config.externalIdField],
    }),
  });
  const payload = (await res.json().catch(() => null)) as { data?: Array<{ status?: string; code?: string; message?: string; details?: { id?: string } }> } | null;
  const row = payload?.data?.[0];
  const zohoContactId = row?.details?.id;
  if (!res.ok || row?.status !== 'success' || !zohoContactId) {
    throw new ApiError(502, 'ZOHO_SYNC_FAILED', `Zoho Contact upsert failed${row?.code ? ` (${row.code})` : ''}${row?.message ? `: ${row.message}` : ''}.`);
  }
  // This internal metadata write deliberately does not re-enqueue a sync job.
  await customerRepo.update(customer.id, { zohoContactId });
  return zohoContactId;
}

/** Queue only opaque customer ids. A queue-acceptance failure is surfaced to callers so it is observable; local data is never rolled back. */
export async function enqueueCustomerSync(queue: CustomerSyncQueue | undefined, customerId: string): Promise<void> {
  // Direct service tests and offline scripts intentionally omit a queue. All deployed HTTP
  // mutation paths pass Env.ZOHO_CUSTOMER_SYNC_QUEUE, which Wrangler binds at deploy time.
  if (!queue) return;
  await queue.send({ customerId });
}

/** Test-only cache reset: production benefits from the warm-isolate token cache. */
export function __resetZohoTokenCacheForTests(): void {
  cachedAccessToken = null;
}
