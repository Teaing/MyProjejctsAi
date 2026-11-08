import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { buildMcpServer } from './mcp.js';
import { ProjectService } from './projectService.js';

const db = openDatabase(config.dbPath);
const service = new ProjectService(db);

const handle = serveStdio(() => buildMcpServer(service), {
  onerror: (error) => console.error('MCP stdio error:', error),
});

console.error(`MCP stdio ready (DB: ${config.dbPath})`);

let closing = false;

async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await handle.close();
  } finally {
    db.close();
    process.exit(0);
  }
}

process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
