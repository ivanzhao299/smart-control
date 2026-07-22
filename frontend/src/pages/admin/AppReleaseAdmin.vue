<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Smartphone, AlertCircle, Download, ChevronDown } from 'lucide-vue-next';
import {
  appReleaseService,
  type AppReleaseView,
  type AppReleaseUpsertDto,
} from '@/services/app-release.service';

/**
 * APP 版本管理 — 默认业主只能改运营开关 (启停 / 强制更新 / 最低兼容 / 更新说明),
 * 版本号 + 下载链接由 GitHub Actions build → 我自动 UPDATE 后台表写入, 业主一般不动.
 *
 * 业主反馈 2026-05-31:
 *   "为什么里面的版本号之类的都是可以编辑的? 用户需要编辑这些东西吗?"
 *   → 把 versionCode/versionName/downloadUrl 折叠进"高级"块默认收起.
 *   "现在必须复制到浏览器里下载吗"
 *   → 顶部加"下载 APK"大按钮, 直接 a href download.
 */

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
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    saving.value = true;
    try {
      await appReleaseService.upsert(tab.value, {
        versionCode: Number(form.versionCode),
        versionName: form.versionName.trim(),
        downloadUrl: form.downloadUrl.trim(),
        notes: (form.notes || '').trim() || null,
        forceUpdate: form.forceUpdate ?? false,
        minSupportedVersionCode: Number(form.minSupportedVersionCode ?? 1),
        enabled: form.enabled ?? true,
      });
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
          GitHub Actions 自动构建并发布新版后, 后台版本信息会自动同步, 业主一般只需要
          管理下面的运营开关 (启停 / 强制更新 / 更新说明). 版本号和下载链接默认不显示.
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
      <span>{{ tab }} 还没有发布信息, 展开下面"高级"块填表创建</span>
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
      <h3 class="form-section">运营管理</h3>

      <el-form-item label="启用推送">
        <el-switch v-model="form.enabled" />
        <span class="hint">关掉后 APP 不会弹任何更新提示 (想暂停推送时用)</span>
      </el-form-item>

      <el-form-item label="强制更新">
        <el-switch v-model="form.forceUpdate" />
        <span class="hint">
          打开后业主不能"稍后", 必须升级才能继续用 APP. 谨慎用 (老 APP 出严重 bug 才开)
        </span>
      </el-form-item>

      <el-form-item label="最低兼容版本">
        <el-input-number v-model="form.minSupportedVersionCode" :min="1" :max="999999" controls-position="right" />
        <span class="hint">
          APP 本地 versionCode 低于这个值 → 强制升级 (即使上面 forceUpdate=false). 协议变化时升上来踢老 APP.
        </span>
      </el-form-item>

      <el-form-item label="更新说明">
        <el-input
          v-model="form.notes"
          type="textarea"
          :rows="5"
          placeholder="本次更新内容, e.g.&#10;- 换 logo&#10;- 修复全屏 bug"
        />
        <span class="hint">业主升级时显示在对话框里, 一行一条简单写就行</span>
      </el-form-item>

      <!-- 高级 — 默认折叠, 版本号 + 下载链接 一般不要手动改 (部署自动写入) -->
      <div class="adv-toggle" @click="advancedOpen = !advancedOpen">
        <ChevronDown :size="14" :class="{ rotated: advancedOpen }" />
        <span>高级 — 手动编辑版本号 + 下载链接 (部署流程会自动写入, 一般不要动)</span>
      </div>

      <div v-show="advancedOpen" class="adv-block">
        <el-form-item label="versionCode" prop="versionCode">
          <el-input-number v-model="form.versionCode" :min="1" :max="999999" controls-position="right" />
          <span class="hint">整数, 每次发新版必须比上一版大 (1 → 2 → 3...). 跟 Android BuildConfig.VERSION_CODE 一致.</span>
        </el-form-item>

        <el-form-item label="versionName" prop="versionName">
          <el-input v-model="form.versionName" placeholder="1.0.1" style="width: 200px;" />
          <span class="hint">用户看的版本号, e.g. 1.0.1. 跟 build.gradle.kts 的 versionName 一致.</span>
        </el-form-item>

        <el-form-item label="下载链接" prop="downloadUrl">
          <el-input
            v-model="form.downloadUrl"
            type="textarea"
            :rows="2"
            placeholder="https://github.com/.../app-debug.apk"
          />
          <span class="hint">
            APK / IPA 下载链接 (业主能用浏览器直接下到的). 通常是 GitHub release asset URL.
          </span>
        </el-form-item>
      </div>

      <el-form-item>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
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
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-info) 100%);
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
