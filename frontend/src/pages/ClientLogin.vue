<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Lock, Globe, Wifi, CheckCircle2, XCircle } from 'lucide-vue-next';
import { useClientAuthStore } from '@/stores/client-auth';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useToastStore } from '@/stores/toast';

const router = useRouter();
const route = useRoute();
const auth = useClientAuthStore();
const brandingStore = useSystemBrandingStore();
const toast = useToastStore();

const serverInput = ref<string>(auth.baseURL);
const password = ref('');
const passwordInput = ref<HTMLInputElement | null>(null);
const submitting = ref(false);

interface TestResult {
  state: 'idle' | 'testing' | 'ok' | 'fail';
  message?: string;
}
const test = ref<TestResult>({ state: 'idle' });

onMounted(() => {
  void brandingStore.load();
  // 已经登录就跳走
  if (auth.isAuthed) {
    redirectToTarget();
    return;
  }
  setTimeout(() => passwordInput.value?.focus(), 50);
});

function redirectToTarget(): void {
  const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
    ? route.query.redirect
    : '/';
  router.replace(target);
}

async function doTest(): Promise<void> {
  if (!serverInput.value.trim()) {
    test.value = { state: 'fail', message: '请先输入服务器地址' };
    return;
  }
  test.value = { state: 'testing' };
  auth.setBaseURL(serverInput.value);
  const result = await auth.testConnection();
  if (result.ok) {
    test.value = { state: 'ok', message: `连接成功 · ${result.serverTime?.slice(11, 19) ?? ''}` };
  } else {
    test.value = { state: 'fail', message: result.error ?? '无法连接' };
  }
}

async function doLogin(): Promise<void> {
  if (!password.value) {
    toast.warning('请输入密码');
    return;
  }
  // 先把 baseURL 写进去 (业主可能改了地址但没按测试)
  auth.setBaseURL(serverInput.value);
  submitting.value = true;
  try {
    await auth.login(password.value);
    toast.success('登录成功');
    redirectToTarget();
  } catch (e) {
    toast.error((e as Error).message || '登录失败');
    password.value = '';
    setTimeout(() => passwordInput.value?.focus(), 50);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="client-login">
    <div class="login-bg"></div>
    <div class="login-card">
      <div class="brand">
        <div class="brand-logo">
          <img v-if="brandingStore.branding.logoUrl" :src="brandingStore.branding.logoUrl" alt="logo" />
          <template v-else>{{ brandingStore.branding.logoText }}</template>
        </div>
        <div class="brand-text">
          <div class="brand-title">{{ brandingStore.branding.systemName }}</div>
          <div class="brand-sub">请输入访问密码</div>
        </div>
      </div>

      <form class="form" @submit.prevent="doLogin">
        <!-- 服务器地址 -->
        <div class="server-row">
          <div class="field server-field">
            <Globe :size="16" :stroke-width="1.8" class="field-icon" />
            <input
              v-model="serverInput"
              type="text"
              class="field-input"
              placeholder="服务器地址 (e.g. http://192.168.124.11:3200)"
              autocomplete="url"
              inputmode="url"
              spellcheck="false"
              autocapitalize="off"
            />
          </div>
          <button
            type="button"
            class="test-btn"
            :class="{
              'state-testing': test.state === 'testing',
              'state-ok': test.state === 'ok',
              'state-fail': test.state === 'fail',
            }"
            :disabled="test.state === 'testing'"
            @click="doTest"
            title="测试连接"
          >
            <Wifi v-if="test.state === 'idle' || test.state === 'testing'" :size="16" :stroke-width="2" />
            <CheckCircle2 v-else-if="test.state === 'ok'" :size="16" :stroke-width="2" />
            <XCircle v-else :size="16" :stroke-width="2" />
            <span>{{
              test.state === 'idle' ? '测试' :
              test.state === 'testing' ? '测试中' :
              test.state === 'ok' ? '已连接' :
              '失败'
            }}</span>
          </button>
        </div>
        <div v-if="test.state !== 'idle'" class="test-msg" :class="`is-${test.state}`">{{ test.message }}</div>

        <!-- 密码 -->
        <div class="field">
          <Lock :size="16" :stroke-width="1.8" class="field-icon" />
          <input
            ref="passwordInput"
            v-model="password"
            type="password"
            class="field-input"
            placeholder="访问密码"
            autocomplete="current-password"
            :disabled="submitting"
          />
        </div>

        <button type="submit" class="submit-btn" :disabled="submitting || !password">
          {{ submitting ? '登录中...' : '登 录' }}
        </button>

        <div class="footer-hint">
          首次使用 · 默认密码 <code>1234</code> · 登录后可在后台修改
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.client-login {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--v2-bg-0);
  isolation: isolate;
  overflow: hidden;
}
.login-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 30% 20%, rgba(0, 229, 255, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 80% 80%, rgba(168, 85, 247, 0.13) 0%, transparent 55%),
    linear-gradient(180deg, var(--v2-bg-0) 0%, var(--v2-bg-1) 100%);
  z-index: 0;
  animation: none;
}

.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 460px;
  padding: 36px 32px 28px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  box-shadow: var(--v2-elev-3);
  backdrop-filter: blur(20px);
}
.login-card::before {
  content: '';
  position: absolute;
  top: 0; left: 10%; right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-primary) 50%, transparent);
  box-shadow: 0 0 8px var(--v2-primary);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 24px;
}
.brand-logo {
  width: 48px; height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-purple) 100%);
  display: grid; place-items: center;
  color: white;
  font-weight: 700;
  font-size: 20px;
  box-shadow: 0 6px 18px -4px rgba(0, 229, 255, 0.55);
  overflow: hidden;
  flex-shrink: 0;
}
.brand-logo img { width: 100%; height: 100%; object-fit: cover; }
.brand-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--v2-text-1);
}
.brand-sub {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-top: 4px;
}

.form { display: flex; flex-direction: column; gap: 12px; }

.server-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}
.field {
  position: relative;
  display: flex;
  align-items: center;
}
.field-icon {
  position: absolute;
  left: 14px;
  color: var(--v2-text-3);
  pointer-events: none;
}
.field-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--v2-border-soft);
  border-radius: 10px;
  padding: 12px 14px 12px 40px;
  color: var(--v2-text-1);
  font-size: 14px;
  outline: none;
  transition: border-color 0.18s, box-shadow 0.18s;
  width: 100%;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: var(--v2-primary);
  box-shadow: 0 0 0 3px rgba(0, 229, 255, 0.18);
}
.field-input::placeholder { color: var(--v2-text-3); }

.server-field .field-input { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 13px; }

.test-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}
.test-btn:hover:not(:disabled) {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
  border-color: var(--v2-primary);
}
.test-btn.state-ok {
  color: #6EE7B7;
  border-color: rgba(0, 231, 138, 0.45);
  background: rgba(0, 231, 138, 0.10);
}
.test-btn.state-fail {
  color: #FCA5A5;
  border-color: rgba(255, 71, 87, 0.45);
  background: rgba(255, 71, 87, 0.10);
}
.test-btn.state-testing { opacity: 0.7; }

.test-msg {
  font-size: 11px;
  padding: 0 4px;
  margin-top: -4px;
}
.test-msg.is-ok { color: #6EE7B7; }
.test-msg.is-fail { color: #FCA5A5; }
.test-msg.is-testing { color: var(--v2-text-3); }

.submit-btn {
  margin-top: 6px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-primary-dark) 100%);
  color: white;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.4em;
  cursor: pointer;
  box-shadow: var(--v2-glow-primary);
  transition: filter 0.18s;
}
.submit-btn:hover:not(:disabled) {
  filter: brightness(1.1);
  box-shadow: var(--v2-glow-primary-strong);
}
.submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.footer-hint {
  margin-top: 10px;
  font-size: 11px;
  color: var(--v2-text-3);
  text-align: center;
  line-height: 1.6;
}
.footer-hint code {
  background: rgba(0, 229, 255, 0.15);
  color: #67E8F9;
  padding: 1px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

@media (max-width: 480px) {
  .login-card { padding: 28px 20px 24px; }
  .brand { margin-bottom: 18px; gap: 10px; }
  .brand-logo { width: 40px; height: 40px; font-size: 17px; }
  .brand-title { font-size: 15px; }
  .server-row { grid-template-columns: 1fr; gap: 8px; }
  .test-btn { justify-content: center; }
}
</style>
