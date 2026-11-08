import { AuthService, type Role } from '../src/auth.js';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';

const args = process.argv.slice(2);
const command = args[0];

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage(): void {
  console.log(`用法:
  npm run user:create -- --username <name> --password <password> [--role ADMIN|READONLY]
  npm run user:list
  npm run user:password -- --username <name> --password <new-password>
  npm run user:token -- --username <name>
  npm run user:enable -- --username <name>
  npm run user:disable -- --username <name>`);
}

const db = openDatabase(config.dbPath);
const auth = new AuthService(db);

try {
  switch (command) {
    case 'create': {
      const username = option('username');
      const password = option('password');
      const role = (option('role') ?? 'READONLY').toUpperCase() as Role;
      if (!username || !password) throw new Error('缺少 --username 或 --password');
      if (role !== 'ADMIN' && role !== 'READONLY') {
        throw new Error('--role 只能是 ADMIN 或 READONLY');
      }
      const user = auth.createUser({ username, password, role });
      console.log(`已创建用户: ${user.username}（${user.role}）`);
      break;
    }

    case 'list': {
      const users = auth.listUsers();
      if (users.length === 0) {
        console.log('暂无用户');
        break;
      }
      for (const user of users) {
        console.log(
          `${user.username}\t${user.role}\t${user.is_active ? '启用' : '停用'}\t${
            user.has_api_token ? '有 Token' : '无 Token'
          }`,
        );
      }
      break;
    }

    case 'password': {
      const username = option('username');
      const password = option('password');
      if (!username || !password) throw new Error('缺少 --username 或 --password');
      auth.setPassword(username, password);
      console.log(`已更新「${username}」的密码，原有会话已失效`);
      break;
    }

    case 'token': {
      const username = option('username');
      if (!username) throw new Error('缺少 --username');
      const token = auth.createApiToken(username);
      console.log(`用户「${username}」的新 API Token（只显示这一次）:`);
      console.log(token);
      console.log('请通过 Authorization: Bearer <token> 访问 /mcp');
      break;
    }

    case 'enable':
    case 'disable': {
      const username = option('username');
      if (!username) throw new Error('缺少 --username');
      auth.setActive(username, command === 'enable');
      console.log(`已${command === 'enable' ? '启用' : '停用'}用户「${username}」`);
      break;
    }

    default:
      usage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  db.close();
}
