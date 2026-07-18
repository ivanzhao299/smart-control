<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Lock, Globe, Wifi, CheckCircle2, XCircle, Trash2, History, Loader } from 'lucide-vue-next';
import { useClientAuthStore } from '@/stores/client-auth';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useToastStore } from '@/stores/toast';
import { getServerHistory, addServerHistory, removeServerHistory } from '@/services/server-history';

const router = useRouter();
const route = useRoute();
const auth = useClientAuthStore();
const brandingStore = useSystemBrandingStore();
const toast = useToastStore();

// 显示裸 origin (http://x.x.x.x:3200), 跟 placeholder 的格式一致; baseURL 自带
// 的 /api 后缀是内部实现, 让业主看见只会以为要连它一起敲。setApiBaseURL 会自动补回。
const serverInput = ref<string>(originOf(auth.baseURL));
const password = ref('');
const passwordInput = ref<HTMLInputElement | null>(null);
const submitting = ref(false);

interface TestResult {
  state: 'idle' | 'testing' | 'ok' | 'fail';
  message?: string;
}
const test = ref<TestResult>({ state: 'idle' });
const history = ref<string[]>([]);
/** 本地存过密码, 正在悄悄试自动登录 —— 这段时间不露登录表单, 免得先闪一下密码框
    再跳走, 业主会以为自己又要手动登一次 */
const autoLoggingIn = ref(false);

onMounted(async () => {
  void brandingStore.load();
  history.value = getServerHistory();
  // 已经登录就跳走
  if (auth.isAuthed) {
    redirectToTarget();
    return;
  }
  // token 是 30 天 TTL 没错, 但 backend 常年跟着部署重启, session 表在内存里,
  // 重启就清空, token 没到期也会失效 —— 存过密码的话先悄悄试一次自动登录,
  // 不用每次部署完业主都要摸出手机重新输密码。
  autoLoggingIn.value = true;
  const ok = await auth.tryAutoLogin();
  autoLoggingIn.value = false;
  if (ok) {
    toast.success('已自动登录');
    redirectToTarget();
    return;
  }
  setTimeout(() => passwordInput.value?.focus(), 50);
});

/** baseURL 带 /api 后缀, 显示/存历史用裸 origin */
function originOf(base: string): string {
  return base.replace(/\/api(\/.*)?$/, '');
}

function useHistoryEntry(url: string): void {
  serverInput.value = url;
  void doTest();
}

function deleteHistoryEntry(url: string): void {
  removeServerHistory(url);
  history.value = getServerHistory();
}

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
    addServerHistory(originOf(auth.baseURL));
    history.value = getServerHistory();
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
    addServerHistory(originOf(auth.baseURL));
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

      <!-- 本地存过密码, 悄悄自动登录中 — 不闪一下登录表单再跳走 -->
      <div v-if="autoLoggingIn" class="auto-login-box">
        <Loader :size="22" :stroke-width="2" class="auto-login-spin" />
        <span>自动登录中…</span>
      </div>

      <form v-else class="form" @submit.prevent="doLogin">
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

        <!-- 连接历史 — 连过的服务器点一下即测, 可删 -->
        <div v-if="history.length" class="history-box">
          <div class="history-title">
            <History :size="12" :stroke-width="2" />
            连接过的服务器
          </div>
          <div v-for="h in history" :key="h" class="history-row">
            <button type="button" class="history-url" @click="useHistoryEntry(h)">{{ h }}</button>
            <button type="button" class="history-del" title="删除" @click="deleteHistoryEntry(h)">
              <Trash2 :size="13" :stroke-width="2" />
            </button>
          </div>
        </div>

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
  /* 四边都让开安全区 —— index.html 开了 viewport-fit=cover +
     apple-mobile-web-app-status-bar-style=black-translucent, 意思是"内容铺满整块屏,
     安全区你自己让"。漏一边就被压一边:
     2026-07-17 业主报"手机端登录页面上端与手机时间相互遮盖" —— 就是漏了 top。
     用 max(24px, env(...)) 而不是相加: 没有刘海的设备 env 是 0, 相加会让内边距缩水。 */
  padding:
    max(24px, env(safe-area-inset-top))
    max(24px, env(safe-area-inset-right))
    max(24px, env(safe-area-inset-bottom))
    max(24px, env(safe-area-inset-left));
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
  backdrop-filter: blur(8px);
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

.auto-login-box {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  padding: 32px 0;
  color: var(--v2-text-2);
  font-size: 14px;
}
.auto-login-spin { animation: auto-login-spin 1s linear infinite; }
@keyframes auto-login-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

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

.history-box { margin-top: -2px; }
.history-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--v2-text-3);
  margin-bottom: 4px;
  padding: 0 2px;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 0;
}
.history-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.045);
  color: var(--v2-text-2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.history-url:hover { background: rgba(0, 229, 255, 0.1); color: var(--v2-text-1); }
.history-del {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--v2-text-3);
  cursor: pointer;
}
.history-del:hover { background: rgba(255, 71, 87, 0.14); color: #FCA5A5; }

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
