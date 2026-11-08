import { computed, ref } from 'vue';
import { api } from '../lib/api';
import type {
  AuditEntry,
  CreateTaskPayload,
  Filter,
  MutationResponse,
  SystemNode,
  TreeSnapshot,
  UpdateTaskPayload,
} from '../types';

const systems = ref<SystemNode[]>([]);
const version = ref(0);
const filter = ref<Filter>('ALL');
const clientFilter = ref('__ALL__');
const showHidden = ref(false);
const logs = ref<AuditEntry[]>([]);
const errorMessage = ref('');
const loading = ref(false);
const connected = ref(false);

let dragging = false;
let queuedSnapshot: TreeSnapshot | null = null;

const reasonLabels: Record<string, string> = {
  create: '创建数据',
  update: '更新数据',
  reorder: '调整顺序',
  delete: '删除数据',
};

const actorLabels: Record<string, string> = {
  mcp: 'MCP Agent',
  web: 'Web 端',
  rest: 'API 调用',
};

function reportError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : '操作失败';
  window.setTimeout(() => {
    errorMessage.value = '';
  }, 4000);
}

function applyTree(snapshot: TreeSnapshot, force = false): void {
  // 永不接受旧版本，避免慢响应或旧快照把较新的数据回退。
  if (snapshot.version < version.value) return;
  if (!force && snapshot.version === version.value) return;
  if (dragging) {
    queuedSnapshot = snapshot;
    return;
  }
  systems.value = snapshot.systems;
  version.value = snapshot.version;
}

function applyResult(result: MutationResponse): void {
  applyTree({ version: result.version, systems: result.systems });
}

function beginDrag(): void {
  dragging = true;
}

function endDrag(): void {
  dragging = false;
  if (!queuedSnapshot) return;
  const pending = queuedSnapshot;
  queuedSnapshot = null;
  if (pending.version > version.value) {
    systems.value = pending.systems;
    version.value = pending.version;
  }
}

function reset(): void {
  systems.value = [];
  version.value = 0;
  logs.value = [];
  errorMessage.value = '';
  connected.value = false;
  dragging = false;
  queuedSnapshot = null;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [tree, audit] = await Promise.all([api.getTree(), api.getAudit(50)]);
    applyTree(tree, true);
    logs.value = audit.items;
  } catch (error) {
    reportError(error);
  } finally {
    loading.value = false;
  }
}

async function createTask(payload: CreateTaskPayload): Promise<boolean> {
  try {
    applyResult(await api.createTask(payload));
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

async function updateTask(id: string, payload: UpdateTaskPayload): Promise<boolean> {
  try {
    applyResult(await api.updateTask(id, payload));
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

async function removeTask(id: string): Promise<boolean> {
  try {
    applyResult(await api.deleteTask(id, true));
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}

async function reorder(parentId: string | null, orderedIds: string[]): Promise<void> {
  try {
    applyResult(await api.reorder(parentId, orderedIds));
  } catch (error) {
    reportError(error);
    await load();
  } finally {
    endDrag();
  }
}

function pushLiveLog(event: { version: number; actor?: string; reason?: string }): void {
  const reason = event.reason ?? 'update';
  const actor = event.actor ?? 'system';
  logs.value.unshift({
    id: -Date.now(),
    tree_version: event.version,
    action: reason,
    entity_type: '',
    entity_id: null,
    actor,
    origin: null,
    summary: `${actorLabels[actor] ?? actor} ${reasonLabels[reason] ?? reason} · v${event.version}`,
    before_json: null,
    after_json: null,
    created_at: new Date().toISOString(),
  });
  if (logs.value.length > 80) logs.value.length = 80;
}

const clients = computed<string[]>(() => [
  ...new Set(
    systems.value
      .map((item) => item.client)
      .filter((value): value is string => Boolean(value)),
  ),
]);

const clientScopedSystems = computed<SystemNode[]>(() => {
  if (clientFilter.value === '__NONE__') {
    return systems.value.filter((item) => !item.client);
  }
  if (clientFilter.value === '__ALL__') {
    return systems.value;
  }
  return systems.value.filter((item) => item.client === clientFilter.value);
});

const visibleSystems = computed<SystemNode[]>(() =>
  showHidden.value
    ? clientScopedSystems.value
    : clientScopedSystems.value.filter((item) => !item.is_hidden),
);

const filteredSystems = computed<SystemNode[]>(() =>
  filter.value === 'ALL'
    ? visibleSystems.value
    : visibleSystems.value.filter((item) => item.status === filter.value),
);

const counts = computed(() => ({
  ALL: visibleSystems.value.length,
  NOT_STARTED: visibleSystems.value.filter((item) => item.status === 'NOT_STARTED').length,
  IN_PROGRESS: visibleSystems.value.filter((item) => item.status === 'IN_PROGRESS').length,
  COMPLETED: visibleSystems.value.filter((item) => item.status === 'COMPLETED').length,
  ABANDONED: visibleSystems.value.filter((item) => item.status === 'ABANDONED').length,
}));

const hiddenCount = computed(
  () => clientScopedSystems.value.filter((item) => item.is_hidden).length,
);

export function useProjectStore() {
  return {
    systems,
    version,
    filter,
    clientFilter,
    clients,
    showHidden,
    logs,
    errorMessage,
    loading,
    connected,
    filteredSystems,
    counts,
    hiddenCount,
    load,
    createTask,
    updateTask,
    removeTask,
    reorder,
    applyTree,
    pushLiveLog,
    beginDrag,
    endDrag,
    reset,
  };
}
