/** Frontend-side mirror of the subset of webapp/backend/src/domain/types.ts the Inbox UI needs. Kept independent (separate package) rather than imported across the build boundary. */

export interface WhatsAppNumber {
  id: string;
  displayName: string;
  phoneNumber: string;
  active: boolean;
}

export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string;
  company: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  numberId: string;
  assignedUserId: string;
  status: 'OPEN' | 'CLOSED';
  needsResponse: boolean;
  lastMessageAt: string;
  createdAt: string;
}

export interface ConversationListItem extends Conversation {
  customerName: string;
  customerPhone: string;
}

export type MessageStatus = 'RECEIVED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'UNKNOWN';

export interface Message {
  id: string;
  conversationId: string;
  senderUserId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  messageType: string;
  messageText: string;
  status: MessageStatus;
  timestamp: string;
  senderName?: string | null;
}

export interface Stage {
  id: string;
  key: string;
  name: string;
  sequenceOrder: number;
  active: boolean;
}

export interface CustomerStage {
  customerId: string;
  stageId: string;
  setByUserId: string;
  updatedAt: string;
}

export interface Remark {
  id: string;
  conversationId: string;
  authorUserId: string;
  text: string;
  createdAt: string;
}

export type ReminderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';

export interface Reminder {
  id: string;
  conversationId: string;
  ownerUserId: string;
  text: string;
  dueAt: string;
  status: ReminderStatus;
}

export interface SnoozeStatus {
  snoozed: boolean;
  snoozedUntil?: string;
}

export interface AssignableUser {
  id: string;
  displayName: string;
  email: string;
}

export interface Workspace {
  conversation: Conversation;
  customer: Customer | null;
  number: WhatsAppNumber | null;
  messages: Message[];
  assignedUserName: string | null;
  stage: CustomerStage | null;
  remarks: Remark[] | null;
  reminders: Reminder[] | null;
  snoozeStatus: SnoozeStatus | null;
  assignableUsers: AssignableUser[];
}

export interface WhoAmI {
  id: string;
  email: string;
  displayName: string;
  roleKeys: string[];
}
