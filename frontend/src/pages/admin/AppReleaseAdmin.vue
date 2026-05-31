<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Smartphone, AlertCircle } from 'lucide-vue-next';
import {
  appReleaseService,
  type AppReleaseView,
  type AppReleaseUpsertDto,
} from '@/services/app-release.service';

/**
 * APP 版本管理 — 业主在这里改 latest 版本号 + 下载链接, APP 启动时拉这个比对.
 * 见 docs/DESIGN_SYSTEM.md 第 6 章模式, 见 backend AppReleaseService.
 */

type Platform = 'android' | 'ios';
const PLATFORMS: Platform[] = ['android', 'ios'];

const tab = ref<Platform>('android');
const loading = ref(false);
const saving = ref(false);
const formRef = ref<FormInstance>();
const allReleases = ref<AppReleaseView[]>([]);

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
    // 该平台还没数据 — 给默认值
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

onMounted(refresh);
</script>

<template>
  <section class="app-release-admin">
    <header class="page-head">
      <div>
        <h2><Smartphone :size="20" :stroke-width="2" /> APP 版本管理</h2>
        <p class="sub">
          填这里, APP 启动时会拉到, 比对本地 versionCode 不一致就弹"新版本"对话框 →
          点击跳浏览器下载新 APK. 业主只需 GitHub Actions 发新 release 后, 来这里把
          versionCode / versionName / 下载链接 改成新的即可.
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

    <!-- 当前状态卡 -->
    <div v-if="currentRelease" class="status-card">
      <div class="kv">
        <span class="k">当前发布版本</span>
        <span class="v">
          v{{ currentRelease.versionName }}
          <code class="code-pill">code {{ currentRelease.versionCode }}</code>
        </span>
      </div>
      <div class="kv">
        <span class="k">下载链接</span>
        <a class="link" :href="currentRelease.downloadUrl" target="_blank" rel="noopener">{{ currentRelease.downloadUrl }}</a>
      </div>
      <div class="kv">
        <span class="k">更新时间</span>
        <span class="v">{{ new Date(currentRelease.updatedAt).toLocaleString() }}</span>
      </div>
      <div class="kv">
        <span class="k">状态</span>
        <span class="v">
          <el-tag v-if="!currentRelease.enabled" type="info" size="small">已停用</el-tag>
          <el-tag v-else-if="currentRelease.forceUpdate" type="warning" size="small">强制更新</el-tag>
          <el-tag v-else type="success" size="small">正常推送</el-tag>
        </span>
      </div>
    </div>
    <div v-else class="status-card empty">
      <AlertCircle :size="20" :stroke-width="2" />
      <span>{{ tab }} 还没有发布信息, 在下面填表保存</span>
    </div>

    <!-- 编辑表单 -->
    <el-form ref="formRef" :model="form" :rules="rules" label-width="160px" label-position="right" class="form">
      <el-form-item label="versionCode" prop="versionCode">
        <el-input-number v-model="form.versionCode" :min="1" :max="999999" controls-position="right" />
        <span class="hint">整数, 每次发新版必须比上一版大 (1 → 2 → 3...). Android BuildConfig.VERSION_CODE 一致.</span>
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

      <el-form-item label="更新说明">
        <el-input
          v-model="form.notes"
          type="textarea"
          :rows="4"
          placeholder="本次更新内容, e.g.&#10;- 应用名改为'展厅中控'&#10;- 修复全屏 bug"
        />
        <span class="hint">业主升级时显示在对话框里, 一行一条简单写就行</span>
      </el-form-item>

      <el-form-item label="强制更新">
        <el-switch v-model="form.forceUpdate" />
        <span class="hint">
          打开后业主不能"稍后", 必须升级才能继续用 APP. 谨慎用 (e.g. 老 APP 出严重 bug)
        </span>
      </el-form-item>

      <el-form-item label="最低兼容版本">
        <el-input-number v-model="form.minSupportedVersionCode" :min="1" :max="999999" controls-position="right" />
        <span class="hint">
          APP 本地 versionCode 低于这个值 → 强制升级 (即使 forceUpdate=false). 协议变化时升上来踢老 APP.
        </span>
      </el-form-item>

      <el-form-item label="启用推送">
        <el-switch v-model="form.enabled" />
        <span class="hint">关掉后 APP 不会弹任何更新提示 (业主想暂停推送时用)</span>
      </el-form-item>

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
  box-shadow: 0 0 0 1px rgba(0, 229, 255, 0.3);
}

.status-card {
  padding: 14px 18px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.status-card.empty {
  flex-direction: row;
  align-items: center;
  gap: 10px;
  color: var(--v2-warning);
}
.kv {
  display: flex;
  gap: 14px;
  font-size: 13px;
  align-items: baseline;
}
.kv .k {
  color: var(--v2-text-2);
  min-width: 100px;
}
.kv .v {
  color: var(--v2-text-1);
  word-break: break-all;
}
.code-pill {
  background: rgba(0, 229, 255, 0.15);
  color: #67E8F9;
  padding: 1px 8px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  margin-left: 6px;
}
.link {
  color: var(--v2-primary-hover);
  text-decoration: none;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
}
.link:hover { text-decoration: underline; }

.form {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  padding: 20px 24px;
}
.hint {
  display: block;
  font-size: 12px;
  color: var(--v2-text-2);
  margin-top: 4px;
  line-height: 1.5;
}
</style>
