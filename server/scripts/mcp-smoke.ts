import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = new URL(process.env.MCP_URL ?? 'http://127.0.0.1:3000/mcp');

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  const block = result.content.find((item) => item.type === 'text');
  return block?.text ?? '';
}

async function authHeaders(): Promise<Record<string, string>> {
  if (process.env.MCP_TOKEN) {
    return { Authorization: `Bearer ${process.env.MCP_TOKEN}` };
  }

  const username = process.env.MCP_USERNAME;
  const password = process.env.MCP_PASSWORD;
  if (!username || !password) {
    throw new Error('请设置 MCP_TOKEN，或设置 MCP_USERNAME / MCP_PASSWORD 用于登录');
  }

  const response = await fetch(new URL('/api/auth/login', endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`登录失败（${response.status}）`);

  const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  if (!cookie) throw new Error('登录成功但没有返回会话 Cookie');
  return { Cookie: cookie.split(';')[0]! };
}

const client = new Client({ name: 'gantt-smoke', version: '0.1.0' });
const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: await authHeaders() },
});

try {
  await client.connect(transport);
  console.log(`connected: ${endpoint.href}`);

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  console.log(`tools (${names.length}): ${names.join(', ')}`);

  for (const expected of [
    'create_task',
    'update_task_dates',
    'reorder_priority',
    'update_task_status',
    'set_task_hidden',
    'set_task_assignee',
    'set_task_client',
    'delete_task',
  ]) {
    assert.ok(names.includes(expected), `缺少工具 ${expected}`);
  }

  const resource = await client.readResource({ uri: 'project://gantt/tree' });
  const content = resource.contents[0];
  const raw = content && 'text' in content ? content.text : '{}';
  const tree = JSON.parse(raw) as { version: number; systems: unknown[] };
  console.log(`resource ok: v${tree.version}, ${tree.systems.length} systems`);

  const stamp = Date.now().toString().slice(-6);
  const created = await client.callTool({
    name: 'create_task',
    arguments: {
      name: `MCP 冒烟 ${stamp}`,
      start_date: '2026-12-01',
      end_date: '2026-12-05',
    },
  });
  assert.ok(!created.isError, firstText(created));
  console.log(`create_task: ${firstText(created)}`);

  const structured = created.structuredContent as
    | { task?: { id: string; status?: string } }
    | undefined;
  const taskId = structured?.task?.id;
  assert.ok(taskId, 'create_task 未返回 task.id');
  assert.equal(structured?.task?.status, 'NOT_STARTED', '新记录应默认未开始');

  const updated = await client.callTool({
    name: 'update_task_status',
    arguments: { task_id: taskId, status: 'IN_PROGRESS' },
  });
  assert.ok(!updated.isError, firstText(updated));
  console.log(`update_task_status (start): ${firstText(updated)}`);

  const completed = await client.callTool({
    name: 'update_task_status',
    arguments: { task_id: taskId, status: 'COMPLETED' },
  });
  assert.ok(!completed.isError, firstText(completed));
  console.log(`update_task_status (complete): ${firstText(completed)}`);

  const reset = await client.callTool({
    name: 'update_task_status',
    arguments: { task_id: taskId, status: 'NOT_STARTED' },
  });
  assert.ok(!reset.isError, firstText(reset));
  console.log(`update_task_status (reset): ${firstText(reset)}`);

  const rescheduled = await client.callTool({
    name: 'update_task_dates',
    arguments: { task_id: taskId, start_date: '2026-12-02', end_date: '2026-12-08' },
  });
  assert.ok(!rescheduled.isError, firstText(rescheduled));
  console.log(`update_task_dates: ${firstText(rescheduled)}`);

  const reordered = await client.callTool({
    name: 'reorder_priority',
    arguments: { task_id: taskId, new_priority: 0 },
  });
  assert.ok(!reordered.isError, firstText(reordered));
  console.log(`reorder_priority: ${firstText(reordered)}`);

  const hidden = await client.callTool({
    name: 'set_task_hidden',
    arguments: { task_id: taskId, hidden: true },
  });
  assert.ok(!hidden.isError, firstText(hidden));
  console.log(`set_task_hidden: ${firstText(hidden)}`);

  const shown = await client.callTool({
    name: 'set_task_hidden',
    arguments: { task_id: taskId, hidden: false },
  });
  assert.ok(!shown.isError, firstText(shown));
  console.log(`set_task_hidden (show): ${firstText(shown)}`);

  const assigned = await client.callTool({
    name: 'set_task_assignee',
    arguments: { task_id: taskId, assignee: '张三' },
  });
  assert.ok(!assigned.isError, firstText(assigned));
  console.log(`set_task_assignee: ${firstText(assigned)}`);

  const cleared = await client.callTool({
    name: 'set_task_assignee',
    arguments: { task_id: taskId, assignee: null },
  });
  assert.ok(!cleared.isError, firstText(cleared));
  console.log(`set_task_assignee (clear): ${firstText(cleared)}`);

  const clientSet = await client.callTool({
    name: 'set_task_client',
    arguments: { task_id: taskId, client: '测试客户' },
  });
  assert.ok(!clientSet.isError, firstText(clientSet));
  console.log(`set_task_client: ${firstText(clientSet)}`);

  const clientCleared = await client.callTool({
    name: 'set_task_client',
    arguments: { task_id: taskId, client: null },
  });
  assert.ok(!clientCleared.isError, firstText(clientCleared));
  console.log(`set_task_client (clear): ${firstText(clientCleared)}`);

  const deleted = await client.callTool({
    name: 'delete_task',
    arguments: { task_id: taskId },
  });
  assert.ok(!deleted.isError, firstText(deleted));
  console.log(`delete_task: ${firstText(deleted)}`);

  console.log('MCP smoke test passed');
} finally {
  await client.close();
}
