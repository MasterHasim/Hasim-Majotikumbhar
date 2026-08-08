class AuthService {
  constructor(auditLog) { this.auditLog_ = auditLog; }
  currentIdentity() {
    var email = Session.getActiveUser().getEmail();
    if (!email) { if (this.auditLog_) try { this.auditLog_.write(null, 'authentication.denied', 'identity', 'anonymous', { reason: 'NO_GOOGLE_WORKSPACE_IDENTITY' }); } catch (ignored) {} throw new Phase1Error('UNAUTHENTICATED', 'A Google Workspace identity is required.'); }
    return { email: email.toLowerCase() };
  }
}

/** The sole server-side authorization boundary for Phase 1. */
class AccessControl {
  constructor(repository, authService, auditLog) { this.repository_ = repository; this.authService_ = authService; this.auditLog_ = auditLog; }
  currentUser() {
    var identity = this.authService_.currentIdentity();
    var user = this.repository_.findOne('users', function (candidate) { return candidate.email === identity.email; });
    if (!user || user.status !== Phase1Constants.ACTIVE) { this.audit_(null, 'authentication.denied', 'identity', identity.email, { reason: !user ? 'UNKNOWN_USER' : 'USER_NOT_ACTIVE' }); throw new Phase1Error('UNAUTHENTICATED', 'The signed-in user is not active in this application.'); }
    this.audit_(user.id, 'authentication.accepted', 'user', user.id, {}); return user;
  }
  rolesFor(user) {
    var ids = user.roleIds || [];
    return this.repository_.list('roles').filter(function (role) { return role.status === Phase1Constants.ACTIVE && ids.indexOf(role.id) !== -1; });
  }
  hasRole(user, roleKey) { return this.rolesFor(user).some(function (role) { return role.key === roleKey; }); }
  require(permission) {
    var user = this.currentUser(), granted = {};
    this.rolesFor(user).forEach(function (role) { role.permissions.forEach(function (item) { granted[item] = true; }); });
    if (!granted[permission]) { this.audit_(user.id, 'authorization.denied', 'permission', permission, {}); throw new Phase1Error('FORBIDDEN', 'Missing permission: ' + permission); }
    return user;
  }
  requireTeamOperation(permission, teamId) {
    var user = this.currentUser(), team = this.repository_.get('teams', teamId);
    if (!team || team.status !== Phase1Constants.ACTIVE) throw new Phase1Error('NOT_FOUND', 'Active team was not found.');
    if (this.hasRole(user, Phase1Roles.ADMIN)) return user;
    this.require(permission);
    var membership = this.repository_.findOne('teamMembers', function (item) { return item.teamId === teamId && item.userId === user.id && item.status === Phase1Constants.ACTIVE; });
    if (this.hasRole(user, Phase1Roles.SUPERVISOR) && membership) return user;
    if (this.hasRole(user, Phase1Roles.SITE_MANAGER) && team.ownerUserId === user.id) return user;
    this.audit_(user.id, 'authorization.denied', 'team', teamId, { reason: 'TEAM_SCOPE' }); throw new Phase1Error('FORBIDDEN', 'The user cannot operate on this team.');
  }
  requireConversationOperation(action, context) {
    context = context || {}; var user = this.currentUser(), numberId = Phase1Validation.requiredString(context.numberId, 'numberId');
    if (!this.hasRole(user, Phase1Roles.ADMIN) && !this.hasGrantedNumber_(user.id, numberId)) return this.denied_(user, 'number', numberId, 'NUMBER_ACCESS');
    if (action === 'view') {
      if (this.hasRole(user, Phase1Roles.ADMIN)) return user;
      if (this.hasRole(user, Phase1Roles.VIEWER)) return this.require(Phase1Permissions.CONVERSATIONS_VIEW_AUTHORIZED);
      if (this.hasRole(user, Phase1Roles.AGENT) && context.assignedUserId === user.id) return this.require(Phase1Permissions.CONVERSATIONS_VIEW_ASSIGNED);
      if ((this.hasRole(user, Phase1Roles.SUPERVISOR) || this.hasRole(user, Phase1Roles.SITE_MANAGER)) && context.teamId) return this.requireTeamOperation(Phase1Permissions.CONVERSATIONS_VIEW_TEAM, context.teamId);
    }
    if (action === 'reply' && this.hasRole(user, Phase1Roles.AGENT) && context.assignedUserId === user.id) return this.require(Phase1Permissions.CONVERSATIONS_REPLY_ASSIGNED);
    if (action === 'reassign' && context.teamId) {
      if (this.hasRole(user, Phase1Roles.ADMIN)) return this.require(Phase1Permissions.CONVERSATIONS_REASSIGN_GLOBAL);
      if (this.hasRole(user, Phase1Roles.SUPERVISOR) || this.hasRole(user, Phase1Roles.SITE_MANAGER)) return this.requireTeamOperation(Phase1Permissions.CONVERSATIONS_REASSIGN_TEAM, context.teamId);
    }
    return this.denied_(user, 'conversationOperation', action, 'ROLE_OR_ASSIGNMENT_SCOPE');
  }
  hasGrantedNumber_(userId, numberId) { return !!this.repository_.findOne('numberAccess', function (item) { return item.userId === userId && item.numberId === numberId && item.status === Phase1Constants.ACTIVE && item.granted === true; }); }
  denied_(user, targetType, targetId, reason) { this.audit_(user.id, 'authorization.denied', targetType, targetId, { reason: reason }); throw new Phase1Error('FORBIDDEN', 'Access is denied.'); }
  audit_(actorUserId, action, targetType, targetId, metadata) { try { this.auditLog_.write(actorUserId, action, targetType, targetId, metadata); } catch (ignored) {} }
}
