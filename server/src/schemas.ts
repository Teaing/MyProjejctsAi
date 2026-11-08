import { z } from 'zod';

export const taskStatusSchema = z.enum([
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'ABANDONED',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const dateStringSchema = z
  .string()
  .refine(isRealDate, '必须是有效的 YYYY-MM-DD 日期');

const nameSchema = z
  .string()
  .trim()
  .min(1, '名称不能为空')
  .max(200, '名称不能超过 200 个字符');

const dateRangeRefinement = {
  check: (value: { start_date: string; end_date: string }) => value.start_date <= value.end_date,
  options: { message: '结束日期不能早于开始日期', path: ['end_date'] },
};

export const createTaskSchema = z
  .object({
    name: nameSchema,
    assignee: z.string().trim().max(100).nullable().optional(),
    client: z.string().trim().max(100).nullable().optional(),
    start_date: dateStringSchema,
    end_date: dateStringSchema,
    parent_id: z.string().min(1).nullish(),
    priority: z.number().int().nonnegative().optional(),
    is_hidden: z.boolean().optional(),
  })
  .refine(dateRangeRefinement.check, dateRangeRefinement.options);

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    name: nameSchema.optional(),
    assignee: z.string().trim().max(100).nullable().optional(),
    client: z.string().trim().max(100).nullable().optional(),
    start_date: dateStringSchema.optional(),
    end_date: dateStringSchema.optional(),
    status: taskStatusSchema.optional(),
    is_hidden: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少提供一个要更新的字段' });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const updateTaskDatesSchema = z
  .object({
    task_id: z.string().min(1),
    start_date: dateStringSchema,
    end_date: dateStringSchema,
  })
  .refine(dateRangeRefinement.check, dateRangeRefinement.options);

export type UpdateTaskDatesInput = z.infer<typeof updateTaskDatesSchema>;

export const reorderPrioritySchema = z.object({
  task_id: z.string().min(1),
  new_priority: z.number().int().nonnegative(),
});

export type ReorderPriorityInput = z.infer<typeof reorderPrioritySchema>;

export const updateTaskStatusSchema = z.object({
  task_id: z.string().min(1),
  status: taskStatusSchema,
});

export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;

export const setTaskHiddenSchema = z.object({
  task_id: z.string().min(1),
  hidden: z.boolean(),
});

export type SetTaskHiddenInput = z.infer<typeof setTaskHiddenSchema>;

export const setTaskAssigneeSchema = z.object({
  task_id: z.string().min(1),
  assignee: z.string().trim().max(100).nullable(),
});

export type SetTaskAssigneeInput = z.infer<typeof setTaskAssigneeSchema>;

export const setTaskClientSchema = z.object({
  task_id: z.string().min(1),
  client: z.string().trim().max(100).nullable(),
});

export type SetTaskClientInput = z.infer<typeof setTaskClientSchema>;

export const deleteTaskSchema = z.object({
  task_id: z.string().min(1),
  cascade: z.boolean().default(true),
});

export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;

export const reorderSiblingsSchema = z.object({
  parent_id: z.string().min(1).nullable(),
  ordered_ids: z.array(z.string().min(1)),
});

export type ReorderSiblingsInput = z.infer<typeof reorderSiblingsSchema>;

export interface TaskRow {
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
  created_at: string;
  updated_at: string;
}

export interface TaskRecord extends TaskRow {
  progress: number;
}

export interface SystemNode extends TaskRecord {
  tasks: TaskRecord[];
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

export interface MutationMeta {
  actor: string;
  origin?: string;
}

export interface TreeChangeMeta extends MutationMeta {
  reason: string;
}
