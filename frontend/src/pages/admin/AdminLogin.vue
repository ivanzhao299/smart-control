<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Lock } from 'lucide-vue-next';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useSystemBrandingStore } from '@/stores/system-branding';

const router = useRouter();
const route = useRoute();
const authStore = useAdminAuthStore();
const brandingStore = useSystemBrandingStore();

const password = ref('');
const submitting = ref(false);
const passwordInput = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  await brandingStore.load();
  // 如果已登录 (sessionStorage 有 token + 验证通过), 直接跳后台首页
  const ok = await authStore.ensureChecked();
  if (ok) {
    redirectToTarget();
    return;
  }
  // 自动 focus 密码框
  setTimeout(() => passwordInput.value?.focus(), 50);
});

function redirectToTarget(): void {
  // 支持登录后跳回原本想去的页面 (route.query.redirect)
  const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/admin')
    ? route.query.redirect
    : '/admin';
  router.replace(target);
}

async function submit(): Promise<void> {
  if (!password.value) {
    ElMessage.warning('请输入密码');
    return;
  }
  submitting.value = true;
  try {
    await authStore.login(password.value);
    ElMessage.success('登录成功');
    redirectToTarget();
  } catch (e) {
    ElMessage.error((e as Error).message || '登录失败');
    password.value = '';
    setTimeout(() => passwordInput.value?.focus(), 50);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="admin-login">
    <div class="login-bg"></div>
    <div class="login-card">
      <div class="brand">
        <div class="brand-logo">
          <img v-if="brandingStore.branding.logoUrl" :src="brandingStore.branding.logoUrl" alt="logo" />
          <template v-else>{{ brandingStore.branding.logoText }}</template>
        </div>
        <div class="brand-text">
          <div class="brand-title">{{ brandingStore.branding.systemName }}</div>
          <div class="brand-sub">后台管理 · 请输入密码</div>
        </div>
      </div>

      <form class="form" @submit.prevent="submit">
        <div class="field">
          <Lock :size="16" :stroke-width="1.8" class="field-icon" />
          <input
            ref="passwordInput"
            v-model="password"
            type="password"
            class="field-input"
            placeholder="管理员密码"
            autocomplete="current-password"
            :disabled="submitting"
          />
        </div>

        <button type="submit" class="submit-btn" :disabled="submitting || !password">
          {{ submitting ? '登录中...' : '登 录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
/* 登录页用 isolation 屏蔽全局 body::before 的 aurora 漂浮动画,
 * 同时整个容器铺实色, 卡片背景静止不抖. */
.admin-login {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  position: fixed;
  inset: 0;
  padding: 24px;
  background: var(--v2-bg-0);
  isolation: isolate;
  overflow: hidden;
}
.login-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 30% 20%, rgba(0, 229, 255, 0.16) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 80% 80%, rgba(168, 85, 247, 0.12) 0%, transparent 55%),
    linear-gradient(180deg, var(--v2-bg-0) 0%, var(--v2-bg-1) 100%);
  z-index: 0;
  /* 静止 — 不跟全局 aurora-drift 同步漂移 */
  animation: none;
}

.login-card {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 420px;
  padding: 36px 32px 32px;
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
  background: linear-gradient(90deg, transparent, rgba(6, 182, 212, 0.7) 50%, transparent);
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}
.brand-logo {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-info) 100%);
  display: grid;
  place-items: center;
  color: white;
  font-weight: 700;
  font-size: 20px;
  box-shadow: 0 6px 18px -4px rgba(6, 182, 212, 0.65);
  overflow: hidden;
  flex-shrink: 0;
}
.brand-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.brand-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--v2-text-1);
  line-height: 1.3;
}
.brand-sub {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-top: 4px;
}

.form { display: flex; flex-direction: column; gap: 14px; }
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
  letter-spacing: 0.05em;
  outline: none;
  transition: border-color 0.18s, box-shadow 0.18s;
}
.field-input:focus {
  border-color: var(--v2-primary);
  box-shadow: 0 0 0 3px rgba(6, 182, 212, 0.18);
}
.field-input::placeholder { color: var(--v2-text-3); letter-spacing: 0.02em; }

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
  transition: filter 0.18s, transform 0.12s;
}
.submit-btn:hover:not(:disabled) {
  filter: brightness(1.1);
  box-shadow: var(--v2-glow-primary-strong);
}
.submit-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
