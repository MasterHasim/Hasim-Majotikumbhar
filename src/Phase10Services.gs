/**
 * Phase 10 WhatsApp Templates: draft → admin review → submit → pending →
 * approved/rejected, plus syncing real templates from Exotel. `TEMPLATES_MANAGE`
 * (create/edit/submit/sync) is effectively ADMIN-only per Phase 1's existing role
 * definitions — no other role's permission list includes it (AGENT has
 * `TEMPLATES_USE` instead, for sending an already-approved template via Phase 6).
 *
 * `submitTemplateForReview` and `syncTemplatesFromProvider` both call `ExotelProvider`
 * for real — the same "built and Node-tested, not invoked live unattended" boundary as
 * Phase 6's `sendText`. Submitting a draft creates a real template on the user's WABA
 * pending Meta's review; syncing is read-only against Exotel but still needs a live
 * Apps Script execution this session can't perform. Both are queued for the user.
 */
class Phase10Api {
  constructor() {
    this.repository_ = new PropertiesRepository();
    this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_);
    this.templates_ = new TemplateRepository();
  }

  createDraftTemplate(input) {
    var actor = this.access_.require(Phase1Permissions.TEMPLATES_MANAGE);
    var now = Phase1Ids.now();
    var record = {
      id: Phase1Ids.create('template'), wabaId: input.wabaId || '', providerTemplateId: '',
      name: Phase1Validation.requiredString(input.name, 'name'), language: Phase1Validation.requiredString(input.language, 'language'),
      category: Phase1Validation.requiredString(input.category, 'category'), status: 'LOCAL_DRAFT',
      components: input.components || [], variables: input.variables || [], createdAt: now, updatedAt: now, lastSyncedAt: ''
    };
    this.templates_.create(record);
    this.audit_.write(actor.id, 'template.draftCreated', 'template', record.id, {});
    return record;
  }

  updateDraftTemplate(id, patch) {
    var actor = this.access_.require(Phase1Permissions.TEMPLATES_MANAGE);
    var record = this.templates_.get(id);
    if (!record) throw new Phase1Error('NOT_FOUND', 'Template was not found.');
    if (record.status !== 'LOCAL_DRAFT') throw new Phase1Error('VALIDATION_ERROR', 'Only a LOCAL_DRAFT template can be edited.');
    var allowed = ['wabaId', 'name', 'language', 'category', 'components', 'variables'];
    var safePatch = {};
    Object.keys(patch || {}).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      safePatch[key] = patch[key];
    });
    var updated = this.templates_.update(id, safePatch);
    this.audit_.write(actor.id, 'template.draftUpdated', 'template', id, {});
    return updated;
  }

  listTemplates() {
    this.access_.currentUser();
    return this.templates_.list();
  }

  getTemplate(id) {
    this.access_.currentUser();
    var record = this.templates_.get(id);
    if (!record) throw new Phase1Error('NOT_FOUND', 'Template was not found.');
    return record;
  }

  submitTemplateForReview(id) {
    var actor = this.access_.require(Phase1Permissions.TEMPLATES_MANAGE);
    var record = this.templates_.get(id);
    if (!record) throw new Phase1Error('NOT_FOUND', 'Template was not found.');
    if (record.status !== 'LOCAL_DRAFT') throw new Phase1Error('VALIDATION_ERROR', 'Only a LOCAL_DRAFT template can be submitted.');
    if (!record.wabaId) throw new Phase1Error('VALIDATION_ERROR', 'wabaId is required before submission.');

    var response = new ExotelProvider().createTemplate(record.wabaId, { name: record.name, language: record.language, category: record.category, components: record.components });
    var providerTemplateId = extractProviderTemplateId_(response) || '';
    var updated = this.templates_.update(id, { status: 'PENDING', providerTemplateId: providerTemplateId, lastSyncedAt: Phase1Ids.now() });
    this.audit_.write(actor.id, 'template.submitted', 'template', id, { wabaId: record.wabaId });
    return updated;
  }

  /** Refreshes local template records from a live getTemplates() call — that part of ExotelProvider is confirmed live (Phase 3), only this sync/upsert logic itself is new. */
  syncTemplatesFromProvider(wabaId) {
    var actor = this.access_.require(Phase1Permissions.TEMPLATES_MANAGE);
    wabaId = Phase1Validation.requiredString(wabaId, 'wabaId');
    var raw = new ExotelProvider().getTemplates(wabaId);
    var entries = extractTemplateEntries_(raw);
    var self = this, now = Phase1Ids.now();
    var results = entries.map(function (entry) {
      var data = entry.data || entry;
      if (!data || !data.id) return null;
      var existing = self.templates_.findOne(function (t) { return t.providerTemplateId === data.id; });
      var record = {
        id: existing ? existing.id : Phase1Ids.create('template'),
        wabaId: wabaId, providerTemplateId: data.id, name: data.name, language: data.language, category: data.category,
        status: data.status || 'PENDING', components: data.components || [], variables: existing ? existing.variables : [],
        createdAt: existing ? existing.createdAt : now, updatedAt: now, lastSyncedAt: now
      };
      self.templates_.replace(record.id, record);
      return record;
    }).filter(function (record) { return record !== null; });
    this.audit_.write(actor.id, 'templates.synced', 'waba', wabaId, { count: results.length });
    return results;
  }
}

function extractTemplateEntries_(raw) {
  // Confirmed live shape (Phase 3, 2026-08-09): {response: {whatsapp: {templates: [{data: {...}}]}}}.
  var container = raw && raw.response && raw.response.whatsapp && raw.response.whatsapp.templates;
  return container || [];
}

function extractProviderTemplateId_(response) {
  // UNVERIFIED — createTemplate has never been called live.
  if (!response) return null;
  if (response.id) return response.id;
  var data = response.data || (response.response && response.response.data);
  return (data && data.id) || null;
}
