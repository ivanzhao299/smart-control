<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import {
  Rocket,
  RefreshCw,
  RefreshCcw,
  Send,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarClock,
  UploadCloud,
  ExternalLink,
} from 'lucide-vue-next';
import {
  testflightService,
  type TestFlightOverview,
  type TestFlightTester,
  type TestFlightEffectiveStatus,
  type TestFlightRenewal,
  type RenewalStage,
} from '@/services/testflight.service';

/**
 * iOS TestFlight 内部测试员管理。
 * 服务端持 App Store Connect「App Manager」专用密钥直接调 ASC API,
 * 管理员在此填姓名 + 邮箱(受邀人的 Apple ID)即可一键邀请、看状态、重发。
 * 内部测试员固定授予最小权限 MARKETING, 仅可见金湖智控, 不走 iOS App / CI。
 */

const loading = ref(false);
const inviting = ref(false);
const syncing = ref(false);
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

/* ---------- TestFlight 90 天到期 + 一键续期 ---------- */
const renewal = ref<TestFlightRenewal | null>(null);
const renewing = ref(false);
let renewalTimer: ReturnType<typeof setInterval> | null = null;

const renewConfigured = computed(() => renewal.value?.configured === true);
const renewalRunning = computed(() => renewal.value?.status === 'running');
const currentBuild = computed(() => overview.value?.latestBuild ?? null);

const BUILD_STATE_META: Record<string, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  VALID: { label: '有效', type: 'success' },
  PROCESSING: { label: '苹果处理中', type: 'warning' },
  EXPIRED: { label: '已过期', type: 'danger' },
  UNKNOWN: { label: '未知', type: 'info' },
};

const RENEW_STEPS = ['等待 runner', '归档构建', '签名上传', 'ASC 处理'];
const STAGE_STEP: Partial<Record<RenewalStage, number>> = {
  dispatching: 0,
  queued: 0,
  building: 1,
  uploading: 2,
  processing: 3,
};
const renewStepActive = computed(() => {
  const s = renewal.value?.stage;
  if (s === 'succeeded') return RENEW_STEPS.length;
  if (s && s in STAGE_STEP) return STAGE_STEP[s] ?? 0;
  return 0;
});

const countdownText = computed(() => {
  const b = currentBuild.value;
  if (!b) return '暂无构建';
  if (b.state === 'PROCESSING') return '新构建处理中';
  if (b.state === 'EXPIRED') return '已过期，请立即续期';
  if (b.daysRemaining === null) return '—';
  return `剩余 ${b.daysRemaining} 天`;
});
const countdownType = computed<'success' | 'warning' | 'danger' | 'info'>(() => {
  const b = currentBuild.value;
  if (!b || b.daysRemaining === null) return 'info';
  if (b.state === 'EXPIRED') return 'danger';
  if (b.daysRemaining <= 14) return 'danger';
  if (b.daysRemaining <= 30) return 'warning';
  return 'success';
});

async function loadRenewal(): Promise<void> {
  try {
    renewal.value = await testflightService.renewal();
  } catch {
    /* 状态查询失败不打扰页面 */
  }
}

function stopRenewalTimer(): void {
  if (renewalTimer) {
    clearInterval(renewalTimer);
    renewalTimer = null;
  }
}

function startRenewalTimer(): void {
  stopRenewalTimer();
  renewalTimer = setInterval(async () => {
    await loadRenewal();
    if (renewal.value && renewal.value.status !== 'running') {
      stopRenewalTimer();
      if (renewal.value.status === 'succeeded') {
        ElMessage.success('TestFlight 续期完成，新构建已生效');
        await refresh();
      } else {
        ElMessage.error(`续期失败：${renewal.value.error ?? '未知错误'}`);
      }
    }
  }, 4000);
}

async function renewNow(): Promise<void> {
  renewing.value = true;
  try {
    renewal.value = await testflightService.renew();
    ElMessage.info('已触发续期构建，macOS 云签名约需数分钟，可离开本页，进度会自动刷新');
    startRenewalTimer();
  } catch (err) {
    ElMessage.error(`触发续期失败: ${(err as Error).message}`);
    await loadRenewal();
  } finally {
    renewing.value = false;
  }
}

onBeforeUnmount(stopRenewalTimer);

const STATUS_META: Record<TestFlightEffectiveStatus, { label: string; type: 'success' | 'warning' | 'info' | 'danger' }> = {
  PENDING: { label: '待接受', type: 'warning' },
  EXPIRED: { label: '已过期', type: 'info' },
  ACCEPTED: { label: '已加入内部组', type: 'success' },
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
    // 先拉列表（后端会顺带与 App Store Connect 自动对账一次），再读总览，保证计数反映同步结果
    const list = await testflightService.testers().catch(() => [] as TestFlightTester[]);
    testers.value = list;
    overview.value = await testflightService.overview();
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

async function syncNow(): Promise<void> {
  syncing.value = true;
  try {
    const r = await testflightService.sync();
    if (r.throttled) {
      ElMessage.info('刚刚已同步过（60 秒内），当前已是最新结果');
    } else {
      ElMessage.success(
        `已同步：内部组成员 ${r.accepted}、待接受团队邀请 ${r.pending}${r.imported.length ? `，新发现 ${r.imported.length} 个测试员` : ''}`,
      );
    }
    await refresh();
  } catch (err) {
    ElMessage.error(`同步失败: ${(err as Error).message}`);
  } finally {
    syncing.value = false;
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
        ElMessage.success(`已向 ${form.email.trim()} 发送 App Store Connect 团队邀请`);
      } else if (result.state === 'accepted') {
        ElMessage.info(`${form.email.trim()} 已是团队成员；如手机未显示 App，可在列表中重发 TestFlight 邀请`);
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
    const result = await testflightService.resend(t.id);
    if (result.state === 'testflight-invited') {
      ElMessage.success(`已向 ${t.email} 重发 TestFlight 安装邀请，请在 iPhone 上打开邮件`);
    } else if (result.state === 'team-invited') {
      ElMessage.success(`已向 ${t.email} 重发 App Store Connect 团队邀请`);
    } else if (result.notice) {
      // 原邀请仍有效、App Manager 密钥无权撤销：不是失败，用警告样式展示人工处理引导
      ElMessage.warning({ message: result.notice, duration: 10000 });
    }
    await refresh();
  } catch (err) {
    ElMessage.error({ message: `重发失败：${(err as Error).message}`, duration: 10000 });
  } finally {
    resendingId.value = null;
  }
}

onMounted(async () => {
  await refresh();
  await loadRenewal();
  // 页面打开时若已有续期任务在跑（例如刷新页面），自动接续轮询
  if (renewal.value?.status === 'running') startRenewalTimer();
});
</script>

<template>
  <section class="tf-admin">
    <header class="page-head">
      <div>
        <h2><Rocket :size="20" :stroke-width="2" /> iOS TestFlight 内部测试</h2>
        <p class="sub">
          填写受邀人姓名与邮箱（其 Apple ID），服务端先发 App Store Connect 团队邀请。
          对方完成账号激活后，再通过 TestFlight 安装邀请进入手机端；两封邮件属于两个独立阶段。
        </p>
      </div>
      <div class="actions">
        <el-button type="primary" plain :loading="syncing" :disabled="!configured" @click="syncNow">
          <RefreshCcw :size="15" :stroke-width="2" /> 与 App Store Connect 同步
        </el-button>
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
        <div class="count accepted"><b>{{ overview?.counts.accepted ?? 0 }}</b><span>内部组成员</span></div>
        <div class="count failed"><b>{{ overview?.counts.failed ?? 0 }}</b><span>失败</span></div>
      </div>
    </div>

    <!-- 构建有效期 + 一键续期 -->
    <div class="renew-card">
      <h3 class="form-title"><CalendarClock :size="16" /> TestFlight 构建有效期（每个构建 90 天）</h3>
      <div class="renew-grid">
        <div class="renew-info">
          <div class="renew-build">
            <span class="renew-build-name">
              当前内测构建：<b v-if="currentBuild">v{{ currentBuild.version || '—' }} · build #{{ currentBuild.build }}</b><b v-else>暂无</b>
            </span>
            <el-tag v-if="currentBuild" :type="BUILD_STATE_META[currentBuild.state]?.type ?? 'info'" size="small">
              {{ BUILD_STATE_META[currentBuild.state]?.label ?? currentBuild.processingState }}
            </el-tag>
          </div>
          <div class="renew-dates">
            <span>上传：{{ formatDate(currentBuild?.uploadedDate ?? null) }}</span>
            <span>到期：{{ formatDate(currentBuild?.expirationDate ?? null) }}</span>
          </div>
          <div class="renew-countdown" :class="`is-${countdownType}`">{{ countdownText }}</div>
          <p class="form-hint">
            TestFlight 不支持延长旧构建，到期后该 build 无法打开。续期 = 在 macOS 云端重新归档、签名并上传一个新 build（号自动递增）；内部测试员免审核、无需重新接受邀请。
          </p>
        </div>
        <div class="renew-action">
          <el-button
            type="primary"
            size="large"
            :loading="renewing"
            :disabled="!configured || !renewConfigured || renewalRunning"
            @click="renewNow"
          >
            <UploadCloud :size="16" />
            {{ renewalRunning ? '续期进行中…' : '一键续期（上传新构建）' }}
          </el-button>
          <el-alert
            v-if="!renewConfigured"
            class="renew-cfg"
            type="warning"
            :closable="false"
            show-icon
            title="未配置 GitHub Token"
            description="在服务器 backend/.env 设置 TESTFLIGHT_RENEW_TOKEN（classic PAT 需 repo+workflow 权限）并重启后端后，可在此一键触发续期；当前仅展示到期倒计时。"
          />
          <p v-else class="form-hint renew-target">
            触发 {{ renewal?.repository }} 的 {{ renewal?.workflow }}（{{ renewal?.ref }}），约 5–15 分钟完成。
          </p>
        </div>
      </div>

      <!-- 续期进度 -->
      <div v-if="renewal && renewal.status !== 'idle'" class="renew-progress">
        <el-steps :active="renewStepActive" :processStatus="renewal.status === 'failed' ? 'error' : 'process'" align-center>
          <el-step v-for="label in RENEW_STEPS" :key="label" :title="label" />
          <el-step v-if="renewal.status === 'succeeded'" title="完成" status="success" />
        </el-steps>
        <div class="renew-msg" :class="{ failed: renewal.status === 'failed', ok: renewal.status === 'succeeded' }">
          <component
            :is="renewal.status === 'succeeded' ? CheckCircle2 : renewal.status === 'failed' ? XCircle : Clock"
            :size="15"
          />
          <span>{{ renewal.message || '准备中…' }}</span>
          <a v-if="renewal.runUrl" :href="renewal.runUrl" target="_blank" rel="noreferrer" class="renew-link">
            查看 Actions 运行 <ExternalLink :size="12" />
          </a>
        </div>
      </div>
    </div>

    <!-- 邀请表单 -->
    <div class="form-card">
      <h3 class="form-title"><Send :size="16" /> 添加内部测试员</h3>
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
            <Send :size="15" /> 发送团队邀请
          </el-button>
        </el-form-item>
      </el-form>
      <p class="form-hint">
        第一步邮件用于激活 App Store Connect 团队账号；激活后如 TestFlight 没有显示「金湖智控」，点击右侧“重发 TestFlight 邀请”，并在 iPhone 上用同一 Apple 账户打开新邮件。iPhone 不需要手工输入兑换码。
      </p>
    </div>

    <!-- 测试员列表 -->
    <div class="table-card">
      <h3 class="form-title">测试员（{{ testers.length }}）</h3>
      <p class="form-hint" style="margin: -6px 0 12px">
        列表进页面时自动与 App Store Connect 对账一次（60 秒内不重复请求），也可点右上角「与 App Store Connect 同步」手动刷新；“已加入内部组”只表示苹果侧已授权，不等于手机已经安装。
      </p>
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
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :loading="resendingId === row.id"
              @click="resend(row)"
            >{{ row.effectiveStatus === 'ACCEPTED' ? '重发 TestFlight 邀请' : '重发团队邀请' }}</el-button>
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

.renew-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  padding: 18px 22px;
  margin-bottom: 18px;
}
.renew-grid {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  align-items: flex-start;
}
.renew-info { flex: 1; min-width: 300px; }
.renew-build { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.renew-build-name { font-size: 14px; color: var(--v2-text-1); }
.renew-dates {
  display: flex;
  gap: 24px;
  margin-top: 10px;
  color: var(--v2-text-2);
  font-size: 12.5px;
}
.renew-countdown {
  margin-top: 12px;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
}
.renew-countdown.is-success { color: #67c23a; }
.renew-countdown.is-warning { color: #e6a23c; }
.renew-countdown.is-danger { color: #f56c6c; }
.renew-countdown.is-info { color: var(--v2-text-2); }
.renew-action { min-width: 260px; display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
.renew-cfg :deep(.el-alert__description) { font-size: 11.5px; line-height: 1.5; }
.renew-target { margin: 0; }
.renew-progress { margin-top: 18px; padding-top: 8px; }
.renew-msg {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 14px;
  font-size: 13px;
  color: var(--v2-text-2);
}
.renew-msg.failed { color: #f56c6c; }
.renew-msg.ok { color: #67c23a; }
.renew-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  color: var(--el-color-primary);
  text-decoration: none;
}

@media (max-width: 600px) {
  .tf-admin { padding: 12px 14px; }
  .ov-card { flex-direction: column; }
  .renew-grid { flex-direction: column; }
}
</style>
