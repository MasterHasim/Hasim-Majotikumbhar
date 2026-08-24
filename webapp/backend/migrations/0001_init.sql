-- Initial D1 schema for the Firebase RTDB -> D1 migration (see the migration plan in
-- memory / PROGRESS.md). One table per Firebase collection, structurally mirroring
-- src/lib/d1Schema.ts's D1_TABLES registry -- keep both in sync by hand.
--
-- Every table: id TEXT PRIMARY KEY, data TEXT NOT NULL (the full record as JSON, source
-- of truth for reconstructing the TypeScript type) + real columns only for fields something
-- actually filters/sorts on today. Booleans are INTEGER (0/1) -- SQLite has no boolean type.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  email TEXT,
  status TEXT
);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  key TEXT,
  status TEXT
);
CREATE INDEX idx_roles_key ON roles(key);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  owner_user_id TEXT,
  status TEXT
);
CREATE INDEX idx_teams_owner_user_id ON teams(owner_user_id);

CREATE TABLE teamMembers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  team_id TEXT,
  user_id TEXT,
  status TEXT
);
CREATE INDEX idx_teamMembers_team_id ON teamMembers(team_id);
CREATE INDEX idx_teamMembers_user_id ON teamMembers(user_id);

CREATE TABLE numberAccess (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  user_id TEXT,
  number_id TEXT,
  status TEXT,
  granted INTEGER
);
CREATE INDEX idx_numberAccess_user_id ON numberAccess(user_id);
CREATE INDEX idx_numberAccess_number_id ON numberAccess(number_id);

CREATE TABLE availability (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  user_id TEXT,
  status TEXT
);
CREATE INDEX idx_availability_user_id ON availability(user_id);

CREATE TABLE assignmentEligibility (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  user_id TEXT,
  number_id TEXT,
  team_id TEXT,
  eligible INTEGER
);
CREATE INDEX idx_assignmentEligibility_user_id ON assignmentEligibility(user_id);
CREATE INDEX idx_assignmentEligibility_number_id ON assignmentEligibility(number_id);

CREATE TABLE numbers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  phone_number TEXT,
  waba_id TEXT,
  active INTEGER
);
CREATE INDEX idx_numbers_phone_number ON numbers(phone_number);
CREATE INDEX idx_numbers_waba_id ON numbers(waba_id);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  phone TEXT,
  name TEXT
);
CREATE INDEX idx_customers_phone ON customers(phone);

CREATE TABLE webapp_conversations (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  customer_id TEXT,
  number_id TEXT,
  assigned_user_id TEXT,
  status TEXT,
  needs_response INTEGER,
  last_message_at TEXT
);
CREATE INDEX idx_webapp_conversations_customer_id ON webapp_conversations(customer_id);
CREATE INDEX idx_webapp_conversations_number_id ON webapp_conversations(number_id);
CREATE INDEX idx_webapp_conversations_assigned_user_id ON webapp_conversations(assigned_user_id);
CREATE INDEX idx_webapp_conversations_status ON webapp_conversations(status);

CREATE TABLE webapp_messages (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  conversation_id TEXT,
  number_id TEXT,
  provider_message_id TEXT,
  status TEXT,
  direction TEXT,
  timestamp TEXT
);
CREATE INDEX idx_webapp_messages_conversation_id ON webapp_messages(conversation_id);
CREATE INDEX idx_webapp_messages_provider_message_id ON webapp_messages(provider_message_id);
CREATE INDEX idx_webapp_messages_number_id ON webapp_messages(number_id);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  conversation_id TEXT,
  user_id TEXT
);
CREATE INDEX idx_assignments_conversation_id ON assignments(conversation_id);

CREATE TABLE numberAssignmentConfig (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  number_id TEXT
);
CREATE INDEX idx_numberAssignmentConfig_number_id ON numberAssignmentConfig(number_id);

CREATE TABLE numberAssignmentUsers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  number_id TEXT,
  user_id TEXT,
  sequence_order INTEGER,
  active INTEGER
);
CREATE INDEX idx_numberAssignmentUsers_number_id ON numberAssignmentUsers(number_id);

CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  key TEXT,
  active INTEGER,
  sequence_order INTEGER
);
CREATE INDEX idx_stages_key ON stages(key);

CREATE TABLE customerStages (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  customer_id TEXT,
  stage_id TEXT
);
CREATE INDEX idx_customerStages_customer_id ON customerStages(customer_id);

CREATE TABLE remarks (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  conversation_id TEXT,
  created_at TEXT
);
CREATE INDEX idx_remarks_conversation_id ON remarks(conversation_id);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  conversation_id TEXT,
  lead_id TEXT,
  owner_user_id TEXT,
  status TEXT,
  due_at TEXT
);
CREATE INDEX idx_reminders_conversation_id ON reminders(conversation_id);
CREATE INDEX idx_reminders_lead_id ON reminders(lead_id);
CREATE INDEX idx_reminders_owner_user_id ON reminders(owner_user_id);

CREATE TABLE conversationSnoozes (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  conversation_id TEXT,
  snoozed_until TEXT
);
CREATE INDEX idx_conversationSnoozes_conversation_id ON conversationSnoozes(conversation_id);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  waba_id TEXT,
  provider_template_id TEXT,
  name TEXT,
  status TEXT
);
CREATE INDEX idx_templates_waba_id ON templates(waba_id);
CREATE INDEX idx_templates_provider_template_id ON templates(provider_template_id);

CREATE TABLE quickReplies (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  shortcut TEXT,
  active INTEGER
);
CREATE INDEX idx_quickReplies_shortcut ON quickReplies(shortcut);

CREATE TABLE messageMedia (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  message_id TEXT
);
CREATE INDEX idx_messageMedia_message_id ON messageMedia(message_id);

CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  phone TEXT,
  location TEXT,
  status TEXT,
  assigned_user_id TEXT,
  stage_id TEXT,
  created_at TEXT
);
CREATE INDEX idx_leads_phone_location ON leads(phone, location);
CREATE INDEX idx_leads_location ON leads(location);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned_user_id ON leads(assigned_user_id);

CREATE TABLE customFieldDefinitions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  entity_type TEXT,
  key TEXT,
  active INTEGER,
  sequence_order INTEGER
);
CREATE INDEX idx_customFieldDefinitions_entity_type ON customFieldDefinitions(entity_type);

CREATE TABLE adAccounts (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  platform TEXT,
  external_account_id TEXT,
  active INTEGER
);
CREATE INDEX idx_adAccounts_external_account_id ON adAccounts(external_account_id);

CREATE TABLE locationAssignmentConfig (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  location TEXT
);
CREATE INDEX idx_locationAssignmentConfig_location ON locationAssignmentConfig(location);

CREATE TABLE locationAssignmentUsers (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  location TEXT,
  user_id TEXT,
  sequence_order INTEGER,
  active INTEGER
);
CREATE INDEX idx_locationAssignmentUsers_location ON locationAssignmentUsers(location);

CREATE TABLE callLog (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  lead_id TEXT,
  agent_user_id TEXT,
  exotel_call_sid TEXT,
  conversation_id TEXT,
  number_id TEXT,
  status TEXT,
  lead_phone TEXT
);
CREATE INDEX idx_callLog_lead_id ON callLog(lead_id);
CREATE INDEX idx_callLog_conversation_id ON callLog(conversation_id);
CREATE INDEX idx_callLog_agent_user_id ON callLog(agent_user_id);
CREATE INDEX idx_callLog_exotel_call_sid ON callLog(exotel_call_sid);

CREATE TABLE autoDialerSettings (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);

CREATE TABLE leadStageAssignments (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  lead_id TEXT,
  stage_id TEXT
);
CREATE INDEX idx_leadStageAssignments_lead_id ON leadStageAssignments(lead_id);

CREATE TABLE leadRemarks (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  lead_id TEXT,
  created_at TEXT
);
CREATE INDEX idx_leadRemarks_lead_id ON leadRemarks(lead_id);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  number_id TEXT,
  active INTEGER,
  sequence_order INTEGER
);
CREATE INDEX idx_products_number_id ON products(number_id);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  lead_id TEXT,
  number_id TEXT,
  status TEXT
);
CREATE INDEX idx_quotations_lead_id ON quotations(lead_id);

CREATE TABLE auditLog (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  occurred_at TEXT,
  actor_user_id TEXT,
  action TEXT,
  target_type TEXT,
  target_id TEXT
);
CREATE INDEX idx_auditLog_occurred_at ON auditLog(occurred_at);
CREATE INDEX idx_auditLog_target ON auditLog(target_type, target_id);
