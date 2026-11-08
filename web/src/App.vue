<script setup lang="ts">
import { computed, ref } from 'vue';
import AppHeader from './components/AppHeader.vue';
import GanttChart from './components/GanttChart.vue';
import LoginView from './components/LoginView.vue';
import McpLogPanel from './components/McpLogPanel.vue';
import SystemTree from './components/SystemTree.vue';
import TaskDialog from './components/TaskDialog.vue';
import { initAuth, useAuth } from './composables/useAuth';
import { useLiveSync } from './composables/useLiveSync';
import { useProjectStore } from './composables/useProjectStore';
import { scheduleWarning, todayRef } from './lib/schedule';
import type { Filter, Task, TaskFormPayload, TaskStatus, UpdateTaskPayload } from './types';

const { user, ready, isAdmin, logout } = useAuth();
void initAuth();

useLiveSync();

const {
  systems,
  filter,
  clientFilter,
  clients,
  showHidden,
  logs,
  version,
  connected,
  errorMessage,
  filteredSystems,
  counts,
  hiddenCount,
  createTask,
  updateTask,
  removeTask,
  reorder,
  beginDrag,
} = useProjectStore();

interface DialogState {
  mode: 'system' | 'task' | 'edit';
  task?: Task;
  parentId?: string | null;
  parentName?: string;
}

const dialog = ref<DialogState | null>(null);
const showTree = ref(false);

function setFilter(value: Filter): void {
  filter.value = value;
}

function setShowHidden(value: boolean): void {
  showHidden.value = value;
}

function setClientFilter(value: string): void {
  clientFilter.value = value;
}

const canDrag = computed(
  () =>
    isAdmin.value &&
    clientFilter.value === '__ALL__' &&
    filter.value === 'ALL' &&
    (showHidden.value || hiddenCount.value === 0),
);

const dragHint = computed(() => {
  if (!isAdmin.value) return '只读模式';
  if (clientFilter.value !== '__ALL__' || filter.value !== 'ALL') return '系统排序已禁用';
  if (!showHidden.value && hiddenCount.value > 0) return '显示隐藏项后可排系统';
  return '按住 ⋮⋮ 拖拽调序';
});

const warningCount = computed(() => {
  const today = todayRef.value;
  let count = 0;
  for (const system of filteredSystems.value) {
    if (scheduleWarning(system, today)) count += 1;
    for (const task of system.tasks) {
      if (scheduleWarning(task, today)) count += 1;
    }
  }
  return count;
});

function openNewSystem(): void {
  if (!isAdmin.value) return;
  dialog.value = { mode: 'system' };
}

function openNewTask(systemId: string): void {
  if (!isAdmin.value) return;
  const system = systems.value.find((item) => item.id === systemId);
  dialog.value = { mode: 'task', parentId: systemId, parentName: system?.name };
}

function openEdit(task: Task): void {
  if (!isAdmin.value) return;
  dialog.value = { mode: 'edit', task, parentId: task.parent_id };
}

async function submitDialog(payload: TaskFormPayload): Promise<void> {
  if (!dialog.value) return;

  const current = dialog.value;
  let ok = false;

  if (current.mode === 'system') {
    ok = await createTask({
      name: payload.name,
      assignee: payload.assignee,
      client: payload.client,
      start_date: payload.start_date,
      end_date: payload.end_date,
    });
  } else if (current.mode === 'task') {
    ok = await createTask({
      name: payload.name,
      assignee: payload.assignee,
      start_date: payload.start_date,
      end_date: payload.end_date,
      parent_id: current.parentId ?? null,
    });
  } else if (current.task) {
    const patch: UpdateTaskPayload = {
      name: payload.name,
      assignee: payload.assignee,
      start_date: payload.start_date,
      end_date: payload.end_date,
      status: payload.status,
    };
    if (current.task.parent_id === null) {
      patch.client = payload.client;
      patch.is_hidden = payload.is_hidden;
    }
    ok = await updateTask(current.task.id, patch);
  }

  if (ok) dialog.value = null;
}

async function onStatusChange(task: Task, status: TaskStatus): Promise<void> {
  if (!isAdmin.value) return;
  await updateTask(task.id, { status });
}

async function onDelete(task: Task): Promise<void> {
  if (!isAdmin.value) return;
  const hasChildren = (task.tasks?.length ?? 0) > 0;
  const message = hasChildren
    ? `确定删除「${task.name}」及其全部子任务？`
    : `确定删除「${task.name}」？`;
  if (!window.confirm(message)) return;
  await removeTask(task.id);
}

function onSystemReorder(orderedIds: string[]): void {
  void reorder(null, orderedIds);
}

function onTaskReorder(parentId: string, orderedIds: string[]): void {
  void reorder(parentId, orderedIds);
}
</script>

<template>
  <div v-if="!ready" class="min-h-screen flex items-center justify-center p-4" aria-live="polite">
    <div class="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-700 shadow-sm">
      <span class="h-4 w-4 rounded-full border-2 border-blue-200 border-t-blue-700 animate-spin" aria-hidden="true"></span>
      正在验证登录状态…
    </div>
  </div>

  <LoginView v-else-if="!user" />

  <div v-else class="min-h-screen flex flex-col">
    <div class="flex-1 flex flex-col max-w-[1680px] w-full mx-auto p-4 sm:p-6 gap-6">
      <AppHeader
        :user="user"
        :filter="filter"
        :counts="counts"
        :show-hidden="showHidden"
        :hidden-count="hiddenCount"
        :clients="clients"
        :client-filter="clientFilter"
        :warning-count="warningCount"
        @update:filter="setFilter"
        @update:show-hidden="setShowHidden"
        @update:client-filter="setClientFilter"
        @new-system="openNewSystem"
        @logout="logout"
      />

      <main class="flex flex-col xl:flex-row gap-6 flex-1 items-stretch">
        <section
          v-if="showTree"
          class="xl:w-[380px] shrink-0 bg-white p-5 rounded-3xl shadow-xs border border-slate-100 flex flex-col gap-4"
        >
          <div class="flex justify-between items-center gap-3">
            <h2 class="text-sm font-bold text-slate-700 uppercase tracking-wider">
              系统与实施内容排期
            </h2>
            <span class="text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-xl shrink-0">
              {{ dragHint }}
            </span>
          </div>

          <SystemTree
            :systems="filteredSystems"
            :draggable="canDrag"
            @drag-start="beginDrag"
            @reorder="onSystemReorder"
            @task-reorder="onTaskReorder"
            @edit="openEdit"
            @delete="onDelete"
            @status-change="onStatusChange"
            @new-task="openNewTask"
          />
        </section>

        <GanttChart
          :systems="filteredSystems"
          :tree-open="showTree"
          @toggle-tree="showTree = !showTree"
          @edit="openEdit"
        />
      </main>

      <McpLogPanel :logs="logs" :connected="connected" :version="version" />
    </div>

    <TaskDialog
      :open="dialog !== null"
      :mode="dialog?.mode ?? 'system'"
      :task="dialog?.task ?? null"
      :parent-name="dialog?.parentName"
      @close="dialog = null"
      @submit="submitDialog"
    />

    <div
      v-if="errorMessage"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-rose-700 text-white text-xs font-medium px-4 py-2.5 rounded-2xl shadow-lg"
      role="alert"
    >
      {{ errorMessage }}
    </div>
  </div>
</template>
