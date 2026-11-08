import type { TaskStatus } from '../types';

export interface StatusMeta {
  label: string;
  shortLabel: string;
  symbol: string;
}

export const statusMeta: Record<TaskStatus, StatusMeta> = {
  NOT_STARTED: { label: '未开始', shortLabel: '未开始', symbol: '○' },
  IN_PROGRESS: { label: '实施中', shortLabel: '实施', symbol: '▶' },
  COMPLETED: { label: '已完成', shortLabel: '完成', symbol: '✓' },
  ABANDONED: { label: '已废弃', shortLabel: '废弃', symbol: '—' },
};
