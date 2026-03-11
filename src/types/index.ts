export interface GmailAccount {
  id: string;
  user_id: string;
  email: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  history_id: string | null;
  last_sync_at: string | null;
  sync_enabled: boolean;
  granted_scope: string;
  created_at: string;
}

export interface Email {
  id: string;
  gmail_account_id: string;
  gmail_message_id: string;
  thread_id: string | null;
  subject: string | null;
  sender_email: string | null;
  sender_name: string | null;
  sender_domain: string | null;
  snippet: string | null;
  received_at: string;
  is_read: boolean;
  is_starred: boolean;
  is_categorized: boolean;
  has_attachment: boolean;
  label_ids: string[];
  created_at: string;
}

export interface EmailCategory {
  id: string;
  email_id: string;
  category: string;
  topic: string | null;
  priority: 'high' | 'normal' | 'low';
  confidence: number;
  categorized_at: string;
}

export interface GroupingConfig {
  id: string;
  user_id: string;
  name: string;
  levels: GroupingLevel[];
  date_range_start: string | null;
  date_range_end: string | null;
  is_active: boolean;
  created_at: string;
}

export interface GroupingLevel {
  dimension: DimensionKey;
  label: string;
}

export type DimensionKey =
  | 'category'
  | 'topic'
  | 'sender'
  | 'sender_domain'
  | 'date_month'
  | 'date_week'
  | 'priority'
  | 'has_attachment'
  | 'is_read';

export interface DimensionDef {
  key: DimensionKey;
  label: string;
  sqlColumn: string;
  description: string;
}

export interface SyncJob {
  id: string;
  gmail_account_id: string;
  status: 'running' | 'completed' | 'failed';
  emails_fetched: number;
  emails_categorized: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface TreeNode {
  group_key: string;
  count: number;
}

export interface EmailWithCategory extends Email {
  category: string | null;
  topic: string | null;
  priority: string | null;
  confidence: number | null;
}

export interface UserPreferences {
  id: string;
  user_id: string;
  auto_categorize_unread: boolean;
  created_at: string;
  updated_at: string;
}

export type EmailAction =
  | 'mark_read'
  | 'mark_unread'
  | 'trash'
  | 'archive'
  | 'star'
  | 'unstar';

export const CATEGORIES = [
  'Work',
  'Personal',
  'Finance',
  'Shopping',
  'Travel',
  'Social',
  'Newsletters',
  'Notifications',
  'Promotions',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];
