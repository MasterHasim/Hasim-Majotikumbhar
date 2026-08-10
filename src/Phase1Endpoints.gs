/** Public Apps Script entry points. UI/API adapters call these; no provider integration is exposed. */
function phase1Api_() { return new Phase1Api(); }
function bootstrapPhase1(profile) { return phase1Api_().bootstrap(profile); }
function createUser(input) { return phase1Api_().createUser(input); }
function updateUser(id, patch) { return phase1Api_().updateUser(id, patch); }
function listUsers() { return phase1Api_().listUsers(); }
function listRoles() { return phase1Api_().listRoles(); }
function createTeam(input) { return phase1Api_().createTeam(input); }
function updateTeam(id, patch) { return phase1Api_().updateTeam(id, patch); }
function listTeams() { return phase1Api_().listTeams(); }
function listTeamMembers(teamId) { return phase1Api_().listTeamMembers(teamId); }
function addTeamMember(input) { return phase1Api_().addTeamMember(input); }
function updateTeamMember(id, patch) { return phase1Api_().updateTeamMember(id, patch); }
function grantNumberAccess(input) { return phase1Api_().grantNumberAccess(input); }
function revokeNumberAccess(id) { return phase1Api_().revokeNumberAccess(id); }
function listNumberAccess() { return phase1Api_().listNumberAccess(); }
function setAvailability(status) { return phase1Api_().setAvailability(status); }
function setUserAvailability(userId, status) { return phase1Api_().setUserAvailability(userId, status); }
function getAvailability(userId) { return phase1Api_().getAvailability(userId); }
function getAssignmentEligibility(userId, numberId) { return phase1Api_().getAssignmentEligibility(userId, numberId); }
function setAssignmentEligibility(input) { return phase1Api_().setAssignmentEligibility(input); }
function authorizeConversationOperation(action, context) { return phase1Api_().access_.requireConversationOperation(action, context); }
function listAuditLog() { return phase1Api_().listAuditLog(); }
function whoAmI() { return phase1Api_().whoAmI(); }
