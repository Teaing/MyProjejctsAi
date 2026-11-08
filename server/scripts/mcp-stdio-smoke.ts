import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', 'src/mcp-stdio.ts'],
  cwd: process.cwd(),
});

function firstText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.find((item) => item.type === 'text')?.text ?? '';
}

const client = new Client({ name: 'gantt-stdio-smoke', version: '0.1.0' });

try {
  await client.connect(transport);
  console.log('stdio connected');

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  console.log(`stdio tools (${names.length}): ${names.join(', ')}`);
  assert.ok(names.includes('create_task'));
  assert.ok(names.includes('set_task_hidden'));

  const stamp = Date.now().toString().slice(-6);
  const created = await client.callTool({
    name: 'create_task',
    arguments: {
      name: `stdio 冒烟 ${stamp}`,
      start_date: '2026-12-15',
      end_date: '2026-12-18',
      is_hidden: true,
    },
  });
  assert.ok(!created.isError, firstText(created));
  console.log(`create_task: ${firstText(created)}`);

  const structured = created.structuredContent as { task?: { id: string } } | undefined;
  const taskId = structured?.task?.id;
  assert.ok(taskId, 'create_task 未返回 task.id');

  const resource = await client.readResource({ uri: 'project://gantt/tree' });
  const content = resource.contents[0];
  const raw = content && 'text' in content ? content.text : '{}';
  const tree = JSON.parse(raw) as {
    systems: Array<{ id: string; is_hidden: boolean }>;
  };
  const createdSystem = tree.systems.find((system) => system.id === taskId);
  assert.equal(createdSystem?.is_hidden, true);
  console.log('resource reflects is_hidden: true');

  const shown = await client.callTool({
    name: 'set_task_hidden',
    arguments: { task_id: taskId, hidden: false },
  });
  assert.ok(!shown.isError, firstText(shown));
  console.log(`set_task_hidden: ${firstText(shown)}`);

  const deleted = await client.callTool({
    name: 'delete_task',
    arguments: { task_id: taskId },
  });
  assert.ok(!deleted.isError, firstText(deleted));
  console.log(`delete_task: ${firstText(deleted)}`);

  console.log('stdio smoke test passed');
} finally {
  await client.close();
}
