/**
 * Direct port of apps-script/src/Phase1Domain.gs — same five roles, same
 * permission vocabulary, same validation rules. Kept intentionally identical
 * rather than "improved," since the authorization model itself was never the
 * problem being fixed by this migration (Apps Script's execution model was).
 */
import { ApiError } from '../types';

export const Permissions = {
  USERS_MANAGE: 'users.manage', SETTINGS_MANAGE: 'settings.manage', NUMBERS_ADMIN: 'numbers.admin',
  TEMPLATES_MANAGE: 'templates.manage', TEMPLATES_USE: 'templates.use', REPORTS_VIEW: 'reports.view',
  ROUND_ROBIN_MANAGE: 'roundRobin.manage', REMINDERS_MANAGE: 'reminders.manage', REMARKS_VIEW: 'remarks.view', REMARKS_MANAGE: 'remarks.manage',
  LEAD_STAGES_MANAGE: 'leadStages.manage', CUSTOMERS_VIEW: 'customers.view',
  CONVERSATIONS_VIEW_GLOBAL: 'conversations.view.global', CONVERSATIONS_VIEW_TEAM: 'conversations.view.team',
  CONVERSATIONS_VIEW_ASSIGNED: 'conversations.view.assigned', CONVERSATIONS_VIEW_AUTHORIZED: 'conversations.view.authorized',
  CONVERSATIONS_REPLY_ASSIGNED: 'conversations.reply.assigned', CONVERSATIONS_REASSIGN_GLOBAL: 'conversations.reassign.global',
  CONVERSATIONS_REASSIGN_TEAM: 'conversations.reassign.team',
  TEAMS_MANAGE_ALL: 'teams.manage.all', TEAMS_OPERATE_ASSIGNED: 'teams.operate.assigned', TEAMS_CONTROL_OWN: 'teams.control.own',
  AVAILABILITY_MANAGE_SELF: 'availability.manageSelf', AVAILABILITY_MANAGE_ALL: 'availability.manageAll',
  ELIGIBILITY_MANAGE_ALL: 'eligibility.manageAll', ELIGIBILITY_MANAGE_TEAM: 'eligibility.manageTeam', AUDIT_READ: 'audit.read',
  // Phase 22 (location leads + Exotel click-to-call) — added to RoleDefinitions
  // directly here rather than via the Apps Script build's one-time fixup script
  // (Phase22RolePermissionsFixupTemp.gs), since this backend hasn't been
  // bootstrapped yet — a fresh bootstrap picks these up automatically, no
  // migration of already-persisted Role records ever needed.
  LEADS_MANAGE: 'leads.manage', LEADS_VIEW_ASSIGNED: 'leads.view.assigned', LEADS_CALL: 'leads.call',
  /** Managing custom field *definitions* (create/edit/deactivate) for Leads and Customers —
   * distinct from setting a field's *value* on one record, which reuses each entity's existing
   * update authorization (canTouchLead / canSeeCustomer). Granted to SUPERVISOR and above per
   * an explicit product decision — every other admin-config permission here is ADMIN-only. */
  CUSTOM_FIELDS_MANAGE: 'customFields.manage',
  /** Managing the Product Master (name/price per WhatsApp number) — distinct from building a
   * Quotation on a Lead, which reuses canTouchLead like every other lead-editing action. Granted
   * to SUPERVISOR and above, same "not ADMIN-only" reasoning as CUSTOM_FIELDS_MANAGE. */
  PRODUCTS_MANAGE: 'products.manage',
} as const;
export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const Roles = { ADMIN: 'ADMIN', SUPERVISOR: 'SUPERVISOR', SITE_MANAGER: 'SITE_MANAGER', AGENT: 'AGENT', VIEWER: 'VIEWER' } as const;
export type RoleKey = (typeof Roles)[keyof typeof Roles];

export const Status = { ACTIVE: 'active', INACTIVE: 'inactive', SUSPENDED: 'suspended' } as const;
export const AvailabilityStatus = { AVAILABLE: 'available', BUSY: 'busy', OFFLINE: 'offline', ON_LEAVE: 'on_leave' } as const;

export const ROLE_KEYS = Object.values(Roles);
export const ALL_PERMISSIONS = Object.values(Permissions);

export const RoleDefinitions: Record<RoleKey, { name: string; permissions: Permission[] }> = {
  ADMIN: { name: 'Administrator', permissions: [...ALL_PERMISSIONS] },
  SUPERVISOR: { name: 'Supervisor', permissions: [Permissions.TEAMS_OPERATE_ASSIGNED, Permissions.REPORTS_VIEW, Permissions.REMINDERS_MANAGE, Permissions.REMARKS_VIEW, Permissions.CONVERSATIONS_VIEW_TEAM, Permissions.CONVERSATIONS_REASSIGN_TEAM, Permissions.CUSTOM_FIELDS_MANAGE, Permissions.PRODUCTS_MANAGE] },
  SITE_MANAGER: { name: 'Site manager', permissions: [Permissions.TEAMS_CONTROL_OWN, Permissions.REPORTS_VIEW, Permissions.REMINDERS_MANAGE, Permissions.REMARKS_MANAGE, Permissions.CONVERSATIONS_VIEW_TEAM, Permissions.CONVERSATIONS_REASSIGN_TEAM, Permissions.ELIGIBILITY_MANAGE_TEAM, Permissions.LEADS_MANAGE, Permissions.CUSTOM_FIELDS_MANAGE, Permissions.PRODUCTS_MANAGE] },
  AGENT: { name: 'Agent', permissions: [Permissions.AVAILABILITY_MANAGE_SELF, Permissions.TEMPLATES_USE, Permissions.REMARKS_MANAGE, Permissions.REMINDERS_MANAGE, Permissions.LEAD_STAGES_MANAGE, Permissions.CONVERSATIONS_VIEW_ASSIGNED, Permissions.CONVERSATIONS_REPLY_ASSIGNED, Permissions.LEADS_VIEW_ASSIGNED, Permissions.LEADS_CALL] },
  VIEWER: { name: 'Viewer', permissions: [Permissions.CUSTOMERS_VIEW, Permissions.REPORTS_VIEW, Permissions.CONVERSATIONS_VIEW_AUTHORIZED] },
};

export const Validation = {
  requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return value.trim();
  },
  email(value: unknown): string {
    const v = Validation.requiredString(value, 'email').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ApiError(400, 'VALIDATION_ERROR', 'email is invalid.');
    return v;
  },
  enumValue<T extends string>(value: unknown, permitted: readonly T[], field: string): T {
    if (!permitted.includes(value as T)) throw new ApiError(400, 'VALIDATION_ERROR', `${field} is invalid.`);
    return value as T;
  },
  stringArray(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new ApiError(400, 'VALIDATION_ERROR', `${field} must be an array of non-empty strings.`);
    }
    return value.map((item: string) => item.trim());
  },
};

export const Ids = {
  create(prefix: string): string {
    return `${prefix}_${crypto.randomUUID()}`;
  },
  now(): string {
    return new Date().toISOString();
  },
};
