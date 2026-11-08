<script setup lang="ts">
import { statusMeta } from '../lib/status';
import type { AuthUser, Filter, TaskStatus } from '../types';

defineProps<{
  user: AuthUser;
  filter: Filter;
  counts: Record<Filter, number>;
  showHidden: boolean;
  hiddenCount: number;
  clients: string[];
  clientFilter: string;
  warningCount: number;
}>();

const emit = defineEmits<{
  'update:filter': [value: Filter];
  'update:showHidden': [value: boolean];
  'update:clientFilter': [value: string];
  'new-system': [];
  logout: [];
}>();

function onClientChange(event: Event): void {
  emit('update:clientFilter', (event.target as HTMLSelectElement).value);
}

const filters: Array<{ key: Filter; label: string; symbol: string }> = [
  { key: 'ALL', label: '全部', symbol: '≡' },
  ...(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ABANDONED'] as TaskStatus[]).map(
    (key) => ({ key, label: statusMeta[key].label, symbol: statusMeta[key].symbol }),
  ),
];
</script>

<template>
  <header
    class="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-5 rounded-3xl shadow-xs border border-slate-100 gap-4"
  >
    <div>
      <div class="flex items-center gap-2">
        <span class="w-3 h-3 rounded-full bg-blue-600 inline-block animate-pulse"></span>
        <h1 class="text-xl font-bold text-slate-800">项目管理 MCP 协同控制台</h1>
      </div>
      <p class="text-xs text-slate-600 mt-1">
        支持 Web 端可视化拖拽排期，并完美对齐 Agent MCP (Model Context Protocol) 规范
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
      <select
        :value="clientFilter"
        class="shrink-0 text-xs bg-white border border-slate-300 rounded-2xl px-3 py-2 text-slate-700"
        aria-label="按客户筛选"
        @change="onClientChange"
      >
        <option value="__ALL__">全部客户</option>
        <option v-for="client in clients" :key="client" :value="client">{{ client }}</option>
        <option value="__NONE__">未指定客户</option>
      </select>

      <span
        v-if="warningCount > 0"
        class="warning-badge shrink-0 text-[11px] px-2.5 py-2 rounded-2xl"
        data-warning="IN_PROGRESS_OVERDUE"
      >
        {{ warningCount }} 项逾期
      </span>

      <div class="bg-slate-100 p-1 rounded-2xl flex flex-wrap text-xs font-medium max-w-full">
        <button
          v-for="item in filters"
          :key="item.key"
          class="filter-tab px-2.5 sm:px-3 py-1.5 rounded-xl whitespace-nowrap transition-all hover:text-slate-900"
          :class="{ 'is-active': filter === item.key }"
          :data-status="item.key"
          :aria-pressed="filter === item.key"
          @click="emit('update:filter', item.key)"
        >
          <span aria-hidden="true">{{ item.symbol }}</span>
          {{ item.label }}
          <span class="ml-1 text-[10px] font-semibold">{{ counts[item.key] }}</span>
        </button>
      </div>

      <button
        v-if="hiddenCount > 0"
        class="flex items-center gap-1.5 text-xs px-3 py-2 rounded-2xl border transition-all"
        :aria-pressed="showHidden"
        :class="
          showHidden
            ? 'bg-slate-900 text-white border-slate-900'
            : 'bg-white text-slate-600 border-slate-300 hover:text-slate-900'
        "
        @click="emit('update:showHidden', !showHidden)"
      >
        {{ showHidden ? '隐藏项已显示' : '显示隐藏项' }}
        <span class="text-[10px] font-semibold">{{ hiddenCount }}</span>
      </button>

      <div class="flex items-center gap-2 ml-auto">
        <span class="text-[11px] text-slate-700 bg-slate-100 px-2.5 py-2 rounded-2xl whitespace-nowrap">
          {{ user.username }} · {{ user.role === 'ADMIN' ? '管理员' : '只读' }}
        </span>
        <button
          class="text-xs px-2.5 py-2 rounded-2xl border border-slate-300 text-slate-600 hover:text-slate-900 hover:border-slate-400 transition-all"
          @click="emit('logout')"
        >
          退出
        </button>
        <button
          v-if="user.role === 'ADMIN'"
          class="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-2xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5"
          @click="emit('new-system')"
        >
          <span>+ 新建系统/任务</span>
        </button>
      </div>
    </div>
  </header>
</template>
