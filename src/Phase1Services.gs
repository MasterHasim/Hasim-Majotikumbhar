// Strips password fields (added 2026-08-10 for email/password login, see
// PasswordAuthServices.gs) before any user record reaches the client — listUsers()/
// updateUser() otherwise return the raw repository record, hash and salt included.
function sanitizeUserRecord_(user) {
  if (!user) return user;
  var clean = Object.assign({}, user);
  delete clean.passwordHash;
  delete clean.passwordSalt;
  return clean;
}

class AuditLogService {
  // `repository` (a PropertiesRepository) is accepted for constructor-compatibility
  // with every existing call site but is no longer where entries are stored — see
  // AuditLogRepository / Phase2Domain.gs for why (Properties storage quota).
  constructor(repository) { this.repository_ = repository; this.auditRepository_ = new AuditLogRepository(); }
  write(actorUserId, action, targetType, targetId, metadata) {
    var now = Phase1Ids.now();
    return this.auditRepository_.create({ id: Phase1Ids.create('audit'), occurredAt: now, actorUserId: actorUserId,
      action: action, targetType: targetType, targetId: targetId, metadata: JSON.stringify(metadata || {}) });
  }
  list() {
    return this.auditRepository_.list().map(function (entry) {
      var metadata = {};
      try { metadata = JSON.parse(entry.metadata || '{}'); } catch (ignored) {}
      return Object.assign({}, entry, { metadata: metadata });
    });
  }
}

class AssignmentEligibilityService {
  constructor(repository) { this.repository_ = repository; }
  evaluate(userId, numberId) {
    var user = this.repository_.get('users', userId);
    if (!user || user.status !== Phase1Constants.ACTIVE) return { assignmentEligible: false, availability: null, assignableNow: false, reasons: ['USER_INACTIVE'] };
    var eligibility = this.repository_.get('assignmentEligibility', userId + ':' + numberId);
    if (!eligibility || eligibility.eligible !== true) return { assignmentEligible: false, availability: null, assignableNow: false, reasons: ['ELIGIBILITY_NOT_GRANTED'] };
    var availability = this.repository_.get('availability', userId);
    var availabilityStatus = availability ? availability.status : Phase1Constants.OFFLINE;
    var access = this.repository_.findOne('numberAccess', function (item) {
      return item.userId === userId && item.numberId === numberId && item.status === Phase1Constants.ACTIVE;
    });
    if (!access || access.granted !== true) return { assignmentEligible: false, availability: availabilityStatus, assignableNow: false, reasons: ['NO_GRANTED_NUMBER_ACCESS'] };
    var memberships = this.repository_.list('teamMembers').filter(function (member) {
      return member.userId === userId && member.status === Phase1Constants.ACTIVE;
    });
    var teams = this.repository_.list('teams');
    var enabled = memberships.some(function (member) {
      var team = teams.filter(function (item) { return item.id === member.teamId && item.status === Phase1Constants.ACTIVE; })[0];
      return !!team && (member.numberIds.length === 0 || member.numberIds.indexOf(numberId) !== -1);
    });
    if (!enabled) return { assignmentEligible: false, availability: availabilityStatus, assignableNow: false, reasons: ['NO_ACTIVE_ELIGIBLE_TEAM'] };
    return { assignmentEligible: true, availability: availabilityStatus, assignableNow: availabilityStatus === Phase1Constants.AVAILABLE, reasons: availabilityStatus === Phase1Constants.AVAILABLE ? [] : ['NOT_AVAILABLE'] };
  }
}

class Phase1Api {
  constructor() {
    this.repository_ = new PropertiesRepository(); this.audit_ = new AuditLogService(this.repository_);
    this.access_ = new AccessControl(this.repository_, new AuthService(this.audit_), this.audit_); this.eligibility_ = new AssignmentEligibilityService(this.repository_);
  }
  bootstrap(profile) {
    if (this.repository_.count('users') !== 0) throw new Phase1Error('CONFLICT', 'Phase 1 is already bootstrapped.');
    var identity = new AuthService(this.audit_).currentIdentity();
    var email = Phase1Validation.email(profile && profile.email);
    if (identity.email !== email) throw new Phase1Error('FORBIDDEN', 'Bootstrap email must match the signed-in Google identity.');
    var configuredAdmin = PropertiesService.getScriptProperties().getProperty('wap.phase1.bootstrapAdminEmail');
    if (!configuredAdmin || configuredAdmin.toLowerCase() !== email) {
      this.audit_.write(null, 'authorization.denied', 'bootstrap', email, { reason: 'BOOTSTRAP_ADMIN_NOT_AUTHORIZED' });
      throw new Phase1Error('FORBIDDEN', 'The signed-in identity is not configured as the bootstrap administrator.');
    }
    this.repository_.create('bootstrap', { id: 'phase1', claimedAt: Phase1Ids.now(), claimedBy: email });
    var now = Phase1Ids.now(), roleIds = {}, self = this;
    Phase1Constants.ROLE_KEYS.forEach(function (key) {
      var definition = Phase1RoleDefinitions[key], role = { id: Phase1Ids.create('role'), key: key, name: definition.name, permissions: definition.permissions, status: Phase1Constants.ACTIVE, createdAt: now, updatedAt: now };
      self.repository_.create('roles', role); roleIds[key] = role.id;
    });
    var admin = { id: Phase1Ids.create('user'), email: email, displayName: Phase1Validation.requiredString(profile.displayName, 'displayName'),
      status: Phase1Constants.ACTIVE, roleIds: [roleIds[Phase1Roles.ADMIN]], createdAt: now, updatedAt: now };
    this.repository_.create('users', admin);
    this.audit_.write(admin.id, 'phase1.bootstrapped', 'user', admin.id, {}); return admin;
  }
  createUser(input) {
    var actor = this.access_.require(Phase1Permissions.USERS_MANAGE), now = Phase1Ids.now(), email = Phase1Validation.email(input.email);
    if (this.repository_.findOne('users', function (user) { return user.email === email; })) throw new Phase1Error('CONFLICT', 'A user with this email exists.');
    var roleIds = Phase1Validation.stringArray(input.roleIds || [], 'roleIds'); this.assertRoleIds_(roleIds);
    var record = { id: Phase1Ids.create('user'), email: email, displayName: Phase1Validation.requiredString(input.displayName, 'displayName'),
      status: input.status || Phase1Constants.ACTIVE, roleIds: roleIds, createdAt: now, updatedAt: now };
    Phase1Validation.enumValue(record.status, [Phase1Constants.ACTIVE, Phase1Constants.INACTIVE, Phase1Constants.SUSPENDED], 'status'); this.repository_.create('users', record);
    this.audit_.write(actor.id, 'user.created', 'user', record.id, { email: record.email }); return record;
  }
  updateUser(id, patch) { return this.updateEntity_('users', id, patch, Phase1Permissions.USERS_MANAGE, 'user.updated'); }
  listUsers() { this.access_.require(Phase1Permissions.USERS_MANAGE); return this.repository_.list('users').map(sanitizeUserRecord_); }
  listRoles() { this.access_.require(Phase1Permissions.USERS_MANAGE); return this.repository_.list('roles'); }
  createTeam(input) {
    var actor = this.access_.require(Phase1Permissions.TEAMS_MANAGE_ALL), now = Phase1Ids.now(), ownerUserId = Phase1Validation.requiredString(input.ownerUserId, 'ownerUserId'), owner = this.repository_.get('users', ownerUserId);
    if (!owner || !this.access_.hasRole(owner, Phase1Roles.SITE_MANAGER)) throw new Phase1Error('VALIDATION_ERROR', 'ownerUserId must reference a SITE_MANAGER.');
    var record = { id: Phase1Ids.create('team'), name: Phase1Validation.requiredString(input.name, 'name'), ownerUserId: ownerUserId, status: input.status || Phase1Constants.ACTIVE, createdAt: now, updatedAt: now };
    this.repository_.create('teams', record); this.audit_.write(actor.id, 'team.created', 'team', record.id, {}); return record;
  }
  updateTeam(id, patch) { var actor = this.access_.requireTeamOperation(Phase1Permissions.TEAMS_CONTROL_OWN, id), safePatch = this.validatePatch_('teams', patch), record = this.repository_.update('teams', id, safePatch); this.audit_.write(actor.id, 'team.updated', 'teams', id, {}); return record; }
  listTeams() { var actor = this.access_.currentUser(), teams = this.repository_.list('teams'); if (this.access_.hasRole(actor, Phase1Roles.ADMIN)) return teams; return teams.filter(function (team) { return team.ownerUserId === actor.id || !!this.repository_.findOne('teamMembers', function (member) { return member.teamId === team.id && member.userId === actor.id && member.status === Phase1Constants.ACTIVE; }); }, this); }
  addTeamMember(input) {
    var actor = this.access_.requireTeamOperation(Phase1Permissions.TEAMS_CONTROL_OWN, input.teamId), now = Phase1Ids.now();
    if (!this.repository_.get('teams', input.teamId) || !this.repository_.get('users', input.userId)) throw new Phase1Error('NOT_FOUND', 'Team or user was not found.');
    if (this.repository_.findOne('teamMembers', function (m) { return m.teamId === input.teamId && m.userId === input.userId; })) throw new Phase1Error('CONFLICT', 'User is already a member of this team.');
    var record = { id: Phase1Ids.create('teamMember'), teamId: Phase1Validation.requiredString(input.teamId, 'teamId'), userId: Phase1Validation.requiredString(input.userId, 'userId'),
      status: input.status || Phase1Constants.ACTIVE, numberIds: Phase1Validation.stringArray(input.numberIds || [], 'numberIds'), createdAt: now, updatedAt: now };
    this.repository_.create('teamMembers', record); this.audit_.write(actor.id, 'teamMember.created', 'teamMember', record.id, {}); return record;
  }
  listTeamMembers(teamId) {
    this.access_.requireTeamOperation(Phase1Permissions.TEAMS_CONTROL_OWN, teamId);
    return this.repository_.list('teamMembers').filter(function (member) { return member.teamId === teamId; });
  }
  updateTeamMember(id, patch) { var member = this.repository_.get('teamMembers', id); if (!member) throw new Phase1Error('NOT_FOUND', 'Team member was not found.'); var actor = this.access_.requireTeamOperation(Phase1Permissions.TEAMS_CONTROL_OWN, member.teamId), safePatch = this.validatePatch_('teamMembers', patch), record = this.repository_.update('teamMembers', id, safePatch); this.audit_.write(actor.id, 'teamMember.updated', 'teamMember', id, {}); return record; }
  grantNumberAccess(input) {
    var actor = this.access_.require(Phase1Permissions.NUMBERS_ADMIN), now = Phase1Ids.now(), numberId = Phase1Validation.requiredString(input.numberId, 'numberId');
    if (!this.repository_.get('users', input.userId)) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    if (this.repository_.findOne('numberAccess', function (item) { return item.userId === input.userId && item.numberId === numberId; })) throw new Phase1Error('CONFLICT', 'Number access already exists.');
    var record = { id: Phase1Ids.create('numberAccess'), userId: Phase1Validation.requiredString(input.userId, 'userId'), numberId: numberId,
      granted: true, status: Phase1Constants.ACTIVE, createdAt: now, updatedAt: now };
    this.repository_.create('numberAccess', record); this.audit_.write(actor.id, 'numberAccess.granted', 'numberAccess', record.id, { numberId: numberId }); return record;
  }
  revokeNumberAccess(id) { return this.updateEntity_('numberAccess', id, { status: Phase1Constants.INACTIVE, granted: false }, Phase1Permissions.NUMBERS_ADMIN, 'numberAccess.revoked'); }
  listNumberAccess() { this.access_.require(Phase1Permissions.NUMBERS_ADMIN); return this.repository_.list('numberAccess'); }
  setAvailability(status) {
    var actor = this.access_.require(Phase1Permissions.AVAILABILITY_MANAGE_SELF); status = Phase1Validation.enumValue(status, [Phase1Constants.AVAILABLE, Phase1Constants.BUSY, Phase1Constants.OFFLINE, Phase1Constants.ON_LEAVE], 'status');
    var now = Phase1Ids.now(), record = { userId: actor.id, status: status, createdAt: now, updatedAt: now }; this.repository_.replace('availability', actor.id, record);
    this.audit_.write(actor.id, 'availability.set', 'availability', actor.id, { status: status }); return record;
  }
  setUserAvailability(userId, status) {
    var actor = this.access_.require(Phase1Permissions.AVAILABILITY_MANAGE_ALL);
    if (!this.repository_.get('users', userId)) throw new Phase1Error('NOT_FOUND', 'User was not found.');
    status = Phase1Validation.enumValue(status, [Phase1Constants.AVAILABLE, Phase1Constants.BUSY, Phase1Constants.OFFLINE, Phase1Constants.ON_LEAVE], 'status');
    var now = Phase1Ids.now(), prior = this.repository_.get('availability', userId);
    var record = { userId: userId, status: status, createdAt: prior ? prior.createdAt : now, updatedAt: now }; this.repository_.replace('availability', userId, record);
    this.audit_.write(actor.id, 'availability.setForUser', 'availability', userId, { status: status }); return record;
  }
  getAvailability(userId) { var actor = this.access_.currentUser(); if (actor.id !== userId) this.access_.require(Phase1Permissions.AVAILABILITY_MANAGE_ALL); return this.repository_.get('availability', userId); }
  setAssignmentEligibility(input) { var actor = this.access_.currentUser(); if (this.access_.hasRole(actor, Phase1Roles.ADMIN)) this.access_.require(Phase1Permissions.ELIGIBILITY_MANAGE_ALL); else this.access_.requireTeamOperation(Phase1Permissions.ELIGIBILITY_MANAGE_TEAM, input.teamId); var record = { id: input.userId + ':' + input.numberId, userId: Phase1Validation.requiredString(input.userId, 'userId'), numberId: Phase1Validation.requiredString(input.numberId, 'numberId'), teamId: Phase1Validation.requiredString(input.teamId, 'teamId'), eligible: input.eligible === true, updatedAt: Phase1Ids.now() }; this.repository_.replace('assignmentEligibility', record.id, record); this.audit_.write(actor.id, 'assignmentEligibility.set', 'assignmentEligibility', record.id, { eligible: record.eligible }); return record; }
  getAssignmentEligibility(userId, numberId) { var actor = this.access_.currentUser(); if (actor.id !== userId && !this.access_.hasRole(actor, Phase1Roles.ADMIN)) throw new Phase1Error('FORBIDDEN', 'Eligibility may only be viewed for the signed-in user.'); return this.eligibility_.evaluate(userId, numberId); }
  listAuditLog() { this.access_.require(Phase1Permissions.AUDIT_READ); return this.audit_.list().sort(function (a, b) { return b.occurredAt.localeCompare(a.occurredAt); }); }
  /** The signed-in user's own identity + role keys — used by the UI to decide what to show (e.g. the Admin Panel link), never as a server-side authorization decision itself. */
  whoAmI() {
    var actor = this.access_.currentUser();
    var roleKeys = this.access_.rolesFor(actor).map(function (role) { return role.key; });
    // Checked again here (not just at login) so a forced password change can't be
    // skipped by staying signed in past the login moment — see PasswordAuthServices.gs.
    return { id: actor.id, email: actor.email, displayName: actor.displayName, roleKeys: roleKeys, mustChangePassword: !!actor.mustChangePassword };
  }
  updateEntity_(collection, id, patch, permission, action) {
    var actor = this.access_.require(permission); if (!patch || typeof patch !== 'object') throw new Phase1Error('VALIDATION_ERROR', 'patch is required.');
    var prior = this.repository_.get(collection, id); if (!prior) throw new Phase1Error('NOT_FOUND', collection + ' record was not found.');
    var safePatch = this.validatePatch_(collection, patch);
    if (collection === 'users' && safePatch.email && safePatch.email !== prior.email) {
      var duplicateUser = this.repository_.findOne('users', function (user) { return user.email === safePatch.email; });
      if (duplicateUser) throw new Phase1Error('CONFLICT', 'A user with this email exists.');
    }
    if (collection === 'roles' && safePatch.key && safePatch.key !== prior.key) {
      var duplicateRole = this.repository_.findOne('roles', function (role) { return role.key === safePatch.key; });
      if (duplicateRole) throw new Phase1Error('CONFLICT', 'Role key already exists.');
    }
    var record = this.repository_.update(collection, id, safePatch); this.audit_.write(actor.id, action, collection, id, {});
    return collection === 'users' ? sanitizeUserRecord_(record) : record;
  }
  assertRoleIds_(roleIds) {
    var repository = this.repository_; roleIds.forEach(function (roleId) { if (!repository.get('roles', roleId)) throw new Phase1Error('NOT_FOUND', 'Role was not found: ' + roleId); });
  }
  validatePatch_(collection, patch) {
    var allowed = {
      users: ['email', 'displayName', 'status', 'roleIds'], roles: ['key', 'name', 'permissions', 'status'], teams: ['name', 'status'],
      teamMembers: ['status', 'numberIds'], numberAccess: ['status', 'granted']
    }[collection];
    if (!allowed) throw new Phase1Error('VALIDATION_ERROR', 'Collection cannot be updated.');
    var result = {}, self = this;
    Object.keys(patch).forEach(function (key) {
      if (allowed.indexOf(key) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Field cannot be updated: ' + key);
      result[key] = patch[key];
    });
    if (Object.keys(result).length === 0) throw new Phase1Error('VALIDATION_ERROR', 'At least one permitted field is required.');
    if (result.email !== undefined) result.email = Phase1Validation.email(result.email);
    if (result.displayName !== undefined) result.displayName = Phase1Validation.requiredString(result.displayName, 'displayName');
    if (result.name !== undefined) result.name = Phase1Validation.requiredString(result.name, 'name');
    if (result.key !== undefined && !/^[a-z][a-z0-9_]*$/.test(result.key)) throw new Phase1Error('VALIDATION_ERROR', 'role key must be lowercase snake_case.');
    if (result.status !== undefined) Phase1Validation.enumValue(result.status, collection === 'users' ? [Phase1Constants.ACTIVE, Phase1Constants.INACTIVE, Phase1Constants.SUSPENDED] : [Phase1Constants.ACTIVE, Phase1Constants.INACTIVE], 'status');
    if (result.granted !== undefined && typeof result.granted !== 'boolean') throw new Phase1Error('VALIDATION_ERROR', 'granted must be boolean.');
    if (result.roleIds !== undefined) { result.roleIds = Phase1Validation.stringArray(result.roleIds, 'roleIds'); self.assertRoleIds_(result.roleIds); }
    if (result.numberIds !== undefined) result.numberIds = Phase1Validation.stringArray(result.numberIds, 'numberIds');
    if (result.permissions !== undefined) { result.permissions = Phase1Validation.stringArray(result.permissions, 'permissions'); result.permissions.forEach(function (permission) {
      if (Phase1Constants.ALL_PERMISSIONS.indexOf(permission) === -1) throw new Phase1Error('VALIDATION_ERROR', 'Unknown permission: ' + permission);
    }); }
    return result;
  }
}
