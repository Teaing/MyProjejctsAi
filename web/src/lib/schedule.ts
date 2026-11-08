import { ref } from 'vue';
import type { TaskStatus } from '../types';

export type ScheduleWarning = 'NOT_STARTED_OVERDUE' | 'IN_PROGRESS_OVERDUE';

export function todayString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 页面长时间打开时，跨天后逾期提示与「今天」线需要自动更新。
export const todayRef = ref(todayString());

setInterval(() => {
  const current = todayString();
  if (current !== todayRef.value) todayRef.value = current;
}, 60_000);

export function scheduleWarning(
  item: { status: TaskStatus; start_date: string; end_date: string },
  today = todayString(),
): ScheduleWarning | null {
  if (item.status === 'NOT_STARTED' && item.start_date < today) {
    return 'NOT_STARTED_OVERDUE';
  }
  if (item.status === 'IN_PROGRESS' && item.end_date < today) {
    return 'IN_PROGRESS_OVERDUE';
  }
  return null;
}

export const warningLabels: Record<ScheduleWarning, string> = {
  NOT_STARTED_OVERDUE: '逾期未开始',
  IN_PROGRESS_OVERDUE: '已超期',
};

