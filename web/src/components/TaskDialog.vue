<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import type { Task, TaskFormPayload, TaskStatus } from '../types';

const props = defineProps<{
  open: boolean;
  mode: 'system' | 'task' | 'edit';
  task?: Task | null;
  parentName?: string;
}>();

const emit = defineEmits<{ close: []; submit: [payload: TaskFormPayload] }>();

const form = reactive({
  name: '',
  assignee: '',
  client: '',
  start_date: '',
  end_date: '',
  status: 'IN_PROGRESS' as TaskStatus,
  is_hidden: false,
});
const message = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(base: string, days: number): string {
  const [year, month, day] = base.split('-').map(Number);
  return formatDate(new Date(year, month - 1, day + days));
}

watch(
  () => [props.open, props.task, props.mode] as const,
  () => {
    if (!props.open) return;
    message.value = '';

    if (props.task) {
      form.name = props.task.name;
      form.assignee = props.task.assignee ?? '';
      form.client = props.task.client ?? '';
      form.start_date = props.task.start_date;
      form.end_date = props.task.end_date;
      form.status = props.task.status;
      form.is_hidden = props.task.is_hidden;
      return;
    }

    const today = formatDate(new Date());
    form.name = '';
    form.assignee = '';
    form.client = '';
    form.start_date = today;
    form.end_date = addDays(today, 7);
    form.status = 'IN_PROGRESS';
    form.is_hidden = false;
  },
  { immediate: true },
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    nameInput.value?.focus();
  },
);

const showClient = computed(
  () => props.mode === 'system' || (props.mode === 'edit' && props.task?.parent_id === null),
);

const title = computed(() => {
  if (props.mode === 'system') return '新建应用系统';
  if (props.mode === 'task') {
    return props.parentName ? `新建子任务 · ${props.parentName}` : '新建子任务';
  }
  return `编辑 · ${props.task?.name ?? ''}`;
});

function submit(): void {
  const name = form.name.trim();
  if (!name) {
    message.value = '名称不能为空';
    return;
  }
  if (!form.start_date || !form.end_date) {
    message.value = '请选择开始与结束日期';
    return;
  }
  if (form.end_date < form.start_date) {
    message.value = '结束日期不能早于开始日期';
    return;
  }
  emit('submit', {
    name,
    assignee: form.assignee.trim() || null,
    client: form.client.trim() || null,
    start_date: form.start_date,
    end_date: form.end_date,
    status: form.status,
    is_hidden: form.is_hidden,
  });
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="task-dialog-title"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <form
      class="w-full max-w-md bg-white rounded-3xl p-6 shadow-xl flex flex-col gap-4"
      @submit.prevent="submit"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 id="task-dialog-title" class="text-base font-bold text-slate-800">{{ title }}</h2>
          <p class="text-xs text-slate-600 mt-1">日期格式为 YYYY-MM-DD，优先级可通过拖拽调整</p>
        </div>
        <button
          type="button"
          class="text-slate-500 hover:text-slate-800 text-xl leading-none"
          aria-label="关闭对话框"
          @click="emit('close')"
        >
          ×
        </button>
      </div>

      <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
        名称
        <input
          ref="nameInput"
          v-model="form.name"
          type="text"
          maxlength="200"
          placeholder="请输入系统或任务名称"
          class="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-700"
        />
      </label>

      <label v-if="showClient" class="flex flex-col gap-1 text-xs font-medium text-slate-600">
        客户（可选）
        <input
          v-model="form.client"
          type="text"
          maxlength="100"
          placeholder="请输入客户名称，可留空"
          class="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-700"
        />
      </label>

      <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
        负责人（可选）
        <input
          v-model="form.assignee"
          type="text"
          maxlength="100"
          placeholder="留空表示未指定"
          class="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-700"
        />
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          开始日期
          <input
            v-model="form.start_date"
            type="date"
            class="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-700"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs font-medium text-slate-600">
          结束日期
          <input
            v-model="form.end_date"
            type="date"
            class="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-700"
          />
        </label>
      </div>

      <label v-if="mode === 'edit'" class="flex flex-col gap-1 text-xs font-medium text-slate-600">
        状态
        <select
          v-model="form.status"
          class="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-700"
        >
          <option value="NOT_STARTED">未开始</option>
          <option value="IN_PROGRESS">实施中</option>
          <option value="COMPLETED">已完成</option>
          <option value="ABANDONED">已废弃</option>
        </select>
      </label>

      <label
        v-if="mode === 'edit' && task?.parent_id === null"
        class="flex items-center gap-2 text-xs font-medium text-slate-600"
      >
        <input
          v-model="form.is_hidden"
          type="checkbox"
          class="h-4 w-4 rounded border-slate-300 accent-slate-800"
        />
        在视图中隐藏（可随时恢复）
      </label>

      <p v-if="message" class="text-xs font-medium text-rose-700" role="alert">{{ message }}</p>

      <div class="flex justify-end gap-2 pt-1">
        <button
          type="button"
          class="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="submit"
          class="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800"
        >
          保存
        </button>
      </div>
    </form>
  </div>
</template>
