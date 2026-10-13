<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import type { FormItemRule } from 'element-plus';
import { KeyRound, Lock, ShieldCheck } from 'lucide-vue-next';
import { changeOwnPassword } from '@/services/change-password.service';
import { useAdminAuthStore } from '@/stores/admin-auth';

/**
 * 自助修改密码（后台）。
 * 仅修改当前登录账户自己的密码，需先验证旧密码；改密后旧令牌立即失效，
 * 统一退出并跳回后台登录页，避免拿着已失效的令牌继续操作。
 */
const router = useRouter();
const adminAuth = useAdminAuthStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
});

const validateConfirm: FormItemRule['validator'] = (_rule, value, callback) => {
  if (value !== form.newPassword) {
    callback(new Error('两次输入的新密码不一致'));
  } else {
    callback();
  }
};

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入当前密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, max: 128, message: '密码长度至少 6 位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    { validator: validateConfirm, trigger: 'blur' },
  ],
};

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    if (form.newPassword === form.oldPassword) {
      ElMessage.warning('新密码不能与当前密码相同');
      return;
    }
    submitting.value = true;
    try {
      await changeOwnPassword({
        oldPassword: form.oldPassword,
        newPassword: form.newPassword,
      });
      ElMessage.success('密码已修改，为保障安全请使用新密码重新登录');
      // 旧令牌随密码指纹变化而失效，清后台会话并回登录页（logout 内部已容错 401）。
      await adminAuth.logout();
      await router.replace({ name: 'admin-login' });
    } catch (err) {
      ElMessage.error((err as Error)?.message || '修改失败，请确认当前密码是否正确');
    } finally {
      submitting.value = false;
    }
  });
}
</script>

<template>
  <section class="cp-admin">
    <header class="page-head">
      <h2><KeyRound :size="20" :stroke-width="2" /> 修改密码</h2>
      <p class="sub">修改当前登录账户的密码。为保障账户安全，改完后所有设备上的旧登录都会失效，需要用新密码重新登录。</p>
    </header>

    <div class="form-card">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        class="cp-form"
        @submit.prevent
      >
        <el-form-item label="当前密码" prop="oldPassword">
          <el-input
            v-model="form.oldPassword"
            type="password"
            show-password
            autocomplete="current-password"
            placeholder="请输入当前密码"
            :prefix-icon="Lock"
          />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="至少 6 位"
            :prefix-icon="ShieldCheck"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
            placeholder="再次输入新密码"
            :prefix-icon="ShieldCheck"
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">
            <KeyRound :size="15" :stroke-width="2" /> 确认修改
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </section>
</template>

<style scoped>
.cp-admin {
  padding: 16px 24px;
  color: var(--v2-text-1);
}
.page-head {
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 0;
  font-size: 20px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.sub {
  color: var(--v2-text-2);
  margin: 8px 0 0;
  font-size: 13px;
  max-width: 560px;
  line-height: 1.6;
}
.form-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  padding: 22px 24px;
  max-width: 480px;
}
.cp-form :deep(.el-form-item__label) {
  font-weight: 600;
  padding-bottom: 4px;
}
@media (max-width: 600px) {
  .cp-admin { padding: 12px 14px; }
  .form-card { padding: 18px 16px; }
}
</style>
