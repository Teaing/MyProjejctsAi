import type {
  AuditEntry,
  AuthUser,
  CreateTaskPayload,
  MutationResponse,
  TreeSnapshot,
  UpdateTaskPayload,
} from '../types';

export const CLIENT_ID = crypto.randomUUID();

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  handleUnauthorized = true,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-client-id': CLIENT_ID,
      ...(init.headers ?? {}),
    },
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    if (response.status === 401 && handleUnauthorized) unauthorizedHandler?.();
    const message =
      (payload as { error?: { message?: string } } | null)?.error?.message ??
      `请求失败（${response.status}）`;
    throw new Error(message);
  }

  return payload as T;
}

export const api = {
  me: () => request<{ user: AuthUser }>('/api/auth/me', {}, false),

  login: (username: string, password: string) =>
    request<{ user: AuthUser }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ username, password }) },
      false,
    ),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }, false),

  getTree: () => request<TreeSnapshot>('/api/tree'),

  getAudit: (limit = 50) => request<{ items: AuditEntry[] }>(`/api/audit?limit=${limit}`),

  createTask: (payload: CreateTaskPayload) =>
    request<MutationResponse>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateTask: (id: string, payload: UpdateTaskPayload) =>
    request<MutationResponse>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  reorder: (parentId: string | null, orderedIds: string[]) =>
    request<MutationResponse>('/api/tasks/reorder', {
      method: 'POST',
      body: JSON.stringify({ parent_id: parentId, ordered_ids: orderedIds }),
    }),

  deleteTask: (id: string, cascade = true) =>
    request<MutationResponse>(`/api/tasks/${id}?cascade=${cascade}`, {
      method: 'DELETE',
    }),
};
