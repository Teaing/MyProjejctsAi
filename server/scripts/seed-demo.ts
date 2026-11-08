import { config } from '../src/config.js';
import { openDatabase, withTransaction } from '../src/db.js';
import { ProjectService } from '../src/projectService.js';
import type { TaskStatus } from '../src/schemas.js';

const confirmed = process.argv.includes('--yes') || process.env.SEED_DEMO_YES === '1';
if (!confirmed) {
  console.error('本命令会清空现有项目数据、审计日志和登录会话（保留用户账号）。');
  console.error('确认执行请运行: npm run seed:demo -- --yes');
  process.exit(1);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function shift(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface SeedChild {
  name: string;
  assignee?: string;
  status: TaskStatus;
  start: string;
  end: string;
}

interface SeedSystem {
  name: string;
  client?: string;
  assignee?: string;
  status: TaskStatus;
  start: string;
  end: string;
  is_hidden?: boolean;
  children: SeedChild[];
}

const SYSTEMS: SeedSystem[] = [
  {
    name: '示例系统 · 门户网站',
    client: '演示客户 A',
    assignee: '演示负责人 1',
    status: 'NOT_STARTED',
    start: shift(-6),
    end: shift(12),
    children: [
      {
        name: '需求梳理',
        assignee: '演示负责人 1',
        status: 'COMPLETED',
        start: shift(-6),
        end: shift(-2),
      },
      {
        name: '页面开发',
        assignee: '演示负责人 2',
        status: 'NOT_STARTED',
        start: shift(1),
        end: shift(10),
      },
    ],
  },
  {
    name: '示例系统 · 数据平台',
    client: '演示客户 B',
    assignee: '演示负责人 2',
    status: 'IN_PROGRESS',
    start: shift(-20),
    end: shift(-3),
    children: [
      {
        name: '数据接入',
        assignee: '演示负责人 2',
        status: 'COMPLETED',
        start: shift(-20),
        end: shift(-10),
      },
      {
        name: '权限模型',
        assignee: '演示负责人 1',
        status: 'IN_PROGRESS',
        start: shift(-12),
        end: shift(5),
      },
      {
        name: '报表导出',
        status: 'NOT_STARTED',
        start: shift(-5),
        end: shift(5),
      },
    ],
  },
  {
    name: '示例系统 · 移动端',
    client: '演示客户 A',
    assignee: '演示负责人 3',
    status: 'IN_PROGRESS',
    start: shift(-2),
    end: shift(25),
    children: [
      {
        name: '接口联调',
        assignee: '演示负责人 3',
        status: 'IN_PROGRESS',
        start: shift(-1),
        end: shift(8),
      },
      {
        name: '应用发布',
        assignee: '演示负责人 2',
        status: 'NOT_STARTED',
        start: shift(10),
        end: shift(20),
      },
      {
        name: '旧版兼容',
        status: 'ABANDONED',
        start: shift(-5),
        end: shift(5),
      },
    ],
  },
  {
    name: '示例系统 · 内部工具',
    assignee: '演示负责人 1',
    status: 'NOT_STARTED',
    start: shift(-10),
    end: shift(5),
    is_hidden: true,
    children: [
      {
        name: '权限梳理',
        assignee: '演示负责人 1',
        status: 'NOT_STARTED',
        start: shift(-10),
        end: shift(-1),
      },
      {
        name: '流程配置',
        status: 'ABANDONED',
        start: shift(-4),
        end: shift(3),
      },
    ],
  },
  {
    name: '示例系统 · 运营看板',
    client: '演示客户 B',
    assignee: '演示负责人 2',
    status: 'COMPLETED',
    start: shift(-30),
    end: shift(-5),
    children: [
      {
        name: '指标定义',
        assignee: '演示负责人 2',
        status: 'COMPLETED',
        start: shift(-30),
        end: shift(-20),
      },
      {
        name: '看板发布',
        assignee: '演示负责人 1',
        status: 'COMPLETED',
        start: shift(-12),
        end: shift(-5),
      },
    ],
  },
  {
    name: '示例系统 · 旧版门户',
    client: '演示客户 B',
    status: 'ABANDONED',
    start: shift(-60),
    end: shift(-10),
    children: [
      {
        name: '历史数据归档',
        status: 'COMPLETED',
        start: shift(-60),
        end: shift(-40),
      },
    ],
  },
];

const db = openDatabase(config.dbPath);
const service = new ProjectService(db);
const meta = { actor: 'seed-demo', origin: 'seed-demo' };

try {
  withTransaction(db, () => {
    db.exec('DELETE FROM tasks');
    db.exec('DELETE FROM audit_log');
    db.exec('DELETE FROM sessions');
    db.exec("UPDATE meta SET value = '0' WHERE key = 'tree_version'");
  });

  for (const system of SYSTEMS) {
    const created = service.createTask(
      {
        name: system.name,
        assignee: system.assignee,
        client: system.client,
        start_date: system.start,
        end_date: system.end,
        is_hidden: system.is_hidden,
      },
      meta,
    );
    const systemId = created.task?.id;
    if (!systemId) throw new Error(`创建系统失败: ${system.name}`);

    for (const child of system.children) {
      const childResult = service.createTask(
        {
          name: child.name,
          assignee: child.assignee,
          start_date: child.start,
          end_date: child.end,
          parent_id: systemId,
        },
        meta,
      );
      const childId = childResult.task?.id;
      if (!childId) throw new Error(`创建子任务失败: ${child.name}`);
      if (child.status !== 'NOT_STARTED') {
        service.updateTask(childId, { status: child.status }, meta);
      }
    }

    if (system.status !== 'NOT_STARTED') {
      service.updateTask(systemId, { status: system.status }, meta);
    }
  }

  const tree = service.getTree();
  const today = shift(0);
  let overdue = 0;
  for (const system of tree.systems) {
    if (system.status === 'NOT_STARTED' && system.start_date < today) overdue += 1;
    if (system.status === 'IN_PROGRESS' && system.end_date < today) overdue += 1;
    for (const task of system.tasks) {
      if (task.status === 'NOT_STARTED' && task.start_date < today) overdue += 1;
      if (task.status === 'IN_PROGRESS' && task.end_date < today) overdue += 1;
    }
  }

  const childCount = tree.systems.reduce((sum, system) => sum + system.tasks.length, 0);
  console.log(`演示数据已写入: ${tree.systems.length} 个系统 / ${childCount} 个子任务`);
  console.log(`当前版本: v${tree.version}，逾期项: ${overdue}`);
  console.log('用户账号已保留；登录会话已清空，请重新登录。');
} finally {
  db.close();
}
