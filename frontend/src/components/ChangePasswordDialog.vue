<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { KeyRound, X, Lock, ShieldCheck, Eye, EyeOff } from 'lucide-vue-next';
import { changeOwnPassword } from '@/services/change-password.service';
import { useClientAuthStore } from '@/stores/client-auth';
import { useAdminAuthStore } from '@/stores/admin-auth';

/**
 * 前台 PWA 自助修改密码弹窗（手机「更多」抽屉 / 平板侧栏入口）。
 * 只能改当前登录账户自己的密码，需先验证旧密码。改密成功后旧令牌立即失效，
 * 同时清掉前台 client 与可能存在的后台 admin 会话，回到登录页用新密码登录。
 */
const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const router = useRouter();
const clientAuth = useClientAuthStore();
const adminAuth = useAdminAuthStore();

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const showOld = ref(false);
const showNew = ref(false);
const showConfirm = ref(false);
const submitting = ref(false);
const errorMsg = ref('');

function close(): void {
  emit('update:modelValue', false);
}

function reset(): void {
  form.oldPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  showOld.value = false;
  showNew.value = false;
  showConfirm.value = false;
  errorMsg.value = '';
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) reset();
  },
);

async function submit(): Promise<void> {
  errorMsg.value = '';
  if (!form.oldPassword) {
    errorMsg.value = '请输入当前密码';
    return;
  }
  if (form.newPassword.length < 6 || form.newPassword.length > 128) {
    errorMsg.value = '新密码长度至少 6 位';
    return;
  }
  if (form.newPassword !== form.confirmPassword) {
    errorMsg.value = '两次输入的新密码不一致';
    return;
  }
  if (form.newPassword === form.oldPassword) {
    errorMsg.value = '新密码不能与当前密码相同';
    return;
  }
  submitting.value = true;
  try {
    await changeOwnPassword({
      oldPassword: form.oldPassword,
      newPassword: form.newPassword,
    });
    // 密码已改，旧令牌失效：清掉前台 client 会话（若有后台 admin 令牌一并清掉）。
    clientAuth.logout();
    try {
      await adminAuth.logout();
    } catch {
      /* 旧后台令牌本就会失效，忽略退出接口错误 */
    }
    emit('update:modelValue', false);
    await router.replace({ name: 'client-login' });
  } catch (err) {
    errorMsg.value = (err as Error)?.message || '修改失败，请确认当前密码是否正确';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="modelValue" class="cpd-overlay" @click.self="close">
      <div class="cpd-card" role="dialog" aria-label="修改密码">
        <div class="cpd-head">
          <div class="cpd-title">
            <KeyRound :size="18" :stroke-width="2" />
            <span>修改密码</span>
          </div>
          <button class="cpd-close" title="关闭" @click="close">
            <X :size="18" :stroke-width="2" />
          </button>
        </div>

        <p class="cpd-tip">修改当前账户的密码，改完后所有设备上的旧登录都会失效，需要用新密码重新登录。</p>

        <div class="cpd-field">
          <Lock :size="15" :stroke-width="2" class="cpd-ico" />
          <input
            v-model="form.oldPassword"
            :type="showOld ? 'text' : 'password'"
            class="cpd-input"
            autocomplete="current-password"
            placeholder="当前密码"
          />
          <button type="button" class="cpd-eye" @click="showOld = !showOld">
            <component :is="showOld ? EyeOff : Eye" :size="16" :stroke-width="2" />
          </button>
        </div>

        <div class="cpd-field">
          <ShieldCheck :size="15" :stroke-width="2" class="cpd-ico" />
          <input
            v-model="form.newPassword"
            :type="showNew ? 'text' : 'password'"
            class="cpd-input"
            autocomplete="new-password"
            placeholder="新密码（至少 6 位）"
          />
          <button type="button" class="cpd-eye" @click="showNew = !showNew">
            <component :is="showNew ? EyeOff : Eye" :size="16" :stroke-width="2" />
          </button>
        </div>

        <div class="cpd-field">
          <ShieldCheck :size="15" :stroke-width="2" class="cpd-ico" />
          <input
            v-model="form.confirmPassword"
            :type="showConfirm ? 'text' : 'password'"
            class="cpd-input"
            autocomplete="new-password"
            placeholder="确认新密码"
            @keyup.enter="submit"
          />
          <button type="button" class="cpd-eye" @click="showConfirm = !showConfirm">
            <component :is="showConfirm ? EyeOff : Eye" :size="16" :stroke-width="2" />
          </button>
        </div>

        <div v-if="errorMsg" class="cpd-error">{{ errorMsg }}</div>

        <button class="cpd-submit" :disabled="submitting" @click="submit">
          <KeyRound :size="15" :stroke-width="2" />
          {{ submitting ? '提交中…' : '确认修改' }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.cpd-overlay {
  position: fixed;
  inset: 0;
  z-index: 2200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}
.cpd-card {
  width: 100%;
  max-width: 400px;
  background: var(--v2-surf-1, #161b26);
  border: 1px solid var(--v2-border-soft, rgba(255, 255, 255, 0.08));
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
  box-sizing: border-box;
}
.cpd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.cpd-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 700;
  color: var(--v2-text-1, #e8edf6);
}
.cpd-close {
  background: none;
  border: none;
  color: var(--v2-text-2, #93a0b5);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
}
.cpd-tip {
  margin: 0 0 16px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--v2-text-2, #93a0b5);
}
.cpd-field {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--v2-surf-2, rgba(255, 255, 255, 0.04));
  border: 1px solid var(--v2-border-soft, rgba(255, 255, 255, 0.1));
  border-radius: 10px;
  padding: 0 10px;
  margin-bottom: 12px;
}
.cpd-ico {
  color: var(--v2-text-2, #93a0b5);
  flex-shrink: 0;
}
.cpd-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--v2-text-1, #e8edf6);
  font-size: 15px;
  padding: 12px 0;
}
.cpd-input::placeholder {
  color: var(--v2-text-3, #6b7689);
}
.cpd-eye {
  background: none;
  border: none;
  color: var(--v2-text-2, #93a0b5);
  cursor: pointer;
  padding: 4px;
  display: inline-flex;
}
.cpd-error {
  background: rgba(245, 108, 108, 0.12);
  border: 1px solid rgba(245, 108, 108, 0.35);
  color: #f59b9b;
  font-size: 12.5px;
  line-height: 1.5;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 12px;
}
.cpd-submit {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border: none;
  border-radius: 10px;
  background: var(--v2-primary, #4c9aff);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.cpd-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
