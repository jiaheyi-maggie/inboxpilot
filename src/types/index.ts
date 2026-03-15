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
  categorization_status: 'none' | 'pending' | 'done' | 'failed';
  has_attachment: boolean;
  label_ids: string[];
  body_html: string | null;
  body_text: string | null;
  created_at: string;
}

// --- Importance (replaces priority) ---

export type ImportanceLabel = 'critical' | 'high' | 'medium' | 'low' | 'noise';
export type ImportanceScore = 1 | 2 | 3 | 4 | 5;

export const IMPORTANCE_LEVELS = [
  { score: 5 as ImportanceScore, label: 'critical' as ImportanceLabel, display: 'Critical' },
  { score: 4 as ImportanceScore, label: 'high' as ImportanceLabel, display: 'High' },
  { score: 3 as ImportanceScore, label: 'medium' as ImportanceLabel, display: 'Medium' },
  { score: 2 as ImportanceScore, label: 'low' as ImportanceLabel, display: 'Low' },
  { score: 1 as ImportanceScore, label: 'noise' as ImportanceLabel, display: 'Noise' },
] as const;

export function importanceScoreToLabel(score: number): ImportanceLabel {
  switch (score) {
    case 5: return 'critical';
    case 4: return 'high';
    case 3: return 'medium';
    case 2: return 'low';
    case 1: return 'noise';
    default: return 'medium';
  }
}

export interface EmailCategory {
  id: string;
  email_id: string;
  category: string;
  topic: string | null;
  /** @deprecated Use importance_score/importance_label instead */
  priority: 'high' | 'normal' | 'low';
  importance_score: ImportanceScore | null;
  importance_label: ImportanceLabel | null;
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
  | 'importance'
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
  /** @deprecated Use importance_score/importance_label instead */
  priority: string | null;
  importance_score: number | null;
  importance_label: string | null;
  confidence: number | null;
}

// --- View System ---

export type ViewType = 'list' | 'board' | 'tree';

export interface ViewFilter {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'in';
  value: string | string[];
}

export interface ViewSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface ViewConfig {
  id: string;
  user_id: string;
  name: string;
  view_type: ViewType;
  group_by: GroupingLevel[];
  filters: ViewFilter[];
  sort: ViewSort[];
  date_range_start: string | null;
  date_range_end: string | null;
  is_active: boolean;
  sort_order: number;
  is_pinned: boolean;
  icon: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

/** @deprecated Use ViewType + ViewConfig instead. Will be removed after migration. */
export type ViewMode = 'flat' | 'by_sender' | 'by_date' | 'by_topic';

/** @deprecated Use ViewConfig instead. Will be removed after migration. */
export const VIEW_MODES: { value: ViewMode; label: string; description: string }[] = [
  { value: 'flat', label: 'Flat', description: 'All emails in each category' },
  { value: 'by_sender', label: 'By Sender', description: 'Group by sender within each category' },
  { value: 'by_date', label: 'By Date', description: 'Group by month within each category' },
  { value: 'by_topic', label: 'By Topic', description: 'Group by topic within each category' },
];

export interface UserPreferences {
  id: string;
  user_id: string;
  auto_categorize_unread: boolean;
  default_view_mode: ViewMode;
  created_at: string;
  updated_at: string;
}

export type EmailAction =
  | 'mark_read'
  | 'mark_unread'
  | 'trash'
  | 'archive'
  | 'star'
  | 'unstar'
  | 'restore';

/** Keys for system-level sidebar groups (not AI categories) */
export type SystemGroupKey = 'starred' | 'archived' | 'trash';

/** Bulk actions available on tree nodes (any dimension level) */
export type TreeAction =
  | 'trash'
  | 'archive'
  | 'mark_read'
  | 'mark_unread'
  | 'reassign';

export interface TreeActionRequest {
  action: TreeAction;
  filters: { dimension: DimensionKey; value: string }[];
  newCategory?: string;
  configId: string;
}

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

// --- User Category (custom, stored in DB) ---

export interface UserCategory {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string | null;
  sort_order: number;
  is_default: boolean;
  view_mode_override: ViewMode | null;
  created_at: string;
}

// --- Workflow Types ---

export type WorkflowTriggerType =
  | 'new_email'           // fires after sync inserts a new email
  | 'email_categorized'   // fires after AI categorization completes
  | 'email_from_domain'   // fires when sender domain matches
  | 'unread_timeout';     // fires when email unread for N minutes (cron-based)

export type WorkflowActionType =
  | 'trash'
  | 'archive'
  | 'star'
  | 'unstar'
  | 'mark_read'
  | 'mark_unread'
  | 'reassign_category'
  | 'recategorize';

export type WorkflowConditionField =
  | 'category'
  | 'topic'
  | 'importance'
  | 'priority'    // deprecated — kept for backward compat with existing workflows
  | 'sender_email'
  | 'sender_domain'
  | 'subject'
  | 'has_attachment'
  | 'is_read'
  | 'is_starred'
  | 'label';

export type WorkflowConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_true'
  | 'is_false';

export interface TriggerNodeData {
  triggerType: WorkflowTriggerType;
  config: {
    domain?: string;           // for email_from_domain
    category?: string;         // for email_categorized
    timeoutMinutes?: number;   // for unread_timeout
  };
}

export interface ConditionNodeData {
  field: WorkflowConditionField;
  operator: WorkflowConditionOperator;
  value: string;
}

export interface ActionNodeData {
  actionType: WorkflowActionType;
  config: {
    category?: string;           // for reassign_category
    sourceCategory?: string;     // for recategorize: which category to refine
    refinementPrompt?: string;   // for recategorize: NL instruction for the AI
    newCategories?: string[];    // for recategorize: categories to auto-create before running
  };
}

export type WorkflowNodeType = 'trigger' | 'condition' | 'action';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  data: TriggerNodeData | ConditionNodeData | ActionNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;  // 'true' | 'false' for condition nodes
  label?: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  graph: WorkflowGraph;
  created_at: string;
  updated_at: string;
}

export interface WorkflowExecutionStep {
  nodeId: string;
  nodeType: WorkflowNodeType;
  result: 'passed' | 'failed' | 'skipped' | 'executed' | 'error';
  detail?: string;
  timestamp: string;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  email_id: string | null;
  status: 'running' | 'completed' | 'failed';
  graph_snapshot: WorkflowGraph;
  log: WorkflowExecutionStep[];
  started_at: string;
  completed_at: string | null;
}

// --- AI Intent Router ---

export interface IntentResponse {
  type: 'context' | 'command' | 'rule' | 'search';
  summary: string;
  details: Record<string, unknown>;
}
