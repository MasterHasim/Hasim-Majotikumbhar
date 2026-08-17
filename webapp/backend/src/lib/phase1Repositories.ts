import type { NumberAccess, Role, Team, TeamMember, User } from '../domain/types';
import { Repository } from './repository';
import type { Phase1Repositories } from './accessControl';
import type { FirebaseDb } from './firebaseAdmin';

/** Every service that needs an AccessControl (Phase3Api, Phase5Api, Phase6Api, ...) builds one from this same bundle of repositories — mirrors how every Apps Script PhaseNApi class constructs its own AccessControl against the same underlying PropertiesRepository. */
export function buildPhase1Repositories(db: FirebaseDb): Phase1Repositories {
  return {
    users: new Repository<User>(db, 'users'),
    roles: new Repository<Role>(db, 'roles'),
    teams: new Repository<Team>(db, 'teams'),
    teamMembers: new Repository<TeamMember>(db, 'teamMembers'),
    numberAccess: new Repository<NumberAccess>(db, 'numberAccess'),
  };
}
