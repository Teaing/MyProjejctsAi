import type { DatabaseSync } from 'node:sqlite';
import type { AuditEntry, TaskRow, TaskStatus, UpdateTaskInput } from './schemas.js';

export interface InsertTask {
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
}

type TaskDbRow = Omit<TaskRow, 'is_hidden'> & { is_hidden: number };

function mapTaskRow(row: TaskDbRow): TaskRow {
  return { ...row, is_hidden: row.is_hidden === 1 };
}

export interface AuditInsert {
  tree_version: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string;
  origin: string | null;
  summary: string;
  before_json: string | null;
  after_json: string | null;
}

export class TaskRepository {
  constructor(private readonly db: DatabaseSync) {}

  getById(id: string): TaskRow | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
      | TaskDbRow
      | undefined;
    return row ? mapTaskRow(row) : undefined;
  }

  listAll(): TaskRow[] {
    return (this.db
      .prepare('SELECT * FROM tasks ORDER BY priority ASC, id ASC')
      .all() as unknown as TaskDbRow[]).map(mapTaskRow);
  }

  listChildren(parentId: string | null): TaskRow[] {
    if (parentId === null) {
      return (this.db
        .prepare('SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY priority ASC, id ASC')
        .all() as unknown as TaskDbRow[]).map(mapTaskRow);
    }
    return (this.db
      .prepare('SELECT * FROM tasks WHERE parent_id = ? ORDER BY priority ASC, id ASC')
      .all(parentId) as unknown as TaskDbRow[]).map(mapTaskRow);
  }

  insert(task: InsertTask): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, parent_id, name, assignee, client, start_date, end_date, priority, status, is_hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.parent_id,
        task.name,
        task.assignee,
        task.client,
        task.start_date,
        task.end_date,
        task.priority,
        task.status,
        task.is_hidden ? 1 : 0,
      );
  }

  update(id: string, patch: UpdateTaskInput): void {
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(patch.name);
    }
    if (patch.assignee !== undefined) {
      fields.push('assignee = ?');
      values.push(patch.assignee);
    }
    if (patch.client !== undefined) {
      fields.push('client = ?');
      values.push(patch.client);
    }
    if (patch.start_date !== undefined) {
      fields.push('start_date = ?');
      values.push(patch.start_date);
    }
    if (patch.end_date !== undefined) {
      fields.push('end_date = ?');
      values.push(patch.end_date);
    }
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(patch.status);
    }
    if (patch.is_hidden !== undefined) {
      fields.push('is_hidden = ?');
      values.push(patch.is_hidden ? 1 : 0);
    }

    if (fields.length === 0) return;

    fields.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  }

  countChildren(parentId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM tasks WHERE parent_id = ?')
      .get(parentId) as unknown as { count: number };
    return row.count;
  }

  updatePriorities(_parentId: string | null, orderedIds: string[]): void {
    const statement = this.db.prepare(
      "UPDATE tasks SET priority = ?, updated_at = datetime('now') WHERE id = ?",
    );
    orderedIds.forEach((id, index) => {
      statement.run(index, id);
    });
  }

  getVersion(): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'tree_version'").get() as
      | { value: string }
      | undefined;
    return Number(row?.value ?? 0);
  }

  bumpVersion(): number {
    this.db
      .prepare(
        "UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'tree_version'",
      )
      .run();
    return this.getVersion();
  }

  insertAudit(entry: AuditInsert): void {
    this.db
      .prepare(
        `INSERT INTO audit_log
           (tree_version, action, entity_type, entity_id, actor, origin, summary, before_json, after_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.tree_version,
        entry.action,
        entry.entity_type,
        entry.entity_id,
        entry.actor,
        entry.origin,
        entry.summary,
        entry.before_json,
        entry.after_json,
      );
  }

  listAudit(limit: number): AuditEntry[] {
    return this.db
      .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as unknown as AuditEntry[];
  }
}
