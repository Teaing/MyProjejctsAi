<script setup lang="ts">
import { ref } from 'vue';
import { useAuth } from '../composables/useAuth';

const { login } = useAuth();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const showPassword = ref(false);

function clearError(): void {
  if (error.value) error.value = '';
}

async function submit(): Promise<void> {
  if (loading.value) return;
  error.value = '';

  if (!username.value.trim() || !password.value) {
    error.value = '请输入用户名和密码';
    return;
  }

  loading.value = true;
  try {
    await login(username.value.trim(), password.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="min-h-screen flex items-start lg:items-center justify-center p-4 sm:p-6">
    <section
      class="w-full max-w-4xl overflow-hidden bg-white rounded-3xl border border-slate-200 shadow-xl grid lg:grid-cols-[1.05fr_0.95fr]"
      aria-labelledby="login-title"
    >
      <div class="relative overflow-hidden bg-slate-900 text-white p-7 sm:p-10 flex flex-col justify-between gap-10">
        <div
          class="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl"
          aria-hidden="true"
        ></div>

        <div class="relative">
          <div class="flex items-center gap-2.5">
            <span class="w-3 h-3 rounded-full bg-blue-500 inline-block"></span>
            <span class="text-xs font-bold tracking-wider text-slate-200 uppercase">
              Project Management · MCP
            </span>
          </div>

          <h1 class="mt-7 text-2xl sm:text-3xl font-bold tracking-tight text-white">
            项目管理 MCP 协同控制台
          </h1>
          <p class="mt-3 max-w-md text-sm leading-6 text-slate-300">
            在一个工作台中查看应用系统、实施任务与关键时间节点，让 Web 操作和 Agent
            协作保持同步。
          </p>

          <div class="hidden lg:grid mt-8 gap-3" aria-label="控制台能力">
            <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300 font-bold" aria-hidden="true">01</span>
              <div>
                <p class="text-xs font-semibold text-slate-100">统一排期视图</p>
                <p class="mt-0.5 text-[11px] text-slate-400">系统、任务和甘特时间轴保持一致</p>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 font-bold" aria-hidden="true">02</span>
              <div>
                <p class="text-xs font-semibold text-slate-100">实时协同同步</p>
                <p class="mt-0.5 text-[11px] text-slate-400">Web、MCP 与服务端状态实时更新</p>
              </div>
            </div>
            <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <span class="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300 font-bold" aria-hidden="true">03</span>
              <div>
                <p class="text-xs font-semibold text-slate-100">分级访问权限</p>
                <p class="mt-0.5 text-[11px] text-slate-400">管理员可维护排期，只读用户安全查看</p>
              </div>
            </div>
          </div>
        </div>

        <div class="relative flex items-center gap-2 text-[11px] text-slate-300">
          <span class="h-2 w-2 rounded-full bg-emerald-400" aria-hidden="true"></span>
          安全会话已启用 · 登录后连接实时项目数据
        </div>
      </div>

      <form
        class="p-7 sm:p-10 flex flex-col justify-center"
        :aria-busy="loading"
        @submit.prevent="submit"
      >
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-blue-700">欢迎回来</p>
          <h2 id="login-title" class="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            登录控制台
          </h2>
          <p class="mt-2 text-sm leading-6 text-slate-600">
            使用管理员分配的账号继续访问项目排期。
          </p>
        </div>

        <div class="mt-7 flex flex-col gap-4">
          <div class="flex flex-col gap-1.5">
            <label for="login-username" class="text-xs font-semibold text-slate-700">用户名</label>
            <input
              id="login-username"
              v-model="username"
              type="text"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              autofocus
              maxlength="50"
              placeholder="请输入用户名"
              class="rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-700"
              :aria-invalid="Boolean(error)"
              :aria-describedby="error ? 'login-error' : undefined"
              @input="clearError"
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <label for="login-password" class="text-xs font-semibold text-slate-700">密码</label>
            <span class="relative">
              <input
                id="login-password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                maxlength="200"
                placeholder="请输入密码"
                class="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 pr-16 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-700"
                :aria-invalid="Boolean(error)"
                :aria-describedby="error ? 'login-error' : undefined"
                @input="clearError"
              />
              <button
                type="button"
                class="absolute inset-y-1 right-1 rounded-lg px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </span>
          </div>

          <p
            v-if="error"
            id="login-error"
            class="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-700"
            role="alert"
          >
            <span aria-hidden="true">!</span>
            <span>{{ error }}</span>
          </p>

          <button
            type="submit"
            :disabled="loading"
            class="mt-1 flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:cursor-wait disabled:opacity-70 text-white px-4 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-all"
          >
            <span
              v-if="loading"
              class="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
              aria-hidden="true"
            ></span>
            {{ loading ? '正在验证…' : '登录' }}
            <span v-if="!loading" aria-hidden="true">→</span>
          </button>
        </div>

        <div class="mt-6 border-t border-slate-200 pt-5 text-[11px] leading-5 text-slate-600">
          账号由管理员统一创建。登录状态会按安全策略定期失效，请勿在公共设备上保留会话。
        </div>
      </form>
    </section>
  </main>
</template>
