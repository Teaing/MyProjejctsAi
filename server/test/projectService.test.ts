import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { AppError, ProjectService } from '../src/projectService.js';
import { createTaskSchema } from '../src/schemas.js';

const meta = { actor: 'test' };

function setup(): { service: ProjectService; close: () => void } {
  const db = openDatabase(':memory:');
  return { service: new ProjectService(db), close: () => db.close() };
}

function isAppError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

test('新记录默认未开始，只有手动改状态才算开始', () => {
  const { service, close } = setup();

  const system = service.createTask(
    {
      name: '系统A',
      start_date: '2026-01-01',
      end_date: '2026-01-10',
    },
    meta,
  );
  assert.equal(system.task?.status, 'NOT_STARTED');

  const child = service.createTask(
    {
      name: '任务A',
      start_date: '2026-01-01',
      end_date: '2026-01-05',
      parent_id: system.task!.id,
    },
    meta,
  );
  assert.equal(child.task?.status, 'NOT_STARTED');

  // 开始日期早已过去，也不会自动开始
  assert.equal(service.getTree().systems[0]?.status, 'NOT_STARTED');
  assert.equal(service.getTree().systems[0]?.tasks[0]?.status, 'NOT_STARTED');

  service.updateTask(system.task!.id, { status: 'IN_PROGRESS' }, meta);
  assert.equal(service.getTree().systems[0]?.status, 'IN_PROGRESS');
  assert.equal(service.getTree().systems[0]?.tasks[0]?.status, 'NOT_STARTED');

  close();
});

test('创建系统与子任务并组装两级树', () => {
  const { service, close } = setup();

  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-30' },
    meta,
  );
  service.createTask(
    {
      name: '任务A',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
      parent_id: system.task?.id,
    },
    meta,
  );

  const tree = service.getTree();
  assert.equal(tree.systems.length, 1);
  assert.equal(tree.systems[0]?.name, '系统A');
  assert.equal(tree.systems[0]?.tasks.length, 1);
  assert.equal(tree.systems[0]?.progress, 0);
  assert.equal(tree.version, 2);

  close();
});

test('子任务完成后系统进度按完成比例计算', () => {
  const { service, close } = setup();
  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-30' },
    meta,
  );
  const childId = system.task?.id;
  assert.ok(childId);
  service.updateTask(childId, { status: 'IN_PROGRESS' }, meta);

  const first = service.createTask(
    { name: '任务1', start_date: '2026-11-01', end_date: '2026-11-05', parent_id: childId },
    meta,
  );
  service.createTask(
    { name: '任务2', start_date: '2026-11-06', end_date: '2026-11-10', parent_id: childId },
    meta,
  );

  service.updateTask(first.task!.id, { status: 'COMPLETED' }, meta);

  const tree = service.getTree();
  assert.equal(tree.systems[0]?.progress, 50);
  assert.equal(tree.systems[0]?.tasks[0]?.progress, 100);

  service.updateTask(childId, { status: 'COMPLETED' }, meta);
  assert.equal(service.getTree().systems[0]?.progress, 100);

  close();
});

test('禁止三级任务', () => {
  const { service, close } = setup();
  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-30' },
    meta,
  );
  const task = service.createTask(
    {
      name: '任务A',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
      parent_id: system.task!.id,
    },
    meta,
  );

  assert.throws(
    () =>
      service.createTask(
        {
          name: '三级任务',
          start_date: '2026-11-01',
          end_date: '2026-11-05',
          parent_id: task.task!.id,
        },
        meta,
      ),
    isAppError('INVALID_HIERARCHY'),
  );

  close();
});

test('父级不存在时返回 NOT_FOUND', () => {
  const { service, close } = setup();
  assert.throws(
    () =>
      service.createTask(
        {
          name: '任务A',
          start_date: '2026-11-01',
          end_date: '2026-11-10',
          parent_id: 'missing',
        },
        meta,
      ),
    isAppError('NOT_FOUND'),
  );
  close();
});

test('日期格式与日期区间校验', () => {
  const base = { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-30' };

  assert.equal(createTaskSchema.safeParse(base).success, true);
  assert.equal(
    createTaskSchema.safeParse({ ...base, start_date: '2026-02-30' }).success,
    false,
  );
  assert.equal(
    createTaskSchema.safeParse({ ...base, start_date: '2026-11-30', end_date: '2026-11-01' })
      .success,
    false,
  );
  assert.equal(createTaskSchema.safeParse({ ...base, name: '   ' }).success, false);
});

test('更新单个日期时仍校验整体区间', () => {
  const { service, close } = setup();
  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-10', end_date: '2026-11-20' },
    meta,
  );

  assert.throws(
    () => service.updateTask(system.task!.id, { start_date: '2026-11-25' }, meta),
    isAppError('INVALID_DATE_RANGE'),
  );

  close();
});

test('删除系统级联删除子任务并写审计', () => {
  const { service, close } = setup();
  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-30' },
    meta,
  );
  const child = service.createTask(
    {
      name: '任务A',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
      parent_id: system.task!.id,
    },
    meta,
  );

  assert.throws(
    () => service.deleteTask(system.task!.id, false, meta),
    isAppError('HAS_CHILDREN'),
  );

  const outcome = service.deleteTask(system.task!.id, true, meta);
  assert.deepEqual(outcome.deleted_ids?.sort(), [system.task!.id, child.task!.id].sort());
  assert.equal(service.getTree().systems.length, 0);

  const deletion = service.getAudit(10).find((entry) => entry.action === 'delete');
  assert.ok(deletion);
  assert.match(deletion.summary, /删除系统「系统A」及其 1 个子任务/);

  close();
});

test('删除后同级优先级自动补齐', () => {
  const { service, close } = setup();
  const first = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  const second = service.createTask(
    { name: '系统B', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  service.createTask(
    { name: '系统C', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );

  service.deleteTask(second.task!.id, true, meta);
  let tree = service.getTree();
  assert.deepEqual(
    tree.systems.map((system) => system.name),
    ['系统A', '系统C'],
  );
  assert.deepEqual(
    tree.systems.map((system) => system.priority),
    [0, 1],
  );

  const taskA = service.createTask(
    {
      name: '任务A',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      parent_id: first.task!.id,
    },
    meta,
  );
  const taskB = service.createTask(
    {
      name: '任务B',
      start_date: '2026-11-06',
      end_date: '2026-11-08',
      parent_id: first.task!.id,
    },
    meta,
  );
  service.createTask(
    {
      name: '任务C',
      start_date: '2026-11-09',
      end_date: '2026-11-10',
      parent_id: first.task!.id,
    },
    meta,
  );

  service.deleteTask(taskB.task!.id, true, meta);
  tree = service.getTree();
  assert.deepEqual(
    tree.systems[0]?.tasks.map((task) => task.name),
    ['任务A', '任务C'],
  );
  assert.deepEqual(
    tree.systems[0]?.tasks.map((task) => task.priority),
    [0, 1],
  );
  assert.ok(taskA.task);

  close();
});

test('同级重排要求完整集合并重新编号', () => {
  const { service, close } = setup();
  const first = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  const second = service.createTask(
    { name: '系统B', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  const third = service.createTask(
    { name: '系统C', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );

  service.reorderSiblings(null, [third.task!.id, first.task!.id, second.task!.id], meta);
  const tree = service.getTree();
  assert.deepEqual(
    tree.systems.map((system) => system.name),
    ['系统C', '系统A', '系统B'],
  );
  assert.deepEqual(
    tree.systems.map((system) => system.priority),
    [0, 1, 2],
  );

  assert.throws(
    () => service.reorderSiblings(null, [first.task!.id], meta),
    isAppError('REORDER_MISMATCH'),
  );

  close();
});

test('调整优先级把任务移动到目标位置', () => {
  const { service, close } = setup();
  const first = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  service.createTask(
    { name: '系统B', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  const third = service.createTask(
    { name: '系统C', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );

  service.reorderPriority(third.task!.id, 0, meta);
  assert.deepEqual(
    service.getTree().systems.map((system) => system.name),
    ['系统C', '系统A', '系统B'],
  );

  service.reorderPriority(third.task!.id, 99, meta);
  assert.deepEqual(
    service.getTree().systems.map((system) => system.name),
    ['系统A', '系统B', '系统C'],
  );

  assert.ok(first.task);
  close();
});

test('每次写操作递增版本并记录审计', () => {
  const { service, close } = setup();
  service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );

  const tree = service.getTree();
  const audit = service.getAudit(10);
  assert.equal(tree.version, 1);
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.action, 'create');
  assert.equal(audit[0]?.actor, 'test');

  close();
});

test('负责人是可选字段，可设置、清空并写审计', () => {
  const { service, close } = setup();
  const created = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  assert.equal(created.task?.assignee, null);

  service.updateTask(created.task!.id, { assignee: '  张三  ' }, meta);
  assert.equal(service.getTree().systems[0]?.assignee, '张三');

  const setAudit = service.getAudit(1)[0];
  assert.match(setAudit?.summary ?? '', /负责人 → 张三/);

  service.updateTask(created.task!.id, { assignee: '   ' }, meta);
  assert.equal(service.getTree().systems[0]?.assignee, null);

  const withOwner = service.createTask(
    {
      name: '系统B',
      assignee: '李四',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
    },
    meta,
  );
  assert.equal(withOwner.task?.assignee, '李四');

  close();
});

test('隐藏字段与状态相互独立，可切换并写审计', () => {
  const { service, close } = setup();
  const created = service.createTask(
    {
      name: '系统A',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
      is_hidden: true,
    },
    meta,
  );
  assert.equal(created.task?.is_hidden, true);

  service.updateTask(created.task!.id, { is_hidden: false }, meta);
  assert.equal(service.getTree().systems[0]?.is_hidden, false);

  service.updateTask(created.task!.id, { is_hidden: true }, meta);
  const tree = service.getTree();
  assert.equal(tree.systems[0]?.is_hidden, true);
  assert.equal(tree.systems[0]?.status, 'NOT_STARTED');

  const audit = service.getAudit(1)[0];
  assert.equal(audit?.action, 'update');
  assert.match(audit?.summary ?? '', /已隐藏/);

  close();
});

test('创建时指定 priority 会插入目标位置并重排', () => {
  const { service, close } = setup();
  service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  service.createTask(
    { name: '系统B', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  service.createTask(
    {
      name: '系统C',
      priority: 0,
      start_date: '2026-11-01',
      end_date: '2026-11-10',
    },
    meta,
  );

  const tree = service.getTree();
  assert.deepEqual(
    tree.systems.map((system) => system.name),
    ['系统C', '系统A', '系统B'],
  );
  assert.deepEqual(
    tree.systems.map((system) => system.priority),
    [0, 1, 2],
  );

  close();
});

test('客户只允许设置在根级系统，可设置与清空', () => {
  const { service, close } = setup();
  const system = service.createTask(
    {
      name: '系统A',
      client: '复旦大学',
      start_date: '2026-11-01',
      end_date: '2026-11-10',
    },
    meta,
  );
  assert.equal(system.task?.client, '复旦大学');

  const child = service.createTask(
    {
      name: '任务A',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      parent_id: system.task!.id,
    },
    meta,
  );

  assert.throws(
    () => service.updateTask(child.task!.id, { client: '复旦大学' }, meta),
    isAppError('INVALID_CLIENT_TARGET'),
  );
  assert.throws(
    () => service.updateTask(child.task!.id, { client: null }, meta),
    isAppError('INVALID_CLIENT_TARGET'),
  );
  assert.throws(
    () =>
      service.createTask(
        {
          name: '任务B',
          start_date: '2026-11-06',
          end_date: '2026-11-09',
          parent_id: system.task!.id,
          client: '复旦大学',
        },
        meta,
      ),
    isAppError('INVALID_CLIENT_TARGET'),
  );
  assert.throws(
    () =>
      service.createTask(
        {
          name: '任务C',
          start_date: '2026-11-06',
          end_date: '2026-11-09',
          parent_id: system.task!.id,
          client: null,
        },
        meta,
      ),
    isAppError('INVALID_CLIENT_TARGET'),
  );

  service.updateTask(system.task!.id, { client: '   ' }, meta);
  assert.equal(service.getTree().systems[0]?.client, null);
  service.updateTask(system.task!.id, { client: '华东师范大学' }, meta);
  assert.equal(service.getTree().systems[0]?.client, '华东师范大学');

  const audit = service.getAudit(1)[0];
  assert.match(audit?.summary ?? '', /客户 → 华东师范大学/);

  close();
});

test('只允许隐藏根级应用系统', () => {
  const { service, close } = setup();
  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  const child = service.createTask(
    {
      name: '任务A',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      parent_id: system.task!.id,
    },
    meta,
  );

  assert.throws(
    () => service.updateTask(child.task!.id, { is_hidden: true }, meta),
    isAppError('INVALID_HIDDEN_TARGET'),
  );
  assert.throws(
    () => service.updateTask(child.task!.id, { is_hidden: false }, meta),
    isAppError('INVALID_HIDDEN_TARGET'),
  );
  assert.throws(
    () =>
      service.createTask(
        {
          name: '任务B',
          start_date: '2026-11-06',
          end_date: '2026-11-09',
          parent_id: system.task!.id,
          is_hidden: true,
        },
        meta,
      ),
    isAppError('INVALID_HIDDEN_TARGET'),
  );
  assert.throws(
    () =>
      service.createTask(
        {
          name: '任务C',
          start_date: '2026-11-06',
          end_date: '2026-11-09',
          parent_id: system.task!.id,
          is_hidden: false,
        },
        meta,
      ),
    isAppError('INVALID_HIDDEN_TARGET'),
  );

  service.updateTask(system.task!.id, { is_hidden: true }, meta);
  assert.equal(service.getTree().systems[0]?.is_hidden, true);

  close();
});

test('废弃状态不计入完成进度', () => {
  const { service, close } = setup();
  const system = service.createTask(
    { name: '系统A', start_date: '2026-11-01', end_date: '2026-11-10' },
    meta,
  );
  service.updateTask(system.task!.id, { status: 'IN_PROGRESS' }, meta);
  const first = service.createTask(
    {
      name: '任务1',
      start_date: '2026-11-01',
      end_date: '2026-11-05',
      parent_id: system.task!.id,
    },
    meta,
  );
  service.createTask(
    {
      name: '任务2',
      start_date: '2026-11-06',
      end_date: '2026-11-10',
      parent_id: system.task!.id,
    },
    meta,
  );

  service.updateTask(first.task!.id, { status: 'COMPLETED' }, meta);
  service.updateTask(first.task!.id, { status: 'ABANDONED' }, meta);

  assert.equal(service.getTree().systems[0]?.progress, 0);
  close();
});
