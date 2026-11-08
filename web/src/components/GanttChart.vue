<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useProjectStore } from '../composables/useProjectStore';
import { scheduleWarning, todayRef, warningLabels } from '../lib/schedule';
import type { ScheduleWarning } from '../lib/schedule';
import { statusMeta } from '../lib/status';
import type { SystemNode, Task, TaskStatus } from '../types';

const props = defineProps<{ systems: SystemNode[]; treeOpen: boolean }>();
const emit = defineEmits<{ edit: [task: Task]; 'toggle-tree': [] }>();
const { isAdmin } = useAuth();
const { updateTask, beginDrag, endDrag } = useProjectStore();

const DAY = 86_400_000;

interface Draft {
  start_date: string;
  end_date: string;
}

interface DragState {
  id: string;
  name: string;
  mode: 'move' | 'left' | 'right';
  startX: number;
  pxPerDay: number;
  baseStart: number;
  baseEnd: number;
  moved: boolean;
}

const drafts = reactive<Record<string, Draft>>({});
const active = ref<DragState | null>(null);

function toMs(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function label(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCMonth() + 1}/${String(date.getUTCDate()).padStart(2, '0')}`;
}

function datesOf(item: { id: string; start_date: string; end_date: string }): Draft {
  return drafts[item.id] ?? { start_date: item.start_date, end_date: item.end_date };
}

const range = computed(() => {
  const dates: string[] = [];
  for (const system of props.systems) {
    dates.push(system.start_date, system.end_date);
    for (const task of system.tasks) {
      dates.push(task.start_date, task.end_date);
    }
  }

  const now = Date.now();
  const min = dates.length ? Math.min(...dates.map(toMs)) - 2 * DAY : now - 15 * DAY;
  const max = dates.length ? Math.max(...dates.map(toMs)) + 2 * DAY : now + 15 * DAY;
  const days = Math.max(1, Math.round((max - min) / DAY));
  const step = Math.max(1, Math.ceil(days / 5));

  const ticks: Array<{ label: string; left: number }> = [];
  for (let offset = 0; offset <= days; offset += step) {
    ticks.push({ label: label(min + offset * DAY), left: (offset / days) * 100 });
  }

  return { start: min, days, ticks };
});

function barStyle(start: string, end: string): Record<string, string> {
  const left = ((toMs(start) - range.value.start) / DAY / range.value.days) * 100;
  const width = (((toMs(end) - toMs(start)) / DAY + 1) / range.value.days) * 100;
  const safeLeft = Math.min(100, Math.max(0, left));
  return {
    left: `${safeLeft}%`,
    width: `${Math.max(1, Math.min(100 - safeLeft, width))}%`,
  };
}

function warningOf(item: {
  status: TaskStatus;
  start_date: string;
  end_date: string;
}): { key: ScheduleWarning; label: string } | null {
  const warning = scheduleWarning(item, todayRef.value);
  if (!warning) return null;
  return { key: warning, label: warningLabels[warning] };
}

const todayPosition = computed(() => {
  const position =
    ((toMs(todayRef.value) - range.value.start) / DAY / range.value.days) * 100;
  return position >= 0 && position <= 100 ? position : null;
});

const activeLabel = computed(() => {
  const state = active.value;
  if (!state) return '';
  const draft = drafts[state.id];
  return draft ? `调整中 · ${state.name}：${draft.start_date} ~ ${draft.end_date}` : '';
});

function startDateDrag(event: PointerEvent, item: Task, mode: 'move' | 'left' | 'right'): void {
  if (!isAdmin.value) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;

  const track = (event.currentTarget as HTMLElement).closest('.gantt-track');
  if (!(track instanceof HTMLElement)) return;

  event.preventDefault();
  event.stopPropagation();

  const rect = track.getBoundingClientRect();
  const base = datesOf(item);
  const state: DragState = {
    id: item.id,
    name: item.name,
    mode,
    startX: event.clientX,
    pxPerDay: Math.max(1, rect.width / range.value.days),
    baseStart: toMs(base.start_date),
    baseEnd: toMs(base.end_date),
    moved: false,
  };

  active.value = state;
  beginDrag();

  const onMove = (moveEvent: PointerEvent): void => {
    const deltaDays = Math.round((moveEvent.clientX - state.startX) / state.pxPerDay);
    let start = state.baseStart;
    let end = state.baseEnd;

    if (mode === 'move') {
      start += deltaDays * DAY;
      end += deltaDays * DAY;
    } else if (mode === 'left') {
      start = Math.min(state.baseStart + deltaDays * DAY, state.baseEnd);
    } else {
      end = Math.max(state.baseEnd + deltaDays * DAY, state.baseStart);
    }

    if (deltaDays !== 0) state.moved = true;
    drafts[item.id] = { start_date: fromMs(start), end_date: fromMs(end) };
  };

  const onUp = async (): Promise<void> => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    window.removeEventListener('blur', onUp);

    const draft = drafts[item.id];
    delete drafts[item.id];
    active.value = null;

    if (!draft || !state.moved) {
      endDrag();
      return;
    }

    await updateTask(item.id, draft);
    endDrag();
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('blur', onUp);
}
</script>

<template>
  <section
    class="flex-1 min-w-0 min-h-[70vh] bg-white p-5 rounded-3xl shadow-xs border border-slate-100 flex flex-col gap-4"
  >
    <div class="flex justify-between items-start gap-3">
      <div>
        <h2 class="text-sm font-bold text-slate-700 uppercase tracking-wider">
          甘特排期时间轴 (Gantt View)
        </h2>
        <p
          class="text-[11px] mt-1"
          :class="activeLabel ? 'text-blue-700 font-semibold' : 'text-slate-600'"
          aria-live="polite"
        >
          {{
            activeLabel ||
            (isAdmin ? '拖动任务条整体平移，拖两端调整起止日期' : '只读模式：可查看排期，不可调整')
          }}
        </p>
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <div class="hidden lg:flex flex-wrap justify-end text-[11px] text-slate-600 items-center gap-2">
          <span class="flex items-center gap-1"
            ><span class="status-swatch" data-status="NOT_STARTED"></span> 未开始</span
          >
          <span class="flex items-center gap-1"
            ><span class="status-swatch" data-status="IN_PROGRESS"></span> 实施中</span
          >
          <span class="flex items-center gap-1"
            ><span class="status-swatch" data-status="COMPLETED"></span> 已完成</span
          >
          <span class="flex items-center gap-1"
            ><span class="status-swatch" data-status="ABANDONED"></span> 已废弃</span
          >
          <span class="flex items-center gap-1"
            ><span class="status-swatch" data-warning="NOT_STARTED_OVERDUE"></span> 逾期未开始</span
          >
          <span class="flex items-center gap-1"
            ><span class="status-swatch" data-warning="IN_PROGRESS_OVERDUE"></span> 已超期</span
          >
        </div>
        <button
          class="text-[11px] px-2.5 py-1.5 rounded-xl border border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-all whitespace-nowrap"
          @click="emit('toggle-tree')"
        >
          {{ treeOpen ? '收起系统列表' : '展开系统列表' }}
        </button>
      </div>
    </div>

    <div class="flex-1 bg-slate-50/50 border border-slate-100 rounded-2xl p-4 flex flex-col gap-6 overflow-x-auto">
      <div class="relative min-w-[500px] flex flex-col gap-6">
        <div class="relative h-5 border-b border-slate-200">
          <span
            v-for="tick in range.ticks"
            :key="`${tick.label}-${tick.left}`"
            class="absolute -translate-x-1/2 text-[11px] font-bold text-slate-600 whitespace-nowrap"
            :style="{ left: `${tick.left}%` }"
          >
            {{ tick.label }}
          </span>
        </div>

        <div class="flex flex-col gap-5">
          <div v-for="sys in systems" :key="`gantt-${sys.id}`" class="flex flex-col gap-2">
            <div class="flex items-center justify-between text-xs font-semibold text-slate-700 gap-3">
              <div class="flex items-center gap-2 min-w-0">
                <span
                  v-if="sys.client"
                  class="text-[10px] bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded-md shrink-0"
                  :title="sys.client"
                >
                  {{ sys.client }}
                </span>
                <button
                  type="button"
                  class="truncate text-left"
                  :class="isAdmin ? 'cursor-pointer hover:text-slate-900' : 'cursor-default'"
                  :title="sys.name"
                  @click="isAdmin && emit('edit', sys)"
                >
                  {{ sys.name }}
                  <span v-if="sys.assignee" class="text-[10px] font-normal text-slate-500">
                    · {{ sys.assignee }}
                  </span>
                </button>
                <span class="status-chip text-[10px] px-1.5 py-0.5 shrink-0" :data-status="sys.status">
                  <span aria-hidden="true">{{ statusMeta[sys.status].symbol }}</span>
                  {{ statusMeta[sys.status].shortLabel }}
                </span>
                <span
                  v-if="warningOf(sys)"
                  class="warning-badge text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
                  :data-warning="warningOf(sys)?.key"
                >
                  {{ warningOf(sys)?.label }}
                </span>
              </div>
              <span class="text-[10px] text-slate-600 font-mono shrink-0">
                {{ datesOf(sys).start_date }} 至 {{ datesOf(sys).end_date }}
              </span>
            </div>

            <div class="gantt-track relative h-6 bg-slate-200/50 rounded-lg overflow-hidden">
              <div
                class="status-bar absolute top-1 h-4 rounded-md flex items-center px-2 text-[10px] font-medium text-white shadow-xs overflow-hidden select-none"
                :class="isAdmin ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'"
                :data-status="sys.status"
                :data-warning="warningOf(sys)?.key"
                :style="barStyle(datesOf(sys).start_date, datesOf(sys).end_date)"
                :title="sys.name"
                style="touch-action: none"
                @pointerdown="startDateDrag($event, sys, 'move')"
              >
                <span class="truncate">{{ sys.name }} ({{ sys.progress }}%)</span>
                <span
                  v-if="isAdmin"
                  class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                  @pointerdown.stop="startDateDrag($event, sys, 'left')"
                ></span>
                <span
                  v-if="isAdmin"
                  class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                  @pointerdown.stop="startDateDrag($event, sys, 'right')"
                ></span>
              </div>
            </div>

            <div
              v-for="task in sys.tasks"
              :key="`gantt-${task.id}`"
              class="pl-4 flex flex-col gap-1"
            >
              <div class="flex items-center justify-between text-[11px] text-slate-500 gap-3">
                <button
                  type="button"
                  class="truncate text-left"
                  :class="isAdmin ? 'cursor-pointer hover:text-slate-900' : 'cursor-default'"
                  :title="task.name"
                  @click="isAdmin && emit('edit', task)"
                >
                  ↳ {{ task.name }}
                  <span v-if="task.assignee" class="text-[10px] text-slate-500">
                    · {{ task.assignee }}
                  </span>
                </button>
                <span class="status-chip text-[10px] px-1.5 py-0.5 shrink-0" :data-status="task.status">
                  <span aria-hidden="true">{{ statusMeta[task.status].symbol }}</span>
                  {{ statusMeta[task.status].shortLabel }}
                </span>
                <span
                  v-if="warningOf(task)"
                  class="warning-badge text-[10px] px-1.5 py-0.5 rounded-md shrink-0"
                  :data-warning="warningOf(task)?.key"
                >
                  {{ warningOf(task)?.label }}
                </span>
                <span class="text-[10px] text-slate-600 font-mono shrink-0">
                  {{ datesOf(task).start_date }} ~ {{ datesOf(task).end_date }}
                </span>
              </div>
              <div class="gantt-track relative h-4 bg-slate-100 rounded-md overflow-hidden">
                <div
                  class="status-bar absolute top-0.5 h-3 rounded-xs select-none"
                  :class="isAdmin ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'"
                  :data-status="task.status"
                  :data-warning="warningOf(task)?.key"
                  :style="barStyle(datesOf(task).start_date, datesOf(task).end_date)"
                  :title="task.name"
                  style="touch-action: none"
                  @pointerdown="startDateDrag($event, task, 'move')"
                >
                  <span
                    v-if="isAdmin"
                    class="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                    @pointerdown.stop="startDateDrag($event, task, 'left')"
                  ></span>
                  <span
                    v-if="isAdmin"
                    class="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                    @pointerdown.stop="startDateDrag($event, task, 'right')"
                  ></span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="todayPosition !== null"
          class="today-marker pointer-events-none absolute inset-y-0 z-10 border-l-2 border-dashed"
          :style="{ left: `${todayPosition}%` }"
        >
          <span
            class="today-label absolute -top-1 -translate-x-1/2 rounded px-1.5 py-0.5 text-[10px] font-semibold"
          >
            今天
          </span>
        </div>

        <p v-if="systems.length === 0" class="text-xs text-slate-600 text-center py-10">
          当前筛选下暂无排期数据
        </p>
      </div>
    </div>
  </section>
</template>
