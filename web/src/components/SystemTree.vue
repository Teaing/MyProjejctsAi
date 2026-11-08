<script setup lang="ts">
import { ref, watch } from 'vue';
import { VueDraggable } from 'vue-draggable-plus';
import type { SystemNode, Task, TaskStatus } from '../types';
import SystemCard from './SystemCard.vue';

const props = defineProps<{ systems: SystemNode[]; draggable: boolean }>();
const emit = defineEmits<{
  reorder: [orderedIds: string[]];
  'drag-start': [];
  edit: [task: Task];
  delete: [task: Task];
  'status-change': [task: Task, status: TaskStatus];
  'new-task': [systemId: string];
  'task-reorder': [parentId: string, orderedIds: string[]];
}>();

const local = ref<SystemNode[]>([]);

watch(
  () => props.systems,
  (value) => {
    local.value = value;
  },
  { immediate: true },
);

function onEnd(): void {
  emit(
    'reorder',
    local.value.map((system) => system.id),
  );
}

function onStatusChange(task: Task, status: TaskStatus): void {
  emit('status-change', task, status);
}

function onTaskReorder(parentId: string, orderedIds: string[]): void {
  emit('task-reorder', parentId, orderedIds);
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <VueDraggable
      v-model="local"
      :disabled="!draggable"
      :animation="150"
      handle=".sys-handle"
      ghost-class="drag-ghost"
      class="flex flex-col gap-4 overflow-y-auto max-h-[65vh] pr-1"
      @start="emit('drag-start')"
      @end="onEnd"
    >
      <SystemCard
        v-for="sys in local"
        :key="sys.id"
        :sys="sys"
        :draggable="draggable"
        @drag-start="emit('drag-start')"
        @edit="emit('edit', $event)"
        @delete="emit('delete', $event)"
        @status-change="onStatusChange"
        @new-task="emit('new-task', $event)"
        @task-reorder="onTaskReorder"
      />
    </VueDraggable>

    <p v-if="local.length === 0" class="text-xs text-slate-600 text-center py-8">暂无数据</p>
  </div>
</template>
