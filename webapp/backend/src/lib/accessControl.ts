/**
 * Direct port of apps-script/src/Phase1AccessControl.gs's AccessControl class —
 * same authorization rules, same method names/shapes, just async (every
 * repository call here is a real network round trip to Firebase, unlike Apps
 * Script's synchronous Properties reads) and driven by an already-verified
 * Firebase ID token's email instead of Session.getActiveUser().
 */
import { ApiError } from '../types';
import { Permissions, Roles, Status, type RoleKey } from '../domain/phase1';
import type { NumberAccess, Role, Team, TeamMember, User } from '../domain/types';
import type { Repository } from './repository';
import type { AuditLogService } from './auditLog';

export interface Phase1Repositories {
  users: Repository<User>;
  roles: Repository<Role>;
  teams: Repository<Team>;
  teamMembers: Repository<TeamMember>;
  numberAccess: Repository<NumberAccess>;
}

export interface ConversationOperationContext {
  numberId: string;
  teamId?: string | null;
  assignedUserId?: string | null;
}

export class AccessControl {
  /** Real bug, confirmed live 2026-08-23: currentUser() is called internally by nearly every
   * other method here (require, requireConversationOperation, requireTeamOperation, ...), and
   * each call wrote a fresh "authentication.accepted" audit entry — 2 subrequests (existence
   * check + write) every time. listConversationsInternal calls requireConversationOperation
   * once per conversation to filter visibility, so a number with 40-plus conversations blew
   * straight through Cloudflare's per-invocation subrequest limit on that alone
   * ("INTERNAL_ERROR: Too many subrequests", reproduced against a real number with 46+ open
   * conversations). One AccessControl instance lives for exactly one request (buildContext
   * constructs a fresh one every time), so caching the resolved user here — and writing the
   * acceptance audit entry only once — is scoped correctly and loses no real audit coverage:
   * the identity was authenticated once for this request either way. */
  private cachedUser: User | undefined;
  /** Real bug, confirmed live 2026-08-23: rolesFor() re-fetched the ENTIRE roles list from
   * Firebase (a fresh subrequest) on every single call, and hasRole() calls rolesFor() every
   * time it's invoked. requireConversationOperation('view', ...) calls hasRole() up to twice
   * per conversation while filtering visibility (once for the numberId gate, once for the
   * action check), so a number with 40+ conversations blew through Cloudflare's per-invocation
   * subrequest limit on this alone — reproduced live even AFTER the currentUser() caching fix
   * above, because that fix only covered the audit-log write, not this separate roles.list()
   * call. Same "one AccessControl instance per request" scoping applies, so caching the full
   * roles list here is safe for the same reason cachedUser is. */
  private cachedRoles: Role[] | undefined;

  constructor(private repos: Phase1Repositories, private auditLog: AuditLogService, private identityEmail: string) {}

  async currentUser(): Promise<User> {
    if (this.cachedUser) return this.cachedUser;
    const user = await this.repos.users.findOne((u) => u.email === this.identityEmail);
    if (!user || user.status !== Status.ACTIVE) {
      await this.audit(null, 'authentication.denied', 'identity', this.identityEmail, { reason: !user ? 'UNKNOWN_USER' : 'USER_NOT_ACTIVE' });
      throw new ApiError(401, 'UNAUTHENTICATED', 'The signed-in user is not active in this application.');
    }
    await this.audit(user.id, 'authentication.accepted', 'user', user.id, {});
    this.cachedUser = user;
    return user;
  }

  async rolesFor(user: User): Promise<Role[]> {
    const ids = user.roleIds || [];
    if (!this.cachedRoles) this.cachedRoles = await this.repos.roles.list();
    return this.cachedRoles.filter((role) => role.status === Status.ACTIVE && ids.includes(role.id));
  }

  async hasRole(user: User, roleKey: RoleKey): Promise<boolean> {
    const roles = await this.rolesFor(user);
    return roles.some((role) => role.key === roleKey);
  }

  async require(permission: string): Promise<User> {
    const user = await this.currentUser();
    const roles = await this.rolesFor(user);
    const granted = new Set(roles.flatMap((role) => role.permissions));
    if (!granted.has(permission as never)) {
      await this.audit(user.id, 'authorization.denied', 'permission', permission, {});
      throw new ApiError(403, 'FORBIDDEN', `Missing permission: ${permission}`);
    }
    return user;
  }

  async requireTeamOperation(permission: string, teamId: string): Promise<User> {
    const user = await this.currentUser();
    const team = await this.repos.teams.get(teamId);
    if (!team || team.status !== Status.ACTIVE) throw new ApiError(404, 'NOT_FOUND', 'Active team was not found.');
    if (await this.hasRole(user, Roles.ADMIN)) return user;
    await this.require(permission);
    const membership = await this.repos.teamMembers.findOne((m) => m.teamId === teamId && m.userId === user.id && m.status === Status.ACTIVE);
    if ((await this.hasRole(user, Roles.SUPERVISOR)) && membership) return user;
    if ((await this.hasRole(user, Roles.SITE_MANAGER)) && team.ownerUserId === user.id) return user;
    await this.audit(user.id, 'authorization.denied', 'team', teamId, { reason: 'TEAM_SCOPE' });
    throw new ApiError(403, 'FORBIDDEN', 'The user cannot operate on this team.');
  }

  async requireConversationOperation(action: 'view' | 'reply' | 'reassign', context: ConversationOperationContext): Promise<User> {
    const user = await this.currentUser();
    const numberId = context.numberId;
    if (!numberId) throw new ApiError(400, 'VALIDATION_ERROR', 'numberId is required.');
    if (!(await this.hasRole(user, Roles.ADMIN)) && !(await this.hasGrantedNumber(user.id, numberId))) {
      return this.denied(user, 'number', numberId, 'NUMBER_ACCESS');
    }
    if (action === 'view') {
      if (await this.hasRole(user, Roles.ADMIN)) return user;
      if (await this.hasRole(user, Roles.VIEWER)) return this.require(Permissions.CONVERSATIONS_VIEW_AUTHORIZED);
      if ((await this.hasRole(user, Roles.AGENT)) && context.assignedUserId === user.id) return this.require(Permissions.CONVERSATIONS_VIEW_ASSIGNED);
      if (((await this.hasRole(user, Roles.SUPERVISOR)) || (await this.hasRole(user, Roles.SITE_MANAGER))) && context.teamId) {
        return this.requireTeamOperation(Permissions.CONVERSATIONS_VIEW_TEAM, context.teamId);
      }
    }
    if (action === 'reply') {
      if (await this.hasRole(user, Roles.ADMIN)) return user;
      if ((await this.hasRole(user, Roles.AGENT)) && context.assignedUserId === user.id) return this.require(Permissions.CONVERSATIONS_REPLY_ASSIGNED);
    }
    if (action === 'reassign') {
      if (await this.hasRole(user, Roles.ADMIN)) return this.require(Permissions.CONVERSATIONS_REASSIGN_GLOBAL);
      if (((await this.hasRole(user, Roles.SUPERVISOR)) || (await this.hasRole(user, Roles.SITE_MANAGER))) && context.teamId) {
        return this.requireTeamOperation(Permissions.CONVERSATIONS_REASSIGN_TEAM, context.teamId);
      }
    }
    return this.denied(user, 'conversationOperation', action, 'ROLE_OR_ASSIGNMENT_SCOPE');
  }

  /** Same team-scope resolution as Phase1AccessControl.gs's resolveTeamIdForNumber — Conversations has no teamId of its own. */
  async resolveTeamIdForNumber(numberId: string): Promise<string | null> {
    const user = await this.currentUser();
    if (await this.hasRole(user, Roles.SITE_MANAGER)) {
      const teams = await this.repos.teams.list();
      const owned = teams.filter((t) => t.status === Status.ACTIVE && t.ownerUserId === user.id);
      const members = await this.repos.teamMembers.list();
      for (const team of owned) {
        // numberIds can be undefined for a member RTDB stored with an empty array — see phase1Api.ts's evaluate() for why.
        const hasNumber = members.some((m) => m.teamId === team.id && m.status === Status.ACTIVE && (m.numberIds ?? []).includes(numberId));
        if (hasNumber) return team.id;
      }
    }
    if (await this.hasRole(user, Roles.SUPERVISOR)) {
      const members = await this.repos.teamMembers.list();
      const membership = members.find((m) => m.userId === user.id && m.status === Status.ACTIVE && (m.numberIds ?? []).includes(numberId));
      if (membership) return membership.teamId;
    }
    return null;
  }

  async hasGrantedNumber(userId: string, numberId: string): Promise<boolean> {
    const access = await this.repos.numberAccess.findOne((item) => item.userId === userId && item.numberId === numberId && item.status === Status.ACTIVE && item.granted === true);
    return !!access;
  }

  /** Same upfront gate apps-script/src/Phase5Services.gs's listConversationsInternal_ applies before its own per-conversation filter — an explicit FORBIDDEN for a completely inaccessible numberId, not a silently empty list (which the per-conversation filter alone would otherwise produce, indistinguishable from "no conversations yet"). */
  async requireGrantedNumberOrAdmin(numberId: string): Promise<User> {
    const user = await this.currentUser();
    if ((await this.hasRole(user, Roles.ADMIN)) || (await this.hasGrantedNumber(user.id, numberId))) return user;
    return this.denied(user, 'number', numberId, 'NUMBER_ACCESS');
  }

  private async denied(user: User, targetType: string, targetId: string, reason: string): Promise<never> {
    await this.audit(user.id, 'authorization.denied', targetType, targetId, { reason });
    throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
  }

  private async audit(actorUserId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.auditLog.write(actorUserId, action, targetType, targetId, metadata);
  }
}
