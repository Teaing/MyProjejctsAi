<script setup lang="ts">
import { computed } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import { useAuth } from '../composables/useAuth';
import { scheduleWarning, todayRef, warningLabels } from '../lib/schedule';
import { statusMeta } from '../lib/status';
import type { SystemNode, Task, TaskStatus } from '../types';
import TaskRow from './TaskRow.vue';

const { isAdmin } = useAuth();
const props = defineProps<{ sys: SystemNode; draggable: boolean }>();
const emit = defineEmits<{
  edit: [task: Task];
  delete: [task: Task];
  'status-change': [task: Task, status: TaskStatus];
  'new-task': [systemId: string];
  'task-reorder': [parentId: string, orderedIds: string[]];
  'drag-start': [];
}>();

const warning = computed(() => scheduleWarning(props.sys, todayRef.value));
const childWarningCount = computed(
  () => props.sys.tasks.filter((task) => scheduleWarning(task, todayRef.value)).length,
);

function onStatus(event: Event): void {
  const target = event.target as HTMLSelectElement;
  emit('status-change', props.sys, target.value as TaskStatus);
}

function onTaskEnd(): void {
  emit(
    'task-reorder',
    props.sys.id,
    props.sys.tasks.map((task) => task.id),
  );
}
</script>

<template>
  <div
    class="system-card bg-slate-50/70 border border-slate-200/60 rounded-2xl p-4 flex flex-col gap-3 transition-all hover:border-slate-300"
    :class="[
      sys.is_hidden ? 'system-card--hidden' : '',
      !warning && childWarningCount > 0 ? 'system-card--child-warning' : '',
    ]"
    :data-warning="warning ?? undefined"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-2 min-w-0" :class="draggable ? 'sys-handle cursor-grab' : ''">
        <span v-if="draggable" class="text-slate-500 hover:text-slate-700 font-bold" aria-hidden="true">⋮⋮</span>
        <span
          v-if="sys.client"
          class="text-[10px] bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded-md shrink-0 max-w-[90px] truncate"
          :title="sys.client"
        >
          {{ sys.client }}
        </span>
        <span class="font-bold text-slate-800 text-sm truncate" :title="sys.name">{{ sys.name }}</span>
        <span
          v-if="sys.is_hidden"
          class="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md shrink-0"
        >
          已隐藏
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <select
          v-if="isAdmin"
          :value="sys.status"
          class="status-select text-[11px] font-semibold bg-white border border-slate-300 rounded-lg px-2 py-1"
          :data-status="sys.status"
          :aria-label="`${sys.name}的状态`"
          @change="onStatus"
        >
          <option value="NOT_STARTED">未开始</option>
          <option value="IN_PROGRESS">实施中</option>
          <option value="COMPLETED">已完成</option>
          <option value="ABANDONED">已废弃</option>
        </select>
        <span
          v-else
          class="status-chip text-[10px] px-1.5 py-0.5"
          :data-status="sys.status"
        >
          {{ statusMeta[sys.status].label }}
        </span>
        <template v-if="isAdmin">
          <button class="text-slate-600 hover:text-slate-900 text-xs px-1" @click="emit('edit', sys)">
            编辑
          </button>
          <button
            class="text-slate-500 hover:text-rose-700 text-sm px-1"
            title="删除"
            :aria-label="`删除系统 ${sys.name}`"
            @click="emit('delete', sys)"
          >
            ×
          </button>
        </template>
      </div>
    </div>

    <div class="flex items-center justify-between pl-4 gap-2">
      <span class="text-[10px] text-slate-600 truncate">
        <span
          v-if="warning"
          class="font-medium"
          :class="warning === 'IN_PROGRESS_OVERDUE' ? 'text-rose-700' : 'text-amber-700'"
        >
          {{ warningLabels[warning] }} ·
        </span>
        <span v-else-if="childWarningCount" class="font-medium text-rose-700">
          {{ childWarningCount }} 项子任务异常 ·
        </span>
        进度 {{ sys.progress }}% · {{ sys.start_date }} ~ {{ sys.end_date }}
        <template v-if="sys.assignee"> · 负责人 {{ sys.assignee }}</template>
      </span>
      <button
        v-if="isAdmin"
        class="text-[11px] text-blue-700 hover:text-blue-800 font-semibold shrink-0"
        @click="emit('new-task', sys.id)"
      >
        + 子任务
      </button>
    </div>

    <VueDraggable
      v-model="sys.tasks"
      :animation="150"
      :disabled="!isAdmin"
      handle=".task-handle"
      ghost-class="drag-ghost"
      class="pl-4 border-l-2 border-slate-200 flex flex-col gap-2 min-h-[10px]"
      @start="emit('drag-start')"
      @end="onTaskEnd"
    >
      <TaskRow
        v-for="task in sys.tasks"
        :key="task.id"
        :task="task"
        :draggable="isAdmin && draggable"
        @edit="emit('edit', $event)"
      />
    </VueDraggable>

    <p v-if="sys.tasks.length === 0" class="text-[11px] text-slate-600 pl-4">暂无子任务</p>
  </div>
</template>
