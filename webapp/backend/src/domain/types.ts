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

// --- Messaging core (port of apps-script/src/Phase2Domain.gs's Phase2Schemas) ---

export interface WhatsAppNumber extends Record_ {
  displayName: string;
  phoneNumber: string;
  provider: string;
  providerAccountId: string;
  wabaId: string;
  providerNumberId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Customer extends Record_ {
  phone: string;
  name: string;
  email: string;
  company: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation extends Record_ {
  customerId: string;
  numberId: string;
  assignedUserId: string;
  status: 'OPEN' | 'CLOSED';
  needsResponse: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'RECEIVED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNKNOWN';

export interface Message extends Record_ {
  conversationId: string;
  numberId: string;
  senderUserId: string;
  direction: MessageDirection;
  messageType: string;
  messageText: string;
  providerMessageId: string;
  status: MessageStatus;
  timestamp: string;
}
