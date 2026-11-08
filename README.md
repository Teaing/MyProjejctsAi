# 项目管理 MCP 协同控制台

一个面向实施项目的轻量排期系统：Web 端提供两级项目树、甘特时间轴和实时协同，服务端同时暴露 REST API 与 MCP（Model Context Protocol），让人和 Agent 操作同一份数据。

## 功能

- **两级结构**：应用系统（根）→ 实施任务（子任务），不支持三级
- **甘特图**：全宽时间轴，支持拖拽平移、拖两端调整起止日期；手机端可用
- **手动状态流转**：未开始 / 实施中 / 已完成 / 已废弃。录入或到达开始日期都不会自动开始工作
- **逾期提示**：`未开始` 且开始日期早于今天 →「逾期未开始」；`实施中` 且结束日期早于今天 →「已超期」，列表、甘特条和顶部统计同步高亮
- **筛选与排序**：状态筛选、客户筛选、隐藏项开关、拖拽调整优先级
- **登录与角色**：管理员（读写）与只读用户（只能查看），服务端强制校验
- **实时同步**：WebSocket 推送完整树和版本号，跨进程写入也会同步
- **MCP 支持**：Agent 可读取 `project://gantt/tree` 并调用创建、改期、改状态、排序、隐藏、删除等工具
- **审计日志**：每次写操作记录操作人、动作、变更前后数据

## 技术栈

- 运行时：Node.js **>= 24**（使用内置 `node:sqlite`）
- 服务端：TypeScript、Express 5、MCP TypeScript SDK、WebSocket (`ws`)、SQLite（WAL）
- 前端：Vue 3、Vite、Tailwind CSS v4、`vue-draggable-plus`
- 工程：npm workspaces（`server` + `web`）

## 快速开始

```bash
npm install

# 首次启动时创建管理员（仅当用户表为空时生效）
ADMIN_USERNAME=admin ADMIN_PASSWORD='请换成至少8位的密码' npm run dev
```

打开 `http://localhost:5173`。开发模式会同时启动 API（`127.0.0.1:3000`）和 Vite。

生产模式：

```bash
npm run build
npm start
```

打开 `http://127.0.0.1:3000`。

### 演示数据

```bash
npm run seed:demo -w server -- --yes
```

该命令会清空项目、审计日志和登录会话，写入一套通用演示数据（6 个系统、13 个子任务、全部四种状态、逾期示例、隐藏系统和负责人），但**保留现有用户账号**。执行后需要重新登录。

## 登录与角色

| 角色 | 权限 |
|---|---|
| `ADMIN` | 查看全部数据；新建、编辑、拖拽、改状态、删除；使用全部 MCP 写工具 |
| `READONLY` | 查看全部数据（含隐藏项和审计日志）；不能新增、删除或修改任何项目 |

服务端在 REST、WebSocket、HTTP MCP 三层强制校验角色，前端隐藏按钮只是体验层。

### 用户管理

```bash
npm run user:list -w server
npm run user:create -w server -- --username alice --password '至少8位密码' --role READONLY
npm run user:password -w server -- --username alice --password '新密码'
npm run user:token -w server -- --username alice
npm run user:disable -w server -- --username alice
npm run user:enable -w server -- --username alice
```

- 密码使用 scrypt 哈希存储
- 会话使用 HttpOnly + SameSite=Strict Cookie，默认 12 小时后过期；服务端只存会话哈希
- 每个用户保留一个 API Token，重新生成会使旧 Token 立即失效
- 重置密码、停用用户、退出登录都会使已有会话失效

## MCP

### HTTP（Streamable HTTP）

地址：`http://127.0.0.1:3000/mcp`

需要请求头：

```http
Authorization: Bearer <API_TOKEN>
```

Token 通过 `npm run user:token -w server -- --username <name>` 生成，只显示一次。只读用户的 Token 只能读取资源，不会注册任何写工具。

### stdio（推荐本地 Agent）

```json
{
  "command": "node",
  "args": ["--import", "tsx", "src/mcp-stdio.ts"],
  "cwd": "/absolute/path/to/MyProjejctsAi/server"
}
```

不要通过 `npm run` 启动 stdio MCP：npm 会把脚本横幅输出到 stdout，破坏 JSON-RPC 流。stdio 进程视为本机管理员。

### 工具与资源

- 资源：`project://gantt/tree`
- 工具：`create_task`、`update_task_dates`、`reorder_priority`、`update_task_status`、`set_task_hidden`、`set_task_assignee`、`set_task_client`、`delete_task`

详细契约见 [AGENTS.md](./AGENTS.md)。

## HTTP API

| 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/api/health` | 公开 |
| POST | `/api/auth/login` | 公开 |
| POST | `/api/auth/logout` | 公开 |
| GET | `/api/auth/me` | 登录 |
| GET | `/api/tree` | 登录 |
| GET | `/api/audit?limit=50` | 登录 |
| POST | `/api/tasks` | 管理员 |
| PATCH | `/api/tasks/:id` | 管理员 |
| DELETE | `/api/tasks/:id?cascade=true` | 管理员 |
| POST | `/api/tasks/reorder` | 管理员 |

所有写接口返回完整的更新后树和单调递增的 `version`。

## 数据与备份

数据库：`server/data/app.db`（SQLite，WAL 模式，已加入 `.gitignore`）。

```bash
npm run backup -w server
npm run restore -w server -- <backup.db> --yes
```

恢复前必须停止服务；脚本会先对当前数据库做 checkpoint 和备份。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `HOST` | `127.0.0.1` | 监听地址；不要在没有 HTTPS/反向代理时暴露到公网 |
| `PORT` | `3000` | HTTP 端口 |
| `DB_PATH` | `server/data/app.db` | SQLite 文件路径 |
| `ADMIN_USERNAME` | 无 | 用户表为空时创建管理员 |
| `ADMIN_PASSWORD` | 无 | 与 `ADMIN_USERNAME` 同时设置，至少 8 位 |
| `SESSION_HOURS` | `12` | 会话有效期（1–720 小时） |
| `COOKIE_SECURE` | `false` | HTTPS 部署时设为 `true` |
| `ALLOWED_HOSTS` | 无 | 额外允许的 Host/Origin 主机名，逗号分隔 |

## 测试与冒烟

```bash
npm run typecheck
npm test

npm run auth:smoke -w server
npm run mcp:stdio:smoke -w server

# 需要先登录，脚本会创建并清理临时数据
MCP_USERNAME=admin MCP_PASSWORD='...' npm run mcp:smoke -w server
SMOKE_USERNAME=admin SMOKE_PASSWORD='...' npm run ws:smoke -w server
```

## 目录结构

```
.
├── server/
│   ├── src/            # API、认证、MCP、WebSocket、SQLite
│   ├── scripts/        # 演示数据、备份恢复、用户管理、冒烟测试
│   ├── test/           # node:test 单元测试
│   └── data/           # 运行时数据库（不提交）
├── web/
│   └── src/            # Vue 3 前端
├── AGENTS.md           # MCP Agent 契约
└── README.md
```

## 安全说明

- 默认仅绑定 `127.0.0.1`，定位为单机/内网工具；如需公网访问，请置于 HTTPS 反向代理之后并设置 `COOKIE_SECURE=true`
- 登录有失败次数限制；用户名不存在时也执行哈希校验，降低枚举风险
- 审计日志是追加记录，但不是防篡改哈希链
- 拥有服务器操作系统权限的人可以直接操作数据库、CLI 或 stdio MCP，这属于本机信任边界
