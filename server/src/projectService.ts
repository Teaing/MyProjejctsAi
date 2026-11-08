import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './db.js';
import { TaskRepository } from './repository.js';
import type {
  AuditEntry,
  CreateTaskInput,
  MutationMeta,
  SystemNode,
  TaskRecord,
  TaskRow,
  TaskStatus,
  TreeChangeMeta,
  TreeSnapshot,
  UpdateTaskInput,
} from './schemas.js';

export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface MutationOutcome {
  version: number;
  systems: SystemNode[];
  task?: TaskRecord;
  deleted_ids?: string[];
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  NOT_STARTED: '未开始',
  IN_PROGRESS: '实施中',
  COMPLETED: '已完成',
  ABANDONED: '已废弃',
};

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function compareRows(a: TaskRow, b: TaskRow): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.id.localeCompare(b.id);
}

function toRecord(row: TaskRow, progress = 0): TaskRecord {
  return { ...row, progress };
}

function computeProgress(parent: TaskRow, children: TaskRow[]): number {
  if (parent.status === 'COMPLETED') return 100;
  if (parent.status === 'NOT_STARTED') return 0;
  if (children.length === 0) return 0;
  const completed = children.filter((child) => child.status === 'COMPLETED').length;
  return Math.round((completed / children.length) * 100);
}

function describeUpdate(before: TaskRow, after: TaskRow): string {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`名称 → ${after.name}`);
  if (before.assignee !== after.assignee) {
    changes.push(`负责人 → ${after.assignee ?? '未指定'}`);
  }
  if (before.client !== after.client) {
    changes.push(`客户 → ${after.client ?? '未指定'}`);
  }
  if (before.start_date !== after.start_date || before.end_date !== after.end_date) {
    changes.push(`日期 → ${after.start_date} ~ ${after.end_date}`);
  }
  if (before.status !== after.status) changes.push(`状态 → ${STATUS_LABELS[after.status]}`);
  if (before.is_hidden !== after.is_hidden) {
    changes.push(after.is_hidden ? '已隐藏' : '已取消隐藏');
  }
  return `更新「${after.name}」：${changes.join('，') || '无变化'}`;
}

export class ProjectService {
  private readonly repo: TaskRepository;

  constructor(
    private readonly db: DatabaseSync,
    private readonly onTreeChanged?: (snapshot: TreeSnapshot, meta: TreeChangeMeta) => void,
  ) {
    this.repo = new TaskRepository(db);
  }

  getTree(): TreeSnapshot {
    return { version: this.repo.getVersion(), systems: this.buildTree() };
  }

  getAudit(limit = 50): AuditEntry[] {
    const safeLimit = Number.isFinite(limit)
      ? Math.min(200, Math.max(1, Math.trunc(limit)))
      : 50;
    return this.repo.listAudit(safeLimit);
  }

  createTask(input: CreateTaskInput, meta: MutationMeta): MutationOutcome {
    const { version, task } = withTransaction(this.db, () => {
      const parentId = input.parent_id ?? null;

      if (parentId !== null) {
        const parent = this.repo.getById(parentId);
        if (!parent) {
          throw new AppError('NOT_FOUND', 404, `父级 ${parentId} 不存在`);
        }
        if (parent.parent_id !== null) {
          throw new AppError('INVALID_HIERARCHY', 409, '任务最多两级，不能在子任务下继续创建任务');
        }
      }

      if (parentId !== null && input.is_hidden !== undefined) {
        throw new AppError('INVALID_HIDDEN_TARGET', 400, '只支持隐藏应用系统，不能对子任务设置隐藏状态');
      }
      if (parentId !== null && input.client !== undefined) {
        throw new AppError('INVALID_CLIENT_TARGET', 400, '客户只能设置在根级应用系统，不能对子任务设置客户');
      }

      const siblings = this.repo.listChildren(parentId);
      const targetIndex = Math.min(
        Math.max(0, input.priority ?? siblings.length),
        siblings.length,
      );
      const id = `${parentId ? 't' : 'sys'}_${randomUUID()}`;

      this.repo.insert({
        id,
        parent_id: parentId,
        name: input.name,
        assignee: normalizeOptionalText(input.assignee),
        client: normalizeOptionalText(input.client),
        start_date: input.start_date,
        end_date: input.end_date,
        priority: siblings.length,
        status: 'NOT_STARTED',
        is_hidden: input.is_hidden ?? false,
      });

      const orderedIds = siblings.map((item) => item.id);
      orderedIds.splice(targetIndex, 0, id);
      this.repo.updatePriorities(parentId, orderedIds);

      const newVersion = this.repo.bumpVersion();
      const row = this.repo.getById(id);
      if (!row) throw new AppError('INTERNAL_ERROR', 500, '创建后读取任务失败');

      this.repo.insertAudit({
        tree_version: newVersion,
        action: 'create',
        entity_type: parentId ? 'task' : 'system',
        entity_id: id,
        actor: meta.actor,
        origin: meta.origin ?? null,
        summary: `创建${parentId ? '任务' : '系统'}「${input.name}」`,
        before_json: null,
        after_json: JSON.stringify(row),
      });

      return { version: newVersion, task: toRecord(row) };
    });

    return this.finish(version, { reason: 'create', ...meta }, { task });
  }

  updateTask(id: string, patch: UpdateTaskInput, meta: MutationMeta): MutationOutcome {
    const { version, task } = withTransaction(this.db, () => {
      const existing = this.repo.getById(id);
      if (!existing) throw new AppError('NOT_FOUND', 404, `任务 ${id} 不存在`);

      if (existing.parent_id !== null && patch.is_hidden !== undefined) {
        throw new AppError('INVALID_HIDDEN_TARGET', 400, '只支持隐藏应用系统，不能对子任务设置隐藏状态');
      }
      if (existing.parent_id !== null && patch.client !== undefined) {
        throw new AppError('INVALID_CLIENT_TARGET', 400, '客户只能设置在根级应用系统，不能对子任务设置客户');
      }

      const start = patch.start_date ?? existing.start_date;
      const end = patch.end_date ?? existing.end_date;
      if (start > end) {
        throw new AppError('INVALID_DATE_RANGE', 400, '结束日期不能早于开始日期');
      }

      const normalized: UpdateTaskInput = {
        ...patch,
        ...(patch.assignee === undefined
          ? {}
          : { assignee: normalizeOptionalText(patch.assignee) }),
        ...(patch.client === undefined ? {} : { client: normalizeOptionalText(patch.client) }),
      };

      this.repo.update(id, normalized);
      const newVersion = this.repo.bumpVersion();
      const row = this.repo.getById(id);
      if (!row) throw new AppError('INTERNAL_ERROR', 500, '更新后读取任务失败');

      const onlyStatus = patch.status !== undefined && Object.keys(patch).length === 1;
      this.repo.insertAudit({
        tree_version: newVersion,
        action: onlyStatus ? 'status' : 'update',
        entity_type: existing.parent_id ? 'task' : 'system',
        entity_id: id,
        actor: meta.actor,
        origin: meta.origin ?? null,
        summary: describeUpdate(existing, row),
        before_json: JSON.stringify(existing),
        after_json: JSON.stringify(row),
      });

      return { version: newVersion, task: toRecord(row) };
    });

    return this.finish(version, { reason: 'update', ...meta }, { task });
  }

  reorderPriority(taskId: string, newPriority: number, meta: MutationMeta): MutationOutcome {
    const { version } = withTransaction(this.db, () => {
      const task = this.repo.getById(taskId);
      if (!task) throw new AppError('NOT_FOUND', 404, `任务 ${taskId} 不存在`);

      const siblings = this.repo.listChildren(task.parent_id).filter((item) => item.id !== taskId);
      const index = Math.min(Math.max(0, newPriority), siblings.length);
      siblings.splice(index, 0, task);

      this.repo.updatePriorities(task.parent_id, siblings.map((item) => item.id));
      const newVersion = this.repo.bumpVersion();

      this.repo.insertAudit({
        tree_version: newVersion,
        action: 'reorder',
        entity_type: task.parent_id ? 'task' : 'system',
        entity_id: task.id,
        actor: meta.actor,
        origin: meta.origin ?? null,
        summary: `调整「${task.name}」优先级为第 ${index + 1} 位`,
        before_json: JSON.stringify(task),
        after_json: null,
      });

      return { version: newVersion };
    });

    return this.finish(version, { reason: 'reorder', ...meta });
  }

  reorderSiblings(
    parentId: string | null,
    orderedIds: string[],
    meta: MutationMeta,
  ): MutationOutcome {
    const { version } = withTransaction(this.db, () => {
      if (parentId !== null) {
        const parent = this.repo.getById(parentId);
        if (!parent) throw new AppError('NOT_FOUND', 404, `父级 ${parentId} 不存在`);
        if (parent.parent_id !== null) {
          throw new AppError('INVALID_HIERARCHY', 409, '只能对根系统或一级任务重排');
        }
      }

      const siblings = this.repo.listChildren(parentId);
      const currentIds = new Set(siblings.map((item) => item.id));
      const uniqueIds = new Set(orderedIds);

      if (
        orderedIds.length !== siblings.length ||
        uniqueIds.size !== orderedIds.length ||
        orderedIds.some((id) => !currentIds.has(id))
      ) {
        throw new AppError('REORDER_MISMATCH', 409, '重排列表必须包含当前全部同级元素');
      }

      this.repo.updatePriorities(parentId, orderedIds);
      const newVersion = this.repo.bumpVersion();

      this.repo.insertAudit({
        tree_version: newVersion,
        action: 'reorder',
        entity_type: parentId ? 'task' : 'system',
        entity_id: parentId,
        actor: meta.actor,
        origin: meta.origin ?? null,
        summary: `重排${parentId ? '任务' : '系统'}顺序（${orderedIds.length} 项）`,
        before_json: JSON.stringify(siblings.map((item) => item.id)),
        after_json: JSON.stringify(orderedIds),
      });

      return { version: newVersion };
    });

    return this.finish(version, { reason: 'reorder', ...meta });
  }

  deleteTask(id: string, cascade: boolean, meta: MutationMeta): MutationOutcome {
    const { version, deletedIds } = withTransaction(this.db, () => {
      const target = this.repo.getById(id);
      if (!target) throw new AppError('NOT_FOUND', 404, `任务 ${id} 不存在`);

      const isRoot = target.parent_id === null;
      const children = isRoot ? this.repo.listChildren(target.id) : [];
      const siblings = this.repo.listChildren(target.parent_id);

      if (children.length > 0 && !cascade) {
        throw new AppError(
          'HAS_CHILDREN',
          409,
          '该系统下仍有子任务，请先删除子任务或使用级联删除',
        );
      }

      const ids = [target.id, ...children.map((child) => child.id)];
      this.repo.delete(target.id);
      this.repo.updatePriorities(
        target.parent_id,
        siblings.filter((item) => item.id !== target.id).map((item) => item.id),
      );
      const newVersion = this.repo.bumpVersion();

      this.repo.insertAudit({
        tree_version: newVersion,
        action: 'delete',
        entity_type: isRoot ? 'system' : 'task',
        entity_id: target.id,
        actor: meta.actor,
        origin: meta.origin ?? null,
        summary: `删除${isRoot ? '系统' : '任务'}「${target.name}」${
          children.length > 0 ? `及其 ${children.length} 个子任务` : ''
        }`,
        before_json: JSON.stringify(target),
        after_json: null,
      });

      return { version: newVersion, deletedIds: ids };
    });

    return this.finish(version, { reason: 'delete', ...meta }, { deleted_ids: deletedIds });
  }

  private buildTree(): SystemNode[] {
    const rows = this.repo.listAll();
    const childrenByParent = new Map<string, TaskRow[]>();
    const roots: TaskRow[] = [];

    for (const row of rows) {
      if (row.parent_id === null) {
        roots.push(row);
      } else {
        const list = childrenByParent.get(row.parent_id) ?? [];
        list.push(row);
        childrenByParent.set(row.parent_id, list);
      }
    }

    roots.sort(compareRows);

    return roots.map((root) => {
      const children = (childrenByParent.get(root.id) ?? []).sort(compareRows);
      const tasks = children.map((child) =>
        toRecord(child, child.status === 'COMPLETED' ? 100 : 0),
      );
      return { ...toRecord(root, computeProgress(root, children)), tasks };
    });
  }

  private finish(
    version: number,
    meta: TreeChangeMeta,
    extra: Partial<MutationOutcome> = {},
  ): MutationOutcome {
    const systems = this.buildTree();
    this.onTreeChanged?.({ version, systems }, meta);
    return { version, systems, ...extra };
  }
}
