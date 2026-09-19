<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Rocket, RefreshCw, Send, AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-vue-next';
import {
  testflightService,
  type TestFlightOverview,
  type TestFlightTester,
  type TestFlightEffectiveStatus,
} from '@/services/testflight.service';

/**
 * iOS TestFlight 内部测试员管理。
 * 服务端持 App Store Connect「App Manager」专用密钥直接调 ASC API,
 * 管理员在此填姓名 + 邮箱(受邀人的 Apple ID)即可一键邀请、看状态、重发。
 * 内部测试员固定授予最小权限 MARKETING, 仅可见金湖智控, 不走 iOS App / CI。
 */

const loading = ref(false);
const inviting = ref(false);
const resendingId = ref<number | null>(null);
const overview = ref<TestFlightOverview | null>(null);
const testers = ref<TestFlightTester[]>([]);
const formRef = ref<FormInstance>();

const form = reactive({ lastName: '', firstName: '', email: '' });
const rules: FormRules = {
  lastName: [{ required: true, message: '填受邀人的姓', trigger: 'blur' }],
  firstName: [{ required: true, message: '填受邀人的名', trigger: 'blur' }],
  email: [
    { required: true, message: '填受邀人邮箱 (其 Apple ID)', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
};

const configured = computed(() => overview.value?.configured === true && overview.value?.enabled !== false);

const STATUS_META: Record<TestFlightEffectiveStatus, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  PENDING: { label: '待接受', type: 'warning' },
  EXPIRED: { label: '已过期', type: 'info' },
  ACCEPTED: { label: '已接受 · 可内测', type: 'success' },
  FAILED: { label: '邀请失败', type: 'danger' },
};

function statusMeta(s: TestFlightEffectiveStatus) {
  return STATUS_META[s] ?? { label: s, type: 'info' as const };
}

function statusIcon(s: TestFlightEffectiveStatus) {
  if (s === 'ACCEPTED') return CheckCircle2;
  if (s === 'FAILED') return XCircle;
  return Clock;
}

function fullName(t: TestFlightTester): string {
  return `${t.lastName}${t.firstName}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

function buildLabel(): string {
  const b = overview.value?.latestBuild;
  if (!b) return '暂无构建';
  const ver = b.version ? `v${b.version} · ` : '';
  return `${ver}build #${b.build}（${b.processingState === 'VALID' ? '有效' : b.processingState}）`;
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [ov, list] = await Promise.all([
      testflightService.overview(),
      testflightService.testers().catch(() => [] as TestFlightTester[]),
    ]);
    overview.value = ov;
    testers.value = list;
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    inviting.value = true;
    try {
      const result = await testflightService.invite({
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        email: form.email.trim().toLowerCase(),
      });
      if (result.state === 'invited') {
        ElMessage.success(`已向 ${form.email.trim()} 发送 TestFlight 内部测试邀请`);
      } else if (result.state === 'accepted') {
        ElMessage.info(`${form.email.trim()} 已是团队成员，可直接参与内部测试`);
      } else {
        ElMessage.warning(`${form.email.trim()} 的邀请已存在，当前为待接受状态`);
      }
      form.lastName = '';
      form.firstName = '';
      form.email = '';
      await formRef.value?.clearValidate();
      await refresh();
    } catch (err) {
      ElMessage.error(`邀请失败: ${(err as Error).message}`);
    } finally {
      inviting.value = false;
    }
  });
}

async function resend(t: TestFlightTester): Promise<void> {
  resendingId.value = t.id;
  try {
    await testflightService.resend(t.id);
    ElMessage.success(`已重新向 ${t.email} 发送邀请`);
    await refresh();
  } catch (err) {
    ElMessage.error(`重发失败: ${(err as Error).message}`);
  } finally {
    resendingId.value = null;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="tf-admin">
    <header class="page-head">
      <div>
        <h2><Rocket :size="20" :stroke-width="2" /> iOS TestFlight 内部测试</h2>
        <p class="sub">
          填写受邀人姓名与邮箱（其 Apple ID），服务端直接通过 App Store Connect 发起内部测试邀请。
          内部测试员为最小权限（Marketing），仅可见「金湖智控」，免审核、构建立即可测；受邀人接受邮件后即可在 TestFlight 安装。
        </p>
      </div>
      <div class="actions">
        <el-button :loading="loading" @click="refresh">
          <RefreshCw :size="15" :stroke-width="2" /> 刷新
        </el-button>
      </div>
    </header>

    <!-- 未配置密钥提示 -->
    <el-alert
      v-if="overview && !configured"
      class="cfg-alert"
      type="warning"
      :closable="false"
      show-icon
      title="后台尚未配置 App Store Connect API 密钥"
      description="请在服务器 backend/.env 设置 TESTFLIGHT_ISSUER_ID / TESTFLIGHT_KEY_ID / TESTFLIGHT_P8_BASE64（App Manager 专用钥）后重启后端，本页即可一键邀请。"
    />

    <!-- 总览卡 -->
    <div class="ov-card">
      <div class="ov-main">
        <div class="ov-app">
          <span class="ov-app-name">{{ overview?.app?.name ?? '金湖智控' }}</span>
          <code class="ov-pill">{{ overview?.app?.bundleId ?? overview?.bundleId ?? 'com.jinhu.smartcontrol' }}</code>
          <el-tag v-if="configured" type="success" size="small">密钥已配置</el-tag>
          <el-tag v-else type="warning" size="small">未配置</el-tag>
        </div>
        <div class="ov-meta">
          <span>App ID：<code>{{ overview?.appId ?? '—' }}</code></span>
          <span>内部组：{{ overview?.internalGroup?.name ?? overview?.internalGroupName ?? '—' }}</span>
          <span>最新构建：{{ buildLabel() }}</span>
          <span v-if="overview?.keyId">密钥：<code>{{ overview.keyId }}</code>（App Manager）</span>
        </div>
        <div v-if="overview?.error" class="ov-error">
          <AlertCircle :size="14" /> 苹果侧部分信息读取失败：{{ overview.error }}
        </div>
      </div>
      <div class="ov-counts">
        <div class="count"><b>{{ overview?.counts.total ?? 0 }}</b><span>总数</span></div>
        <div class="count pending"><b>{{ overview?.counts.pending ?? 0 }}</b><span>待接受</span></div>
        <div class="count accepted"><b>{{ overview?.counts.accepted ?? 0 }}</b><span>已接受</span></div>
        <div class="count failed"><b>{{ overview?.counts.failed ?? 0 }}</b><span>失败</span></div>
      </div>
    </div>

    <!-- 邀请表单 -->
    <div class="form-card">
      <h3 class="form-title"><Send :size="16" /> 邀请内部测试员</h3>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px" inline>
        <el-form-item label="姓" prop="lastName">
          <el-input v-model="form.lastName" placeholder="许" maxlength="80" style="width: 140px" />
        </el-form-item>
        <el-form-item label="名" prop="firstName">
          <el-input v-model="form.firstName" placeholder="万玺" maxlength="80" style="width: 140px" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="tester@example.com（Apple ID）" maxlength="254" style="width: 300px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="inviting" :disabled="!configured" @click="submit">
            <Send :size="15" /> 发送邀请
          </el-button>
        </el-form-item>
      </el-form>
      <p class="form-hint">
        受邀人会收到 Apple 的 TestFlight 邀请邮件；需用该邮箱作为 Apple ID 登录 iPhone 并接受。邀请约 72 小时有效，过期可在右侧「重发」。
      </p>
    </div>

    <!-- 测试员列表 -->
    <div class="table-card">
      <h3 class="form-title">测试员（{{ testers.length }}）</h3>
      <el-table :data="testers" v-loading="loading" size="default" style="width: 100%">
        <el-table-column label="姓名" min-width="110">
          <template #default="{ row }">{{ fullName(row) }}</template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱 / Apple ID" min-width="200" />
        <el-table-column label="状态" min-width="150">
          <template #default="{ row }">
            <el-tag :type="statusMeta(row.effectiveStatus).type" size="small">
              <component :is="statusIcon(row.effectiveStatus)" :size="12" style="margin-right: 3px" />
              {{ statusMeta(row.effectiveStatus).label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="邀请有效期至" min-width="170">
          <template #default="{ row }">{{ formatDate(row.expirationDate) }}</template>
        </el-table-column>
        <el-table-column label="邀请人 / 时间" min-width="180">
          <template #default="{ row }">
            <div>{{ row.invitedBy ?? '—' }}</div>
            <div class="cell-sub">{{ formatDate(row.invitedAt) }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :loading="resendingId === row.id"
              :disabled="row.effectiveStatus === 'ACCEPTED'"
              @click="resend(row)"
            >重发</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="empty">
            <Rocket :size="22" />
            <span>还没有内部测试员，填写上方表单发起第一个邀请</span>
          </div>
        </template>
      </el-table>
      <p v-if="testers.some((t) => t.lastError)" class="err-list">
        最近错误：
        <span v-for="t in testers.filter((x) => x.lastError)" :key="t.id" class="err-item">
          {{ t.email }}：{{ t.lastError }}
        </span>
      </p>
    </div>
  </section>
</template>

<style scoped>
.tf-admin {
  padding: 16px 24px;
  color: var(--v2-text-1);
}
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 16px;
  gap: 16px;
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
  margin: 6px 0 0;
  font-size: 13px;
  max-width: 820px;
  line-height: 1.6;
}
.cfg-alert { margin-bottom: 16px; }

.ov-card {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 22px;
  background: linear-gradient(135deg, rgba(76, 154, 255, 0.04) 0%, rgba(255, 255, 255, 0.04) 100%);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  margin-bottom: 18px;
  box-shadow: 0 4px 16px -8px rgba(76, 154, 255, 0.18);
  flex-wrap: wrap;
}
.ov-main { flex: 1; min-width: 280px; }
.ov-app { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ov-app-name { font-size: 20px; font-weight: 700; color: var(--v2-primary-hover); }
.ov-pill {
  background: rgba(76, 154, 255, 0.15);
  color: #67e8f9;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 11px;
}
.ov-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  margin-top: 10px;
  color: var(--v2-text-2);
  font-size: 12.5px;
}
.ov-meta code { color: var(--v2-text-1); }
.ov-error {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  color: var(--v2-warning);
  font-size: 12.5px;
}
.ov-counts { display: flex; gap: 14px; align-items: center; }
.count {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 56px;
  padding: 8px 12px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
}
.count b { font-size: 22px; color: var(--v2-text-1); }
.count span { font-size: 11px; color: var(--v2-text-2); margin-top: 2px; }
.count.pending b { color: #e6a23c; }
.count.accepted b { color: #67c23a; }
.count.failed b { color: #f56c6c; }

.form-card,
.table-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  padding: 18px 22px;
  margin-bottom: 18px;
}
.form-title {
  margin: 0 0 14px;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--v2-text-1);
}
.form-hint { color: var(--v2-text-2); font-size: 12px; line-height: 1.6; margin: 4px 0 0; }
.cell-sub { color: var(--v2-text-2); font-size: 11px; }
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 30px 0;
  color: var(--v2-text-2);
  font-size: 13px;
}
.err-list { margin: 12px 0 0; color: var(--v2-warning); font-size: 12px; }
.err-item { display: block; margin-top: 4px; word-break: break-all; }

@media (max-width: 600px) {
  .tf-admin { padding: 12px 14px; }
  .ov-card { flex-direction: column; }
}
</style>
