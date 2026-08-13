import type { Record_ } from '../lib/repository';
import type { Permission, RoleKey } from './phase1';

export interface User extends Record_ {
  email: string;
  displayName: string;
  status: 'active' | 'inactive' | 'suspended';
  roleIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Role extends Record_ {
  key: RoleKey;
  name: string;
  permissions: Permission[];
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Team extends Record_ {
  name: string;
  ownerUserId: string;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface TeamMember extends Record_ {
  teamId: string;
  userId: string;
  status: 'active' | 'inactive';
  numberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NumberAccess extends Record_ {
  userId: string;
  numberId: string;
  granted: boolean;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
}

export interface Availability extends Record_ {
  userId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentEligibility extends Record_ {
  userId: string;
  numberId: string;
  teamId: string;
  eligible: boolean;
  updatedAt: string;
}
