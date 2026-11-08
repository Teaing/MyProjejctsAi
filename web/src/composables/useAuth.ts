import { computed, ref } from 'vue';
import { api, setUnauthorizedHandler } from '../lib/api';
import type { AuthUser } from '../types';

const user = ref<AuthUser | null>(null);
const ready = ref(false);
const isAdmin = computed(() => user.value?.role === 'ADMIN');

let initialized = false;

setUnauthorizedHandler(() => {
  user.value = null;
});

export async function initAuth(): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    user.value = (await api.me()).user;
  } catch {
    user.value = null;
  } finally {
    ready.value = true;
  }
}

export function useAuth() {
  async function login(username: string, password: string): Promise<void> {
    user.value = (await api.login(username, password)).user;
  }

  async function logout(): Promise<void> {
    try {
      await api.logout();
    } finally {
      user.value = null;
    }
  }

  return { user, ready, isAdmin, login, logout };
}
