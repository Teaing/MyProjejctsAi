<script setup lang="ts">
import { computed } from 'vue';
import { useAuth } from '../composables/useAuth';
import { scheduleWarning, todayRef, warningLabels } from '../lib/schedule';
import { statusMeta } from '../lib/status';
import type { Task } from '../types';

const { isAdmin } = useAuth();
const props = defineProps<{ task: Task; draggable: boolean }>();
const emit = defineEmits<{ edit: [task: Task] }>();

const warning = computed(() => scheduleWarning(props.task, todayRef.value));
const status = computed(() => statusMeta[props.task.status]);
</script>

<template>
  <button
    type="button"
    class="task-item w-full text-left bg-white border border-slate-200 rounded-xl p-2.5 flex items-center justify-between gap-2 shadow-2xs hover:shadow-xs hover:border-slate-300 transition-all"
    :class="isAdmin ? '' : 'cursor-default'"
    :aria-label="`${isAdmin ? '编辑' : '查看'}任务 ${task.name}，状态${status.label}`"
    @click="isAdmin && emit('edit', task)"
  >
    <div class="flex items-center gap-2 min-w-0" :class="draggable ? 'task-handle cursor-grab' : ''">
      <span v-if="draggable" class="text-slate-500 hover:text-slate-700 text-xs" aria-hidden="true">⋮⋮</span>
      <span class="text-xs font-medium text-slate-700 truncate" :title="task.name">{{ task.name }}</span>
      <span
        v-if="warning"
        class="warning-badge text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
        :data-warning="warning"
      >
        {{ warningLabels[warning] }}
      </span>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <span
        v-if="task.assignee"
        class="hidden sm:inline text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-md"
      >
        {{ task.assignee }}
      </span>
      <span class="text-[10px] text-slate-600 font-mono">
        {{ task.start_date.slice(5) }} ~ {{ task.end_date.slice(5) }}
      </span>
      <span class="status-chip text-[10px] px-1.5 py-0.5" :data-status="task.status">
        <span aria-hidden="true">{{ status.symbol }}</span>{{ status.shortLabel }}
      </span>
    </div>
  </button>
</template>
