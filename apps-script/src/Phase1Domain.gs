/** Phase 1 authorization vocabulary. These five fixed roles are the authoritative contract. */
var Phase1Permissions = {
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
  // Phase 22: location-wise call leads, independent of WhatsApp conversation assignment above.
  LEADS_MANAGE: 'leads.manage', LEADS_VIEW_ASSIGNED: 'leads.view.assigned', LEADS_CALL: 'leads.call'
};

var Phase1Roles = { ADMIN: 'ADMIN', SUPERVISOR: 'SUPERVISOR', SITE_MANAGER: 'SITE_MANAGER', AGENT: 'AGENT', VIEWER: 'VIEWER' };
var Phase1Constants = {
  ACTIVE: 'active', INACTIVE: 'inactive', SUSPENDED: 'suspended', AVAILABLE: 'available', BUSY: 'busy', OFFLINE: 'offline', ON_LEAVE: 'on_leave',
  ROLE_KEYS: Object.keys(Phase1Roles).map(function (name) { return Phase1Roles[name]; }),
  ALL_PERMISSIONS: Object.keys(Phase1Permissions).map(function (key) { return Phase1Permissions[key]; })
};
var Phase1RoleDefinitions = {
  ADMIN: { name: 'Administrator', permissions: Phase1Constants.ALL_PERMISSIONS },
  SUPERVISOR: { name: 'Supervisor', permissions: [Phase1Permissions.TEAMS_OPERATE_ASSIGNED, Phase1Permissions.REPORTS_VIEW, Phase1Permissions.REMINDERS_MANAGE, Phase1Permissions.REMARKS_VIEW, Phase1Permissions.CONVERSATIONS_VIEW_TEAM, Phase1Permissions.CONVERSATIONS_REASSIGN_TEAM] },
  SITE_MANAGER: { name: 'Site manager', permissions: [Phase1Permissions.TEAMS_CONTROL_OWN, Phase1Permissions.REPORTS_VIEW, Phase1Permissions.REMINDERS_MANAGE, Phase1Permissions.REMARKS_MANAGE, Phase1Permissions.CONVERSATIONS_VIEW_TEAM, Phase1Permissions.CONVERSATIONS_REASSIGN_TEAM, Phase1Permissions.ELIGIBILITY_MANAGE_TEAM, Phase1Permissions.LEADS_MANAGE] },
  AGENT: { name: 'Agent', permissions: [Phase1Permissions.AVAILABILITY_MANAGE_SELF, Phase1Permissions.TEMPLATES_USE, Phase1Permissions.REMARKS_MANAGE, Phase1Permissions.REMINDERS_MANAGE, Phase1Permissions.LEAD_STAGES_MANAGE, Phase1Permissions.CONVERSATIONS_VIEW_ASSIGNED, Phase1Permissions.CONVERSATIONS_REPLY_ASSIGNED, Phase1Permissions.LEADS_VIEW_ASSIGNED, Phase1Permissions.LEADS_CALL] },
  VIEWER: { name: 'Viewer', permissions: [Phase1Permissions.CUSTOMERS_VIEW, Phase1Permissions.REPORTS_VIEW, Phase1Permissions.CONVERSATIONS_VIEW_AUTHORIZED] }
};

class Phase1Error extends Error { constructor(code, message) { super(message); this.name = 'Phase1Error'; this.code = code; } }
var Phase1Validation = {
  requiredString: function (value, field) { if (typeof value !== 'string' || !value.trim()) throw new Phase1Error('VALIDATION_ERROR', field + ' is required.'); return value.trim(); },
  email: function (value) { value = this.requiredString(value, 'email').toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Phase1Error('VALIDATION_ERROR', 'email is invalid.'); return value; },
  enumValue: function (value, permitted, field) { if (permitted.indexOf(value) === -1) throw new Phase1Error('VALIDATION_ERROR', field + ' is invalid.'); return value; },
  stringArray: function (value, field) { if (!Array.isArray(value) || value.some(function (item) { return typeof item !== 'string' || !item.trim(); })) throw new Phase1Error('VALIDATION_ERROR', field + ' must be an array of non-empty strings.'); return value.map(function (item) { return item.trim(); }); }
};
var Phase1Ids = { create: function (prefix) { return prefix + '_' + Utilities.getUuid(); }, now: function () { return new Date().toISOString(); } };
