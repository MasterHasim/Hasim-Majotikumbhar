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
  constructor(private repos: Phase1Repositories, private auditLog: AuditLogService, private identityEmail: string) {}

  async currentUser(): Promise<User> {
    const user = await this.repos.users.findOne((u) => u.email === this.identityEmail);
    if (!user || user.status !== Status.ACTIVE) {
      await this.audit(null, 'authentication.denied', 'identity', this.identityEmail, { reason: !user ? 'UNKNOWN_USER' : 'USER_NOT_ACTIVE' });
      throw new ApiError(401, 'UNAUTHENTICATED', 'The signed-in user is not active in this application.');
    }
    await this.audit(user.id, 'authentication.accepted', 'user', user.id, {});
    return user;
  }

  async rolesFor(user: User): Promise<Role[]> {
    const ids = user.roleIds || [];
    const roles = await this.repos.roles.list();
    return roles.filter((role) => role.status === Status.ACTIVE && ids.includes(role.id));
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
        const hasNumber = members.some((m) => m.teamId === team.id && m.status === Status.ACTIVE && m.numberIds.includes(numberId));
        if (hasNumber) return team.id;
      }
    }
    if (await this.hasRole(user, Roles.SUPERVISOR)) {
      const members = await this.repos.teamMembers.list();
      const membership = members.find((m) => m.userId === user.id && m.status === Status.ACTIVE && m.numberIds.includes(numberId));
      if (membership) return membership.teamId;
    }
    return null;
  }

  async hasGrantedNumber(userId: string, numberId: string): Promise<boolean> {
    const access = await this.repos.numberAccess.findOne((item) => item.userId === userId && item.numberId === numberId && item.status === Status.ACTIVE && item.granted === true);
    return !!access;
  }

  private async denied(user: User, targetType: string, targetId: string, reason: string): Promise<never> {
    await this.audit(user.id, 'authorization.denied', targetType, targetId, { reason });
    throw new ApiError(403, 'FORBIDDEN', 'Access is denied.');
  }

  private async audit(actorUserId: string | null, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.auditLog.write(actorUserId, action, targetType, targetId, metadata);
  }
}
