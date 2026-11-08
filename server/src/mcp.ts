import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { ProjectService } from './projectService.js';
import {
  createTaskSchema,
  deleteTaskSchema,
  reorderPrioritySchema,
  setTaskAssigneeSchema,
  setTaskClientSchema,
  setTaskHiddenSchema,
  updateTaskDatesSchema,
  updateTaskStatusSchema,
} from './schemas.js';

const mutationOutputSchema = z.object({
  version: z.number(),
  systems: z.array(z.record(z.string(), z.unknown())),
  task: z.record(z.string(), z.unknown()).optional(),
  deleted_ids: z.array(z.string()).optional(),
});

const createTaskToolSchema = z.object({
  name: z.string().min(1).max(200).describe('系统或任务名称'),
  assignee: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .describe('负责人名称，可选；省略或传 null 表示未指定'),
  client: z
    .string()
    .max(100)
    .nullable()
    .optional()
    .describe('客户名称，可选；仅根级应用系统有效'),
  start_date: z.string().describe('开始日期，格式 YYYY-MM-DD'),
  end_date: z.string().describe('结束日期，格式 YYYY-MM-DD'),
  parent_id: z.string().nullable().optional().describe('父级系统 ID；省略时创建根级应用系统'),
  priority: z.number().int().nonnegative().optional().describe('优先级，数字越小越靠前'),
  is_hidden: z.boolean().optional().describe('是否创建后立即隐藏，默认 false（仅根级系统有效）'),
});

const updateDatesToolSchema = z.object({
  task_id: z.string().describe('要调整的系统或任务 ID'),
  start_date: z.string().describe('新的开始日期，格式 YYYY-MM-DD'),
  end_date: z.string().describe('新的结束日期，格式 YYYY-MM-DD'),
});

const reorderPriorityToolSchema = z.object({
  task_id: z.string().describe('要调整的系统或任务 ID'),
  new_priority: z.number().int().nonnegative().describe('目标位置，0 表示最靠前'),
});

const updateStatusToolSchema = z.object({
  task_id: z.string().describe('要更新状态的系统或任务 ID'),
  status: z
    .enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED'])
    .describe('未开始 / 实施中 / 已完成 / 已废弃'),
});

const setHiddenToolSchema = z.object({
  task_id: z.string().describe('要隐藏或显示的系统/任务 ID'),
  hidden: z.boolean().describe('true 表示隐藏，false 表示取消隐藏'),
});

const setAssigneeToolSchema = z.object({
  task_id: z.string().describe('要设置负责人的系统/任务 ID'),
  assignee: z
    .string()
    .max(100)
    .nullable()
    .describe('负责人名称；传 null 或空字符串表示清空'),
});

const setClientToolSchema = z.object({
  task_id: z.string().describe('要设置客户的根级应用系统 ID'),
  client: z
    .string()
    .max(100)
    .nullable()
    .describe('客户名称；传 null 或空字符串表示清空'),
});

const deleteTaskToolSchema = z.object({
  task_id: z.string().describe('要删除的系统或任务 ID'),
  cascade: z
    .boolean()
    .default(true)
    .describe('删除系统时是否级联删除其子任务，默认 true'),
});

interface Parseable<T> {
  safeParse(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ path: PropertyKey[]; message: string }> };
      };
}

function parseToolInput<T>(schema: Parseable<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '参数'}: ${issue.message}`)
      .join('; ');
    throw new Error(message);
  }
  return result.data;
}

function toolResult(text: string, data: object) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent: data as Record<string, unknown>,
  };
}

export interface McpAccess {
  readOnly?: boolean;
  actor?: string;
}

export function buildMcpServer(service: ProjectService, access: McpAccess = {}): McpServer {
  const mcpMeta = { actor: access.actor ?? 'mcp' };
  const server = new McpServer(
    { name: 'project-gantt-mcp', version: '0.1.0' },
    {
      instructions: `Read project://gantt/tree before structural changes. The tree has exactly two levels: application systems (roots) and implementation tasks (children). Dates use YYYY-MM-DD. Use set_task_hidden only on root systems; use status ABANDONED only when the work itself is abandoned. Every write returns a monotonically increasing version and the full updated tree.${
        access.readOnly
          ? ' You are connected with a read-only token: no write tools are available.'
          : ''
      }`,
    },
  );

  if (!access.readOnly) {
    server.registerTool(
    'create_task',
    {
      title: '创建应用系统或实施任务',
      description:
        '创建根级应用系统（不传 parent_id）或系统中的一级实施任务（传 parent_id）。最多两级。日期格式 YYYY-MM-DD。新记录默认是 NOT_STARTED（未开始）；录入或到达开始日期都不会自动开始，必须另行调用 update_task_status。',
      inputSchema: createTaskToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(createTaskSchema, args);
      const result = service.createTask(input, mcpMeta);
      return toolResult(
        `已创建${input.parent_id ? '任务' : '系统'}「${result.task?.name}」，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'update_task_dates',
    {
      title: '调整排期日期',
      description: '修改系统或任务的开始与结束日期，日期格式 YYYY-MM-DD，结束不能早于开始。',
      inputSchema: updateDatesToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(updateTaskDatesSchema, args);
      const result = service.updateTask(
        input.task_id,
        { start_date: input.start_date, end_date: input.end_date },
        mcpMeta,
      );
      return toolResult(
        `已更新「${result.task?.name}」排期为 ${input.start_date} ~ ${input.end_date}，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'reorder_priority',
    {
      title: '调整优先级',
      description: '把指定系统或任务移动到同级中的目标位置（0 最靠前），其余元素自动顺延。',
      inputSchema: reorderPriorityToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(reorderPrioritySchema, args);
      const result = service.reorderPriority(input.task_id, input.new_priority, mcpMeta);
      return toolResult(
        `已调整优先级到第 ${input.new_priority + 1} 位，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'update_task_status',
    {
      title: '更新状态（手动开始/完成/废弃）',
      description:
        '手动改变系统或任务状态：NOT_STARTED（未开始）、IN_PROGRESS（实施中）、COMPLETED（已完成）、ABANDONED（已废弃）。只有显式把状态改为 IN_PROGRESS 才算开始，日期不会自动推进状态。',
      inputSchema: updateStatusToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(updateTaskStatusSchema, args);
      const result = service.updateTask(input.task_id, { status: input.status }, mcpMeta);
      return toolResult(
        `已把「${result.task?.name}」状态更新为 ${input.status}，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'set_task_hidden',
    {
      title: '隐藏或显示应用系统',
      description:
        '把根级应用系统标记为隐藏或取消隐藏。隐藏只影响视图，不改变状态，也不会删除数据；ABANDONED 表示已废弃，两者相互独立。子任务不支持隐藏，请用状态表达。',
      inputSchema: setHiddenToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(setTaskHiddenSchema, args);
      const result = service.updateTask(input.task_id, { is_hidden: input.hidden }, mcpMeta);
      return toolResult(
        `已${input.hidden ? '隐藏' : '显示'}「${result.task?.name}」，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'set_task_assignee',
    {
      title: '设置负责人',
      description:
        '为系统或任务指定负责人，也可以传 null 清空。负责人是可选字段，不影响排期与状态。',
      inputSchema: setAssigneeToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(setTaskAssigneeSchema, args);
      const result = service.updateTask(input.task_id, { assignee: input.assignee }, mcpMeta);
      return toolResult(
        `已把「${result.task?.name}」负责人设为 ${result.task?.assignee ?? '未指定'}，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'set_task_client',
    {
      title: '设置客户',
      description:
        '为根级应用系统指定客户名称，也可以传 null 清空。客户是可选字段，只允许设置在根级系统，子任务会被拒绝。',
      inputSchema: setClientToolSchema,
      outputSchema: mutationOutputSchema,
    },
    async (args) => {
      const input = parseToolInput(setTaskClientSchema, args);
      const result = service.updateTask(input.task_id, { client: input.client }, mcpMeta);
      return toolResult(
        `已把「${result.task?.name}」客户设为 ${result.task?.client ?? '未指定'}，当前版本 v${result.version}`,
        result,
      );
    },
  );

  server.registerTool(
    'delete_task',
    {
      title: '删除系统或任务',
      description:
        '删除指定系统或任务。删除根级系统时默认级联删除其全部子任务；cascade=false 且存在子任务时会拒绝。',
      inputSchema: deleteTaskToolSchema,
      outputSchema: mutationOutputSchema,
      annotations: { destructiveHint: true },
    },
    async (args) => {
      const input = parseToolInput(deleteTaskSchema, args);
      const result = service.deleteTask(input.task_id, input.cascade, mcpMeta);
      return toolResult(
        `已删除 ${result.deleted_ids?.length ?? 0} 项，当前版本 v${result.version}`,
        result,
      );
    },
  );
  }

  server.registerResource(
    'gantt-tree',
    'project://gantt/tree',
    {
      title: '项目甘特树',
      description: '返回全部根级应用系统及其一级实施任务的最新快照，包含日期、优先级、状态与进度。',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(service.getTree(), null, 2),
        },
      ],
    }),
  );

  return server;
}
