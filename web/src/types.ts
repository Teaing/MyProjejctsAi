export type TaskStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export type Filter = 'ALL' | TaskStatus;

export type Role = 'ADMIN' | 'READONLY';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

export interface Task {
  id: string;
  parent_id: string | null;
  name: string;
  assignee: string | null;
  client: string | null;
  start_date: string;
  end_date: string;
  priority: number;
  status: TaskStatus;
  is_hidden: boolean;
  progress: number;
  created_at: string;
  updated_at: string;
  tasks?: Task[];
}

export interface SystemNode extends Task {
  tasks: Task[];
}

export interface TreeSnapshot {
  version: number;
  systems: SystemNode[];
}

export interface AuditEntry {
  id: number;
  tree_version: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string;
  origin: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
}

export interface MutationResponse {
  version: number;
  systems: SystemNode[];
  task?: Task;
  deleted_ids?: string[];
}

export interface CreateTaskPayload {
  name: string;
  assignee?: string | null;
  client?: string | null;
  start_date: string;
  end_date: string;
  parent_id?: string | null;
  priority?: number;
  is_hidden?: boolean;
}

export interface UpdateTaskPayload {
  name?: string;
  assignee?: string | null;
  client?: string | null;
  start_date?: string;
  end_date?: string;
  status?: TaskStatus;
  is_hidden?: boolean;
}

export interface TaskFormPayload {
  name: string;
  assignee: string | null;
  client: string | null;
  start_date: string;
  end_date: string;
  status: TaskStatus;
  is_hidden: boolean;
}
