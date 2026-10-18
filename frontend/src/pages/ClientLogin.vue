<script setup lang="ts">
import { ref, onMounted, nextTick, onBeforeUnmount, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { Lock, UserRound, ScanFace } from 'lucide-vue-next';
import { readSavedUsername, useClientAuthStore } from '@/stores/client-auth';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useToastStore } from '@/stores/toast';
import { addServerHistory } from '@/services/server-history';
import { shellBioRead, shellBioSave, shellBioClear, shellBioLogin, type ShellBioState } from '@/composables/useShellBio';
import { HttpError } from '@/services/http';
import { normalizeClientRedirect } from '@/services/client-login-journey';

const router = useRouter();
const route = useRoute();
const auth = useClientAuthStore();
const brandingStore = useSystemBrandingStore();
const toast = useToastStore();

const username = ref(readSavedUsername());
const password = ref('');
const passwordInput = ref<HTMLInputElement | null>(null);
const submitting = ref(false);
// 登录限流保护：弱网重复提交触发 429/503 时进入倒计时，避免反复重试把自己锁更久。
const cooldownUntil = ref(0);
const nowTick = ref(Date.now());
let clockTimer: number | undefined;
const cooldownSec = computed(() =>
  Math.max(0, Math.ceil((cooldownUntil.value - nowTick.value) / 1000)),
);
const inCooldown = computed(() => cooldownSec.value > 0);
function startClock(): void {
  if (clockTimer !== undefined) return;
  clockTimer = window.setInterval(() => {
    nowTick.value = Date.now();
    if (cooldownUntil.value <= Date.now() && clockTimer !== undefined) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  }, 250);
}
function beginCooldown(sec: number): void {
  cooldownUntil.value = Math.max(cooldownUntil.value, Date.now() + sec * 1000);
  startClock();
}
onBeforeUnmount(() => {
  if (clockTimer !== undefined) clearInterval(clockTimer);
});

function focusPasswordIfIdle(): void {
  void nextTick(() => {
    // Do not steal focus from the username field if the user has started editing.
    if (document.activeElement === document.body) passwordInput.value?.focus();
  });
}

// ============ 面容登录 (2026-07-31, 仅壳 App 内) ============
// 壳 (Android/iOS v1.1.9+) 注入 window.JinhuShell 桥: 密码存在壳的加密存储
// (Keystore/Keychain), 清除页面缓存也不丢; 点"面容登录"→ 壳弹系统面容验证
// → 通过后回调注回密码自动登录。桥交互统一走 useShellBio (v1.1.10 双槽位)。
const shellBio = ref<ShellBioState | null>(null);

function readShellBio(): void {
  shellBio.value = shellBioRead('client');
}

function faceLogin(): void {
  if (!username.value.trim()) {
    toast.warning('请先填写用户名，再使用面容登录；旧版面容只保存了密码');
    return;
  }
  shellBioLogin('client', (pwd) => {
    password.value = pwd;
    void doLogin(true);
  }, () => {
    toast.warning('面容验证未通过, 可重试或输入密码登录');
  });
}

/** 登录成功后把密码同步进壳加密存储 (密码改过也随手更新), 失败静默 */
function syncPasswordToShell(pwd: string): void {
  if (shellBio.value?.available) {
    shellBioSave('client', pwd);
    readShellBio();
  }
}

onMounted(async () => {
  void brandingStore.load();
  readShellBio();
  // 已经登录就跳走；但 ?logout=1 表示是用户主动点"退出登录"后跳到这里的——
  // 此刻 token 尚未清除（先导航、后清 token，避免受保护页被无 token 重挂重发请求弹 401），
  // 不能把用户再弹回受控页，否则退出失败提示会复现。
  if (auth.isAuthed && route.query.logout !== '1') {
    redirectToTarget();
    return;
  }
  focusPasswordIfIdle();
});

function redirectToTarget(): void {
  router.replace(normalizeClientRedirect(route.query.redirect));
}

async function doLogin(fromBiometric = false): Promise<void> {
  if (inCooldown.value) return;
  if (!username.value.trim()) {
    toast.warning('请输入用户管理中的用户名');
    return;
  }
  if (!password.value) {
    toast.warning('请输入密码');
    return;
  }
  // 登录页不再展示服务器配置，直接使用启动时按页面来源确定的 baseURL。
  submitting.value = true;
  try {
    await auth.login(username.value, password.value);
    // 首页不展示连接历史，但继续为登录后的服务器设置弹窗记录当前地址。
    addServerHistory(auth.baseURL.replace(/\/api(\/.*)?$/, ''));
    syncPasswordToShell(password.value);
    toast.success('登录成功');
    redirectToTarget();
  } catch (e) {
    if (e instanceof HttpError && (e.status === 429 || e.status === 503)) {
      // 触发限流/网关繁忙：解析后端给出的等待秒数，否则按状态退避；
      // 保留密码并倒计时，期间禁止重复提交，避免越重试锁得越久。
      const parsed = parseInt(String(e.message).match(/(\d+)\s*s/)?.[1] ?? '', 10);
      const backoff = Number.isFinite(parsed) ? parsed : e.status === 429 ? 30 : 15;
      beginCooldown(backoff);
      toast.error('登录请求过于频繁，已进入短暂保护，请按页面倒计时等待');
    } else if (fromBiometric && e instanceof HttpError && e.status === 401) {
      shellBioClear('client');
      readShellBio();
      auth.clearSavedPassword();
      toast.error('已保存的面容登录密码已失效，请输入新密码重新登录');
      password.value = '';
    } else {
      toast.error((e as Error).message || '登录失败');
      password.value = '';
    }
    focusPasswordIfIdle();
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
        <div class="brand-logo" :class="{ 'has-img': brandingStore.branding.logoUrl }">
          <img v-if="brandingStore.branding.logoUrl" :src="brandingStore.branding.logoUrl" alt="logo" />
          <template v-else>{{ brandingStore.branding.logoText }}</template>
        </div>
        <div class="brand-text">
          <div class="brand-title">{{ brandingStore.branding.systemName }}</div>
          <div class="brand-sub">请输入用户名和密码</div>
        </div>
      </div>

      <form class="form" @submit.prevent="doLogin(false)">
        <p v-if="route.query.reason === 'account-required'" role="status">
          当前保存的是旧版访问会话，尚未绑定用户。请使用用户管理中的用户名和密码登录，管理员账户即可控制设备。
        </p>
        <!-- 用户管理中配置的实名账户；旧版密码必须先绑定用户名 -->
        <div class="field">
          <UserRound :size="16" :stroke-width="1.8" class="field-icon" />
          <input
            v-model="username"
            type="text"
            class="field-input"
            placeholder="用户名"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            :disabled="submitting"
          />
        </div>

        <!-- 密码 -->
        <div class="field">
          <Lock :size="16" :stroke-width="1.8" class="field-icon" />
          <input
            ref="passwordInput"
            v-model="password"
            type="password"
            class="field-input"
            placeholder="密码"
            autocomplete="current-password"
            :disabled="submitting"
          />
        </div>

        <p v-if="inCooldown" role="status" class="cooldown-msg">
          网络繁忙触发保护，{{ cooldownSec }} 秒后可重新登录（弱网下属正常保护，无需关闭页面）
        </p>

        <!-- 登录页不经过 MainLayout（toast 唯一渲染处在主布局），需在此就地渲染，
             否则密码错误等 toast 虽触发、页面无任何提示 -->
        <transition name="login-toast-fade">
          <div v-if="toast.current" role="alert" class="login-toast" :class="`is-${toast.current.type}`">
            {{ toast.current.text }}
          </div>
        </transition>

        <button type="submit" class="submit-btn" :disabled="submitting || inCooldown || !password">
          {{ inCooldown ? `请等待 ${cooldownSec}s` : submitting ? '登录中...' : '登 录' }}
        </button>

        <!-- 面容登录 (2026-07-31): 壳 App 内且壳里存过密码才显示 -->
        <button
          v-if="shellBio?.saved"
          type="button"
          class="bio-btn"
          :disabled="submitting"
          @click="faceLogin"
        >
          <ScanFace :size="18" :stroke-width="1.8" />
          面容 / 指纹登录
        </button>

<!-- 2026-07-30 业主: 系统已开公网访问, 默认密码提示删除 (安全 + 已提供后台改密入口) -->
      </form>
    </div>
  </div>
</template>

<style scoped>
.client-login {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: safe center;
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
  overflow-x: hidden;
  overflow-y: auto;
}
.login-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 30% 20%, rgba(76, 154, 255, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 80% 80%, rgba(255, 255, 255, 0.08) 0%, transparent 55%),
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
  background: var(--v2-accent-fill);
  display: grid; place-items: center;
  color: white;
  font-weight: 700;
  font-size: 20px;
  box-shadow: 0 6px 18px -4px rgba(76, 154, 255, 0.55);
  overflow: hidden;
  flex-shrink: 0;
}
/* 有自定义 logo 图时去掉写死的蓝渐变底与光晕, 图完整显示 */
.brand-logo.has-img {
  background: transparent;
  box-shadow: none;
}
.brand-logo img { width: 100%; height: 100%; object-fit: contain; }
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
  background: var(--v2-inset-bg);
  border: 1px solid var(--v2-border-soft);
  border-radius: 10px;
  padding: 12px 14px 12px 40px;
  color: var(--v2-text-1);
  /* 2026-10-17 第四轮：输入框 >=16px，避免 iOS 聚焦自动缩放（与输入法加固同批）。 */
  font-size: 16px;
  outline: none;
  transition: border-color 0.18s, box-shadow 0.18s;
  width: 100%;
  box-sizing: border-box;
}
.field-input:focus {
  border-color: var(--v2-primary);
  box-shadow: 0 0 0 3px rgba(76, 154, 255, 0.18);
}
.field-input::placeholder { color: var(--v2-text-3); }

.submit-btn {
  margin-top: 6px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: var(--v2-accent-fill);
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
.cooldown-msg { font-size: 12px; color: #fbbf24; text-align: center; margin: 4px 0 0; line-height: 1.5; }

/* 登录页就地 toast（密码错误 / 登录成功等） */
.login-toast {
  font-size: 12.5px;
  line-height: 1.5;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.login-toast.is-error   { color: #fca5a5; background: rgba(229, 100, 93, 0.12); border-color: rgba(229, 100, 93, 0.35); }
.login-toast.is-success { color: #6ee7b7; background: rgba(63, 191, 135, 0.12); border-color: rgba(63, 191, 135, 0.35); }
.login-toast.is-warning { color: #fcd34d; background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.35); }
.login-toast.is-info    { color: #93c5fd; background: rgba(76, 154, 255, 0.12); border-color: rgba(76, 154, 255, 0.35); }
.login-toast-fade-enter-active, .login-toast-fade-leave-active { transition: opacity 0.2s ease; }
.login-toast-fade-enter-from, .login-toast-fade-leave-to { opacity: 0; }

/* 面容登录 — 次级按钮, 只在壳 App 内且壳里存过密码时出现 */
.bio-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 11px 16px;
  border-radius: 10px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-ov-1);
  color: var(--v2-text-1);
  font-size: 14px;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s;
}
.bio-btn:hover:not(:disabled) {
  background: var(--v2-ov-2);
  border-color: var(--v2-border-strong);
}
.bio-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.footer-hint {
  margin-top: 10px;
  font-size: 11px;
  color: var(--v2-text-3);
  text-align: center;
  line-height: 1.6;
}
.footer-hint code {
  background: rgba(76, 154, 255, 0.15);
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
}
</style>
