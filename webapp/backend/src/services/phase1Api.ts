/**
 * Direct port of apps-script/src/Phase1Services.gs's Phase1Api + AssignmentEligibilityService.
 * Same method names, same validation rules, same audit actions — see that file
 * for the original synchronous version this is ported from.
 */
import { ApiError } from '../types';
import { ALL_PERMISSIONS, Ids, Permissions, RoleDefinitions, ROLE_KEYS, Roles, Status, Validation, type Permission, type RoleKey } from '../domain/phase1';
import type { AssignmentEligibility, Availability, NumberAccess, Role, Team, TeamMember, User } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { FirebaseDb } from '../lib/firebaseAdmin';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

// The Apps Script build's sanitizeUserRecord_ stripped passwordHash/passwordSalt
// before any user record reached the client (see Phase1Services.gs) — not needed
// here, since Firebase Auth owns credentials entirely out of band, nothing
// password-related is ever stored on the User record itself. Kept as a named
// pass-through in case a future field needs stripping again.
function sanitizeUser(user: User): User {
  return { ...user };
}

class AssignmentEligibilityService {
  constructor(
    private users: Repository<User>,
    private eligibility: Repository<AssignmentEligibility>,
    private availability: Repository<Availability>,
    private numberAccess: Repository<NumberAccess>,
    private teamMembers: Repository<TeamMember>,
    private teams: Repository<Team>
  ) {}

  async evaluate(userId: string, numberId: string) {
    const user = await this.users.get(userId);
    if (!user || user.status !== Status.ACTIVE) return { assignmentEligible: false, availability: null, assignableNow: false, reasons: ['USER_INACTIVE'] };

    const elig = await this.eligibility.get(`${userId}:${numberId}`);
    if (!elig || elig.eligible !== true) return { assignmentEligible: false, availability: null, assignableNow: false, reasons: ['ELIGIBILITY_NOT_GRANTED'] };

    const availability = await this.availability.get(userId);
    const availabilityStatus = availability ? availability.status : 'offline';

    const access = await this.numberAccess.findOne((item) => item.userId === userId && item.numberId === numberId && item.status === Status.ACTIVE);
    if (!access || access.granted !== true) return { assignmentEligible: false, availability: availabilityStatus, assignableNow: false, reasons: ['NO_GRANTED_NUMBER_ACCESS'] };

    const memberships = (await this.teamMembers.list()).filter((m) => m.userId === userId && m.status === Status.ACTIVE);
    const teams = await this.teams.list();
    const enabled = memberships.some((member) => {
      const team = teams.find((t) => t.id === member.teamId && t.status === Status.ACTIVE);
      return !!team && (member.numberIds.length === 0 || member.numberIds.includes(numberId));
    });
    if (!enabled) return { assignmentEligible: false, availability: availabilityStatus, assignableNow: false, reasons: ['NO_ACTIVE_ELIGIBLE_TEAM'] };

    return { assignmentEligible: true, availability: availabilityStatus, assignableNow: availabilityStatus === 'available', reasons: availabilityStatus === 'available' ? [] : ['NOT_AVAILABLE'] };
  }
}

export class Phase1Api {
  private repos: Phase1Repositories;
  /** Public — reused directly by later phases' services for authorization checks, same as Apps Script's Phase1Api.access_ being reached into by other PhaseNApi classes. */
  readonly access: AccessControl;
  private audit: AuditLogService;
  private eligibilitySvc: AssignmentEligibilityService;
  private teamMembers: Repository<TeamMember>;
  private availabilityRepo: Repository<Availability>;
  private eligibilityRepo: Repository<AssignmentEligibility>;

  constructor(db: FirebaseDb, identityEmail: string) {
    this.repos = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(this.repos, this.audit, identityEmail);
    this.teamMembers = this.repos.teamMembers;
    this.availabilityRepo = new Repository<Availability>(db, 'availability');
    this.eligibilityRepo = new Repository<AssignmentEligibility>(db, 'assignmentEligibility');
    this.eligibilitySvc = new AssignmentEligibilityService(this.repos.users, this.eligibilityRepo, this.availabilityRepo, this.repos.numberAccess, this.teamMembers, this.repos.teams);
  }

  async bootstrap(profile: { email: string; displayName: string }, bootstrapAdminEmail: string | undefined, identityEmail: string): Promise<User> {
    if ((await this.repos.users.count()) !== 0) throw new ApiError(409, 'CONFLICT', 'Phase 1 is already bootstrapped.');
    const email = Validation.email(profile?.email);
    if (identityEmail !== email) throw new ApiError(403, 'FORBIDDEN', 'Bootstrap email must match the signed-in identity.');
    if (!bootstrapAdminEmail || bootstrapAdminEmail.toLowerCase() !== email) {
      await this.audit.write(null, 'authorization.denied', 'bootstrap', email, { reason: 'BOOTSTRAP_ADMIN_NOT_AUTHORIZED' });
      throw new ApiError(403, 'FORBIDDEN', 'The signed-in identity is not configured as the bootstrap administrator.');
    }
    const now = Ids.now();
    const roleIds: Partial<Record<RoleKey, string>> = {};
    for (const key of ROLE_KEYS) {
      const def = RoleDefinitions[key];
      const role: Role = { id: Ids.create('role'), key, name: def.name, permissions: def.permissions, status: Status.ACTIVE as 'active', createdAt: now, updatedAt: now };
      await this.repos.roles.create(role);
      roleIds[key] = role.id;
    }
    const admin: User = {
      id: Ids.create('user'), email, displayName: Validation.requiredString(profile.displayName, 'displayName'),
      status: Status.ACTIVE, roleIds: [roleIds.ADMIN!], phone: '', createdAt: now, updatedAt: now,
    };
    await this.repos.users.create(admin);
    await this.audit.write(admin.id, 'phase1.bootstrapped', 'user', admin.id, {});
    return admin;
  }

  async createUser(input: { email: string; displayName: string; roleIds?: string[]; status?: string; phone?: string }): Promise<User> {
    const actor = await this.access.require(Permissions.USERS_MANAGE);
    const now = Ids.now();
    const email = Validation.email(input.email);
    if (await this.repos.users.findOne((u) => u.email === email)) throw new ApiError(409, 'CONFLICT', 'A user with this email exists.');
    const roleIds = Validation.stringArray(input.roleIds ?? [], 'roleIds');
    await this.assertRoleIds(roleIds);
    const status = Validation.enumValue(input.status ?? Status.ACTIVE, [Status.ACTIVE, Status.INACTIVE, Status.SUSPENDED], 'status');
    const record: User = { id: Ids.create('user'), email, displayName: Validation.requiredString(input.displayName, 'displayName'), status, roleIds, phone: (input.phone || '').toString().trim(), createdAt: now, updatedAt: now };
    await this.repos.users.create(record);
    await this.audit.write(actor.id, 'user.created', 'user', record.id, { email: record.email });
    return record;
  }

  async updateUser(id: string, patch: Record<string, unknown>): Promise<User> {
    return this.updateEntity('users', this.repos.users, id, patch, Permissions.USERS_MANAGE, 'user.updated');
  }

  async listUsers(): Promise<User[]> {
    await this.access.require(Permissions.USERS_MANAGE);
    return (await this.repos.users.list()).map(sanitizeUser);
  }

  async listRoles(): Promise<Role[]> {
    await this.access.require(Permissions.USERS_MANAGE);
    return this.repos.roles.list();
  }

  async createTeam(input: { ownerUserId: string; name: string; status?: string }): Promise<Team> {
    const actor = await this.access.require(Permissions.TEAMS_MANAGE_ALL);
    const now = Ids.now();
    const ownerUserId = Validation.requiredString(input.ownerUserId, 'ownerUserId');
    const owner = await this.repos.users.get(ownerUserId);
    if (!owner || !(await this.access.hasRole(owner, Roles.SITE_MANAGER))) throw new ApiError(400, 'VALIDATION_ERROR', 'ownerUserId must reference a SITE_MANAGER.');
    const record: Team = { id: Ids.create('team'), name: Validation.requiredString(input.name, 'name'), ownerUserId, status: (input.status as 'active' | 'inactive') ?? Status.ACTIVE, createdAt: now, updatedAt: now };
    await this.repos.teams.create(record);
    await this.audit.write(actor.id, 'team.created', 'team', record.id, {});
    return record;
  }

  async updateTeam(id: string, patch: Record<string, unknown>): Promise<Team> {
    const actor = await this.access.requireTeamOperation(Permissions.TEAMS_CONTROL_OWN, id);
    const safePatch = await this.validatePatch('teams', patch);
    const record = await this.repos.teams.update(id, safePatch);
    await this.audit.write(actor.id, 'team.updated', 'teams', id, {});
    return record;
  }

  async listTeams(): Promise<Team[]> {
    const actor = await this.access.currentUser();
    const teams = await this.repos.teams.list();
    if (await this.access.hasRole(actor, Roles.ADMIN)) return teams;
    const members = await this.repos.teamMembers.list();
    return teams.filter((team) => team.ownerUserId === actor.id || members.some((m) => m.teamId === team.id && m.userId === actor.id && m.status === Status.ACTIVE));
  }

  async addTeamMember(input: { teamId: string; userId: string; status?: string; numberIds?: string[] }): Promise<TeamMember> {
    const actor = await this.access.requireTeamOperation(Permissions.TEAMS_CONTROL_OWN, input.teamId);
    const now = Ids.now();
    if (!(await this.repos.teams.get(input.teamId)) || !(await this.repos.users.get(input.userId))) throw new ApiError(404, 'NOT_FOUND', 'Team or user was not found.');
    if (await this.repos.teamMembers.findOne((m) => m.teamId === input.teamId && m.userId === input.userId)) throw new ApiError(409, 'CONFLICT', 'User is already a member of this team.');
    const record: TeamMember = {
      id: Ids.create('teamMember'), teamId: Validation.requiredString(input.teamId, 'teamId'), userId: Validation.requiredString(input.userId, 'userId'),
      status: (input.status as 'active' | 'inactive') ?? Status.ACTIVE, numberIds: Validation.stringArray(input.numberIds ?? [], 'numberIds'), createdAt: now, updatedAt: now,
    };
    await this.repos.teamMembers.create(record);
    await this.audit.write(actor.id, 'teamMember.created', 'teamMember', record.id, {});
    return record;
  }

  async listTeamMembers(teamId: string): Promise<TeamMember[]> {
    await this.access.requireTeamOperation(Permissions.TEAMS_CONTROL_OWN, teamId);
    return (await this.repos.teamMembers.list()).filter((m) => m.teamId === teamId);
  }

  async updateTeamMember(id: string, patch: Record<string, unknown>): Promise<TeamMember> {
    const member = await this.repos.teamMembers.get(id);
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Team member was not found.');
    const actor = await this.access.requireTeamOperation(Permissions.TEAMS_CONTROL_OWN, member.teamId);
    const safePatch = await this.validatePatch('teamMembers', patch);
    const record = await this.repos.teamMembers.update(id, safePatch);
    await this.audit.write(actor.id, 'teamMember.updated', 'teamMember', id, {});
    return record;
  }

  async grantNumberAccess(input: { userId: string; numberId: string }): Promise<NumberAccess> {
    const actor = await this.access.require(Permissions.NUMBERS_ADMIN);
    const now = Ids.now();
    const numberId = Validation.requiredString(input.numberId, 'numberId');
    if (!(await this.repos.users.get(input.userId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    if (await this.repos.numberAccess.findOne((item) => item.userId === input.userId && item.numberId === numberId)) throw new ApiError(409, 'CONFLICT', 'Number access already exists.');
    const record: NumberAccess = { id: Ids.create('numberAccess'), userId: Validation.requiredString(input.userId, 'userId'), numberId, granted: true, status: Status.ACTIVE, createdAt: now, updatedAt: now };
    await this.repos.numberAccess.create(record);
    await this.audit.write(actor.id, 'numberAccess.granted', 'numberAccess', record.id, { numberId });
    return record;
  }

  async revokeNumberAccess(id: string): Promise<NumberAccess> {
    return this.updateEntity('numberAccess', this.repos.numberAccess, id, { status: Status.INACTIVE, granted: false }, Permissions.NUMBERS_ADMIN, 'numberAccess.revoked');
  }

  async reactivateNumberAccess(id: string): Promise<NumberAccess> {
    return this.updateEntity('numberAccess', this.repos.numberAccess, id, { status: Status.ACTIVE, granted: true }, Permissions.NUMBERS_ADMIN, 'numberAccess.reactivated');
  }

  async listNumberAccess(): Promise<NumberAccess[]> {
    await this.access.require(Permissions.NUMBERS_ADMIN);
    return this.repos.numberAccess.list();
  }

  async setAvailability(status: string): Promise<Availability> {
    const actor = await this.access.require(Permissions.AVAILABILITY_MANAGE_SELF);
    const validStatus = Validation.enumValue(status, ['available', 'busy', 'offline', 'on_leave'], 'status');
    const now = Ids.now();
    const record: Availability = { id: actor.id, userId: actor.id, status: validStatus, createdAt: now, updatedAt: now };
    await this.availabilityRepo.replace(actor.id, record);
    await this.audit.write(actor.id, 'availability.set', 'availability', actor.id, { status: validStatus });
    return record;
  }

  async setUserAvailability(userId: string, status: string): Promise<Availability> {
    const actor = await this.access.require(Permissions.AVAILABILITY_MANAGE_ALL);
    if (!(await this.repos.users.get(userId))) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
    const validStatus = Validation.enumValue(status, ['available', 'busy', 'offline', 'on_leave'], 'status');
    const prior = await this.availabilityRepo.get(userId);
    const now = Ids.now();
    const record: Availability = { id: userId, userId, status: validStatus, createdAt: prior ? prior.createdAt : now, updatedAt: now };
    await this.availabilityRepo.replace(userId, record);
    await this.audit.write(actor.id, 'availability.setForUser', 'availability', userId, { status: validStatus });
    return record;
  }

  async getAvailability(userId: string): Promise<Availability | null> {
    const actor = await this.access.currentUser();
    if (actor.id !== userId) await this.access.require(Permissions.AVAILABILITY_MANAGE_ALL);
    return this.availabilityRepo.get(userId);
  }

  async setAssignmentEligibility(input: { userId: string; numberId: string; teamId: string; eligible: boolean }): Promise<AssignmentEligibility> {
    const actor = await this.access.currentUser();
    if (await this.access.hasRole(actor, Roles.ADMIN)) await this.access.require(Permissions.ELIGIBILITY_MANAGE_ALL);
    else await this.access.requireTeamOperation(Permissions.ELIGIBILITY_MANAGE_TEAM, input.teamId);
    const record: AssignmentEligibility = {
      id: `${input.userId}:${input.numberId}`, userId: Validation.requiredString(input.userId, 'userId'), numberId: Validation.requiredString(input.numberId, 'numberId'),
      teamId: Validation.requiredString(input.teamId, 'teamId'), eligible: input.eligible === true, updatedAt: Ids.now(),
    };
    await this.eligibilityRepo.replace(record.id, record);
    await this.audit.write(actor.id, 'assignmentEligibility.set', 'assignmentEligibility', record.id, { eligible: record.eligible });
    return record;
  }

  async getAssignmentEligibility(userId: string, numberId: string) {
    const actor = await this.access.currentUser();
    if (actor.id !== userId && !(await this.access.hasRole(actor, Roles.ADMIN))) throw new ApiError(403, 'FORBIDDEN', 'Eligibility may only be viewed for the signed-in user.');
    return this.eligibilitySvc.evaluate(userId, numberId);
  }

  async listAuditLog() {
    await this.access.require(Permissions.AUDIT_READ);
    return this.audit.list();
  }

  async whoAmI() {
    const actor = await this.access.currentUser();
    const roles = await this.access.rolesFor(actor);
    return { id: actor.id, email: actor.email, displayName: actor.displayName, roleKeys: roles.map((r) => r.key) };
  }

  private async updateEntity<T extends { id: string }>(collection: string, repo: Repository<T>, id: string, patch: Record<string, unknown>, permission: string, action: string): Promise<T> {
    const actor = await this.access.require(permission);
    const prior = await repo.get(id);
    if (!prior) throw new ApiError(404, 'NOT_FOUND', `${collection} record was not found.`);
    const safePatch = await this.validatePatch(collection, patch);
    if (collection === 'users' && safePatch.email && safePatch.email !== (prior as unknown as User).email) {
      if (await this.repos.users.findOne((u) => u.email === safePatch.email)) throw new ApiError(409, 'CONFLICT', 'A user with this email exists.');
    }
    if (collection === 'roles' && safePatch.key && safePatch.key !== (prior as unknown as Role).key) {
      if (await this.repos.roles.findOne((r) => r.key === safePatch.key)) throw new ApiError(409, 'CONFLICT', 'Role key already exists.');
    }
    const record = await repo.update(id, safePatch as Partial<T>);
    await this.audit.write(actor.id, action, collection, id, {});
    return collection === 'users' ? (sanitizeUser(record as unknown as User) as unknown as T) : record;
  }

  private async assertRoleIds(roleIds: string[]): Promise<void> {
    for (const roleId of roleIds) {
      if (!(await this.repos.roles.get(roleId))) throw new ApiError(404, 'NOT_FOUND', `Role was not found: ${roleId}`);
    }
  }

  private async validatePatch(collection: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    const allowedFields: Record<string, string[]> = {
      users: ['email', 'displayName', 'status', 'roleIds', 'phone'], roles: ['key', 'name', 'permissions', 'status'], teams: ['name', 'status'],
      teamMembers: ['status', 'numberIds'], numberAccess: ['status', 'granted'],
    };
    const allowed = allowedFields[collection];
    if (!allowed) throw new ApiError(400, 'VALIDATION_ERROR', 'Collection cannot be updated.');
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      result[key] = patch[key];
    }
    if (Object.keys(result).length === 0) throw new ApiError(400, 'VALIDATION_ERROR', 'At least one permitted field is required.');
    if (result.email !== undefined) result.email = Validation.email(result.email);
    if (result.displayName !== undefined) result.displayName = Validation.requiredString(result.displayName, 'displayName');
    if (result.name !== undefined) result.name = Validation.requiredString(result.name, 'name');
    if (result.key !== undefined && !/^[a-z][a-z0-9_]*$/.test(result.key as string)) throw new ApiError(400, 'VALIDATION_ERROR', 'role key must be lowercase snake_case.');
    if (result.status !== undefined) {
      const permitted = collection === 'users' ? [Status.ACTIVE, Status.INACTIVE, Status.SUSPENDED] : [Status.ACTIVE, Status.INACTIVE];
      Validation.enumValue(result.status, permitted, 'status');
    }
    if (result.granted !== undefined && typeof result.granted !== 'boolean') throw new ApiError(400, 'VALIDATION_ERROR', 'granted must be boolean.');
    if (result.roleIds !== undefined) { result.roleIds = Validation.stringArray(result.roleIds, 'roleIds'); await this.assertRoleIds(result.roleIds as string[]); }
    if (result.numberIds !== undefined) result.numberIds = Validation.stringArray(result.numberIds, 'numberIds');
    if (result.permissions !== undefined) {
      result.permissions = Validation.stringArray(result.permissions, 'permissions');
      for (const permission of result.permissions as string[]) {
        if (!ALL_PERMISSIONS.includes(permission as Permission)) throw new ApiError(400, 'VALIDATION_ERROR', `Unknown permission: ${permission}`);
      }
    }
    return result;
  }
}
