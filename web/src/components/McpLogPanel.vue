<script setup lang="ts">
import type { AuditEntry } from '../types';

defineProps<{
  logs: AuditEntry[];
  connected: boolean;
  version: number;
}>();

function formatTime(value: string): string {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function actorLabel(actor: string): string {
  if (actor === 'mcp') return 'MCP';
  if (actor === 'web') return 'WEB';
  if (actor === 'rest') return 'API';
  return actor.toUpperCase();
}
</script>

<template>
  <footer class="bg-slate-900 text-slate-200 p-4 rounded-3xl shadow-lg flex flex-col gap-2 text-xs font-mono">
    <div class="flex items-center justify-between border-b border-slate-800 pb-2 gap-3">
      <div class="flex items-center gap-2">
        <span
          class="w-2 h-2 rounded-full"
          :class="connected ? 'bg-cyan-400' : 'bg-rose-400'"
        ></span>
        <span class="font-bold tracking-wide text-slate-100">MCP Server &amp; Agent 动态通信日志</span>
      </div>
      <span class="text-[10px] text-slate-400 shrink-0">
        {{ connected ? '已连接' : '重连中' }} · tree v{{ version }}
      </span>
    </div>

    <div class="max-h-24 overflow-y-auto flex flex-col gap-1 text-slate-400 text-[11px]">
      <div v-for="log in logs" :key="log.id" class="flex gap-2">
        <span class="text-cyan-400 shrink-0">[{{ formatTime(log.created_at) }}]</span>
        <span class="text-slate-500 shrink-0">{{ actorLabel(log.actor) }}</span>
        <span class="text-slate-300">{{ log.summary }}</span>
      </div>
      <p v-if="logs.length === 0" class="text-slate-500">暂无通信记录</p>
    </div>
  </footer>
</template>
