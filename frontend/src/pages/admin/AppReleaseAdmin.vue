<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Smartphone, AlertCircle, Download, ChevronDown } from 'lucide-vue-next';
import {
  appReleaseService,
  type AppReleaseView,
  type AppReleaseUpsertDto,
} from '@/services/app-release.service';
import { usePermissionStore } from '@/stores/permission';

/**
 * APP 版本管理 — 按角色分权:
 *   admin: 可维护全部字段(版本号/下载链接, 但 bundled 平台仍由受控部署流程写);
 *   config(运营配置员): 只能改运营开关(启停/强制更新/最低兼容/更新说明);
 *   hardware(硬件工程师): 只读核对, 表单禁用、无保存按钮。
 *
 * 版本号 + 下载链接由 GitHub Actions 构建后通过部署门禁写入, 非 admin 一律只读。
 * 历史反馈 2026-05-31: 技术字段折叠进"高级"块默认收起; 顶部"下载 APK"按钮直接下载。
 */

const perm = usePermissionStore();
/** 是否管理员（只有 admin 能维护版本号 / 下载地址等技术字段）。 */
const isAdmin = computed(() => perm.role === 'admin');
/** app-release 模块可写者 = admin + config；hardware 只读。 */
const canEdit = computed(() => perm.canWriteModule('app-release'));
/** 只读模式（hardware）：所有表单控件禁用、隐藏保存。 */
const readOnly = computed(() => !canEdit.value);

type Platform = 'android' | 'ios';
const PLATFORMS: Platform[] = ['android', 'ios'];

const tab = ref<Platform>('android');
const loading = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();
const allReleases = ref<AppReleaseView[]>([]);
const advancedOpen = ref(false);

interface FormState extends AppReleaseUpsertDto {}
const form = reactive<FormState>({
  versionCode: 1,
  versionName: '1.0.0',
  downloadUrl: '',
  notes: '',
  forceUpdate: false,
  minSupportedVersionCode: 1,
  enabled: true,
});

const rules: FormRules = {
  versionCode: [{ required: true, type: 'number', min: 1, message: 'versionCode 必填且 ≥1', trigger: 'blur' }],
  versionName: [{ required: true, message: 'versionName 必填 (e.g. 1.0.0)', trigger: 'blur' }],
  downloadUrl: [{ required: true, message: '下载链接必填', trigger: 'blur' }],
};

const currentRelease = computed<AppReleaseView | undefined>(() =>
  allReleases.value.find((r) => r.platform === tab.value)
);
const deploymentManaged = computed(() => currentRelease.value?.releaseSource === 'bundled');
/** 高级块标题：非 admin 只能看不能改；admin 再按是否部署管理区分。 */
const advToggleText = computed(() => {
  if (!isAdmin.value) return '版本信息（由部署流程维护，仅管理员可修改）';
  return deploymentManaged.value ? '版本信息 — 由部署流程维护' : '高级 — 手动编辑版本号和下载链接';
});
/** 技术字段（版本号/下载地址）：非 admin 一律禁用；admin 仅在手工平台可编辑。 */
const techDisabled = computed(() => !isAdmin.value || deploymentManaged.value);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    allReleases.value = await appReleaseService.list();
    syncFormFromRelease();
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function syncFormFromRelease(): void {
  const r = currentRelease.value;
  if (r) {
    Object.assign(form, {
      versionCode: r.versionCode,
      versionName: r.versionName,
      downloadUrl: r.downloadUrl,
      notes: r.notes ?? '',
      forceUpdate: r.forceUpdate,
      minSupportedVersionCode: r.minSupportedVersionCode,
      enabled: r.enabled,
    });
  } else {
    Object.assign(form, {
      versionCode: 1,
      versionName: '1.0.0',
      downloadUrl: tab.value === 'android'
        ? 'https://github.com/ivanzhao299/smart-control/releases/download/v1.0.0-android/app-debug.apk'
        : '',
      notes: '',
      forceUpdate: false,
      minSupportedVersionCode: 1,
      enabled: true,
    });
    // 没数据 → 必须填表创建, 强制展开高级
    advancedOpen.value = true;
  }
}

function onTabChange(p: Platform): void {
  tab.value = p;
  syncFormFromRelease();
}

async function submit(): Promise<void> {
  if (!canEdit.value) return; // 只读角色（hardware）无保存入口
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    saving.value = true;
    const ops = {
      notes: (form.notes || '').trim() || null,
      forceUpdate: form.forceUpdate ?? false,
      minSupportedVersionCode: Number(form.minSupportedVersionCode ?? 1),
      enabled: form.enabled ?? true,
    };
    try {
      if (isAdmin.value) {
        // admin：全字段（bundled 平台的技术字段仍由后端受控部署保护，改了会被拒）
        await appReleaseService.upsert(tab.value, {
          versionCode: Number(form.versionCode),
          versionName: form.versionName.trim(),
          downloadUrl: form.downloadUrl.trim(),
          ...ops,
        });
      } else {
        // config：只发运营字段；版本号/下载地址由受控部署流程维护，前端不给通道。
        await appReleaseService.updateOps(tab.value, ops);
      }
      ElMessage.success(`${tab.value} 发布信息已保存, APP 下次启动会收到新版本提示`);
      await refresh();
    } catch (err) {
      ElMessage.error(`保存失败: ${(err as Error).message}`);
    } finally {
      saving.value = false;
    }
  });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="app-release-admin">
    <header class="page-head">
      <div>
        <h2><Smartphone :size="20" :stroke-width="2" /> APP 版本管理</h2>
        <p class="sub">
          Android 安装包通过校验并完成生产部署后，版本信息会在部署门禁内同步。后台只需
          管理启停、强制更新、最低兼容版本和更新说明。
        </p>
      </div>
      <div class="actions">
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </header>

    <!-- 平台 tab -->
    <div class="platform-tabs">
      <button
        v-for="p in PLATFORMS"
        :key="p"
        class="ptab"
        :class="{ active: tab === p }"
        @click="onTabChange(p)"
      >{{ p === 'android' ? 'Android' : 'iOS' }}</button>
    </div>

    <!-- 当前版本卡 — 突出版本号 + 下载按钮 + 更新说明 -->
    <div v-if="currentRelease" class="release-card">
      <div class="release-head">
        <div class="release-info">
          <div class="version-line">
            <span class="version-name">v{{ currentRelease.versionName }}</span>
            <code class="code-pill">code {{ currentRelease.versionCode }}</code>
            <el-tag v-if="deploymentManaged" type="info" size="small">部署管理</el-tag>
            <el-tag v-if="!currentRelease.enabled" type="info" size="small">已停用</el-tag>
            <el-tag v-else-if="currentRelease.forceUpdate" type="warning" size="small">强制更新</el-tag>
            <el-tag v-else type="success" size="small">正常推送</el-tag>
          </div>
          <div class="release-meta">最后更新: {{ formatDate(currentRelease.updatedAt) }}</div>
        </div>
        <a
          class="dl-btn"
          :href="currentRelease.downloadUrl"
          target="_blank"
          rel="noopener noreferrer"
          download
          :title="currentRelease.downloadUrl"
        >
          <Download :size="18" :stroke-width="2" />
          <span>下载 APK</span>
        </a>
      </div>
      <pre v-if="currentRelease.notes" class="release-notes">{{ currentRelease.notes }}</pre>
    </div>
    <div v-else class="release-card empty">
      <AlertCircle :size="20" :stroke-width="2" />
      <span v-if="isAdmin">{{ tab }} 还没有发布信息, 展开下面"高级"块填表创建</span>
      <span v-else>{{ tab }} 还没有发布信息，请联系管理员先发布版本（运营配置员只能调整已发布版本的推送开关）。</span>
    </div>

    <!-- 运营字段表单 (业主常改) -->
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="160px"
      label-position="right"
      class="form"
    >
      <h3 class="form-section">
        运营管理
        <el-tag v-if="readOnly" type="info" size="small" class="role-tag">只读</el-tag>
        <el-tag v-else-if="!isAdmin" type="warning" size="small" class="role-tag">运营配置</el-tag>
      </h3>

      <el-form-item label="启用推送">
        <el-switch v-model="form.enabled" :disabled="readOnly" />
        <span class="hint">关掉后 APP 不会弹任何更新提示 (想暂停推送时用)</span>
      </el-form-item>

      <el-form-item label="强制更新">
        <el-switch v-model="form.forceUpdate" :disabled="readOnly" />
        <span class="hint">
          打开后业主不能"稍后", 必须升级才能继续用 APP. 谨慎用 (老 APP 出严重 bug 才开)
        </span>
      </el-form-item>

      <el-form-item label="最低兼容版本">
        <el-input-number
          v-model="form.minSupportedVersionCode"
          :min="1"
          :max="999999"
          controls-position="right"
          :disabled="readOnly"
        />
        <span class="hint">
          APP 本地 versionCode 低于这个值 → 强制升级 (即使上面 forceUpdate=false). 协议变化时升上来踢老 APP.
        </span>
      </el-form-item>

      <el-form-item label="更新说明">
        <el-input
          v-model="form.notes"
          type="textarea"
          :rows="5"
          :disabled="readOnly"
          placeholder="本次更新内容, e.g.&#10;- 换 logo&#10;- 修复全屏 bug"
        />
        <span class="hint">业主升级时显示在对话框里, 一行一条简单写就行</span>
      </el-form-item>

      <!-- 部署管理的平台只读展示版本元数据；手工平台仍可编辑。 -->
      <div class="adv-toggle" @click="advancedOpen = !advancedOpen">
        <ChevronDown :size="14" :class="{ rotated: advancedOpen }" />
        <span>{{ advToggleText }}</span>
      </div>

      <div v-show="advancedOpen" class="adv-block">
        <el-form-item label="versionCode" prop="versionCode">
          <el-input-number v-model="form.versionCode" :min="1" :max="999999" controls-position="right" :disabled="techDisabled" />
          <span class="hint">部署管理的平台会从已校验安装包同步此值；非管理员不可修改。</span>
        </el-form-item>

        <el-form-item label="versionName" prop="versionName">
          <el-input v-model="form.versionName" placeholder="1.0.1" style="width: 200px;" :disabled="techDisabled" />
          <span class="hint">用户看到的版本号；部署管理平台或非管理员不可在后台修改。</span>
        </el-form-item>

        <el-form-item label="下载链接" prop="downloadUrl">
          <el-input
            v-model="form.downloadUrl"
            type="textarea"
            :rows="2"
            placeholder="https://github.com/.../app-debug.apk"
            :disabled="techDisabled"
          />
          <span class="hint">
            部署管理的平台固定指向已验证的现场安装包下载端点；非管理员不可修改。
          </span>
        </el-form-item>
      </div>

      <el-form-item v-if="canEdit">
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </el-form-item>
      <el-form-item v-else>
        <span class="hint">当前为只读角色，仅可核对 APP 版本信息并下载 APK；如需调整推送开关，请联系运营配置员或管理员。</span>
      </el-form-item>
    </el-form>
  </section>
</template>

<style scoped>
.app-release-admin {
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
  max-width: 720px;
  line-height: 1.6;
}

.platform-tabs {
  display: inline-flex;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  padding: 3px;
  margin-bottom: 16px;
}
.ptab {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--v2-text-2);
  cursor: pointer;
  background: transparent;
  border: none;
  transition: all 0.18s ease;
  font-family: inherit;
}
.ptab.active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary-hover);
  box-shadow: 0 0 0 1px rgba(76, 154, 255, 0.3);
}

/* 当前版本卡 — 主视觉, 版本号大字 + 下载按钮高亮 */
.release-card {
  padding: 18px 22px;
  background: linear-gradient(135deg, rgba(76, 154, 255, 0.04) 0%, rgba(255, 255, 255, 0.04) 100%);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  margin-bottom: 20px;
  box-shadow: 0 4px 16px -8px rgba(76, 154, 255, 0.18);
}
.release-card.empty {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--v2-warning);
  background: var(--v2-surf-1);
}
.release-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.release-info { flex: 1; min-width: 0; }
.version-line {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.version-name {
  font-size: 24px;
  font-weight: 700;
  color: var(--v2-primary-hover);
  text-shadow: 0 0 12px rgba(76, 154, 255, 0.4);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.5px;
}
.code-pill {
  background: rgba(76, 154, 255, 0.15);
  color: #67E8F9;
  padding: 2px 10px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
}
.release-meta {
  color: var(--v2-text-2);
  font-size: 12px;
  margin-top: 6px;
}

/* 大下载按钮 — a 用 button 样式, download 属性触发浏览器原生下载 */
.dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 22px;
  background: var(--v2-accent-fill);
  color: #fff;
  text-decoration: none;
  border-radius: var(--v2-r-md);
  font-weight: 600;
  font-size: 14px;
  box-shadow: 0 4px 14px -4px rgba(76, 154, 255, 0.5);
  transition: all 0.18s ease;
  white-space: nowrap;
  cursor: pointer;
}
.dl-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px -4px rgba(76, 154, 255, 0.7);
}
.dl-btn:active { transform: translateY(0); }

.release-notes {
  margin: 14px 0 0;
  padding: 12px 14px;
  background: var(--v2-ov-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  color: var(--v2-text-1);
  font-family: 'PingFang SC', -apple-system, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
}

/* 表单 */
.form {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  padding: 20px 24px;
}
.form-section {
  margin: 0 0 16px;
  font-size: 14px;
  color: var(--v2-text-1);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--v2-border-soft);
  display: flex;
  align-items: center;
}
.role-tag {
  margin-left: 8px;
}
.hint {
  display: block;
  font-size: 12px;
  color: var(--v2-text-2);
  margin-top: 4px;
  line-height: 1.5;
}

/* 高级折叠头 */
.adv-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  margin: 8px 0 12px;
  background: var(--v2-ov-1);
  border: 1px dashed var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  color: var(--v2-text-2);
  font-size: 12.5px;
  cursor: pointer;
  user-select: none;
  transition: all 0.18s ease;
}
.adv-toggle:hover { color: var(--v2-text-1); border-color: var(--v2-primary); }
.adv-toggle svg { transition: transform 0.2s ease; }
.adv-toggle svg.rotated { transform: rotate(180deg); }

.adv-block {
  padding: 12px 0 4px;
  border-left: 2px solid var(--v2-border-soft);
  padding-left: 16px;
  margin: 0 0 12px;
}

@media (max-width: 600px) {
  .app-release-admin { padding: 12px 14px; }
  .release-head { flex-direction: column; align-items: stretch; }
  .dl-btn { justify-content: center; }
  .form { padding: 14px 16px; }
}
</style>
