import { onBeforeUnmount, watch } from 'vue';
import { CLIENT_ID } from '../lib/api';
import type { SystemNode, TreeSnapshot } from '../types';
import { useAuth } from './useAuth';
import { useProjectStore } from './useProjectStore';

interface LiveMessage {
  type: 'snapshot' | 'tree.updated';
  version: number;
  systems: SystemNode[];
  actor?: string;
  reason?: string;
  origin?: string;
}

export function useLiveSync(): void {
  const { user } = useAuth();
  const { connected, applyTree, pushLiveLog, load, reset } = useProjectStore();

  let socket: WebSocket | null = null;
  let retryTimer: number | undefined;
  let attempts = 0;
  let stopped = true;

  const connect = (): void => {
    if (stopped) return;

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${protocol}://${location.host}/ws?clientId=${CLIENT_ID}`);

    socket.onopen = () => {
      attempts = 0;
      connected.value = true;
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as LiveMessage;
        if (message.type === 'snapshot') {
          applyTree(message as TreeSnapshot, true);
          return;
        }
        if (message.type === 'tree.updated') {
          applyTree(message as TreeSnapshot);
          pushLiveLog(message);
        }
      } catch {
        // 忽略无法解析的消息，连接继续保留
      }
    };

    socket.onclose = () => {
      socket = null;
      connected.value = false;
      if (stopped) return;
      const delay = Math.min(15_000, 500 * 2 ** attempts) + Math.random() * 300;
      attempts += 1;
      retryTimer = window.setTimeout(connect, delay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  };

  const start = (): void => {
    if (!stopped) return;
    stopped = false;
    attempts = 0;
    void load();
    connect();
  };

  const stop = (): void => {
    stopped = true;
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
    socket?.close();
    socket = null;
    connected.value = false;
    reset();
  };

  watch(
    user,
    (value) => {
      if (value) start();
      else stop();
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);
}
