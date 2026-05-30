<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useSystemBrandingStore } from '@/stores/system-branding';

/**
 * 系统品牌后台 — 编辑当前系统的 logo / 名称 / 副标题 / 浏览器 title.
 *
 * 跟「硬件品牌」(/admin/brands) 区分:
 *   - 硬件品牌: 接入设备的厂商目录 (NovaStar / 诺瓦 / DALI etc.), 复数, 维护硬件清单用
 *   - 系统品牌: 控制系统本身的品牌身份, 单条记录, 改完前台 logo + 顶栏标题立即变
 */

const brandingStore = useSystemBrandingStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const form = reactive({
  systemName: '',
  systemSubtitle: '',
  logoText: '',
  logoUrl: '',
  browserTitle: '',
  copyright: '',
});

const rules: FormRules = {
  systemName: [
    { required: true, message: '系统名称必填', trigger: 'blur' },
    { max: 80, message: '不能超过 80 字符', trigger: 'blur' },
  ],
  logoText: [
    { required: true, message: 'Logo 文字必填 (没图片时显示)', trigger: 'blur' },
    { max: 4, message: 'Logo 文字不能超过 4 个字符 (建议 1-2 个汉字)', trigger: 'blur' },
  ],
  systemSubtitle: [{ max: 60, message: '副标题不能超过 60 字符', trigger: 'blur' }],
  browserTitle: [{ max: 80, message: '浏览器标题不能超过 80 字符', trigger: 'blur' }],
};

function loadFormFromStore(): void {
  const b = brandingStore.branding;
  form.systemName = b.systemName;
  form.systemSubtitle = b.systemSubtitle ?? '';
  form.logoText = b.logoText;
  form.logoUrl = b.logoUrl ?? '';
  form.browserTitle = b.browserTitle ?? '';
  form.copyright = b.copyright ?? '';
}

onMounted(async () => {
  await brandingStore.load();
  loadFormFromStore();
});

async function save(): Promise<void> {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  submitting.value = true;
  try {
    await brandingStore.save({
      systemName: form.systemName.trim(),
      systemSubtitle: form.systemSubtitle.trim() || null,
      logoText: form.logoText.trim(),
      logoUrl: form.logoUrl.trim() || null,
      browserTitle: form.browserTitle.trim() || null,
      copyright: form.copyright.trim() || null,
    });
    ElMessage.success('已保存, 前台所有 logo + 标题已实时更新');
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
  } finally {
    submitting.value = false;
  }
}

function reset(): void {
  loadFormFromStore();
  ElMessage.info('已还原到当前已保存的配置');
}

// 实时预览: 顶栏 logo + 标题
const previewLogoUrl = computed(() => form.logoUrl.trim());
const previewLogoText = computed(() => form.logoText.trim() || '?');
const previewSystemName = computed(() => form.systemName.trim() || '系统名称');
const previewSubtitle = computed(() => form.systemSubtitle.trim() || '副标题');
</script>

<template>
  <div class="system-branding-admin">
    <header class="page-head">
      <div>
        <h2>系统品牌</h2>
        <p class="hint">控制系统本身的 logo + 名称配置. 改完保存, 前台左上角 logo + 顶栏标题 + 浏览器 tab 全部实时同步.</p>
      </div>
    </header>

    <div class="layout">
      <!-- 左: 表单 -->
      <el-card class="form-card" shadow="never">
        <el-form
          ref="formRef"
          :model="form"
          :rules="rules"
          label-position="top"
          @submit.prevent="save"
        >
          <el-form-item label="系统名称" prop="systemName" required>
            <el-input
              v-model="form.systemName"
              maxlength="80"
              show-word-limit
              placeholder="比如: 金湖展贸中心 · 智能控制"
            />
            <div class="form-help">平板顶栏第一行 + 后台侧栏顶部 + 浏览器 tab 默认值用这个</div>
          </el-form-item>

          <el-form-item label="副标题 / 简称" prop="systemSubtitle">
            <el-input
              v-model="form.systemSubtitle"
              maxlength="60"
              show-word-limit
              placeholder="比如: 智慧展厅中控 (可空)"
            />
            <div class="form-help">后台侧栏 logo 下方第二行小字</div>
          </el-form-item>

          <el-divider content-position="left">Logo</el-divider>

          <el-form-item label="Logo 文字" prop="logoText" required>
            <el-input
              v-model="form.logoText"
              maxlength="4"
              show-word-limit
              placeholder="1-2 个汉字, 比如 金 / 金湖"
              style="max-width: 220px;"
            />
            <div class="form-help">圆形 logo 里显示的字 (没传 logoUrl 时用)</div>
          </el-form-item>

          <el-form-item label="Logo 图片 URL" prop="logoUrl">
            <el-input
              v-model="form.logoUrl"
              placeholder="留空用文字 logo. 想用图片就填 URL (绝对路径或 /api/media/<id>/file)"
            />
            <div class="form-help">图片优先于文字. 推荐 1:1 方图, 透明 PNG / SVG. 暂未集成上传, 先用现有 URL.</div>
          </el-form-item>

          <el-divider content-position="left">其他</el-divider>

          <el-form-item label="浏览器标签页标题" prop="browserTitle">
            <el-input
              v-model="form.browserTitle"
              maxlength="80"
              show-word-limit
              placeholder="比如: 金湖展贸中心 控制系统"
            />
            <div class="form-help">浏览器标签 / 收藏夹显示用. 留空走系统名称兜底</div>
          </el-form-item>

          <el-form-item label="版权 / 落款" prop="copyright">
            <el-input
              v-model="form.copyright"
              type="textarea"
              :rows="2"
              maxlength="120"
              show-word-limit
              placeholder="比如: © 2026 金湖展贸中心. 留空不显示."
            />
            <div class="form-help">平板首页右下角小字版权 (可空)</div>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="save">保存</el-button>
            <el-button :disabled="submitting" @click="reset">还原</el-button>
          </el-form-item>
        </el-form>
      </el-card>

      <!-- 右: 实时预览 -->
      <el-card class="preview-card" shadow="never">
        <template #header>
          <div class="preview-head">
            <span>实时预览</span>
            <span class="preview-sub">表单一改, 这里立即跟着变</span>
          </div>
        </template>

        <!-- 平板顶栏预览 -->
        <div class="preview-block">
          <div class="preview-label">平板 / 控制端 顶栏</div>
          <div class="pv-shell-mini">
            <div class="pv-nav">
              <div class="pv-logo">
                <img v-if="previewLogoUrl" :src="previewLogoUrl" :alt="previewLogoText" />
                <template v-else>{{ previewLogoText }}</template>
              </div>
            </div>
            <div class="pv-header">
              <div class="pv-title">{{ previewSystemName }}</div>
              <div class="pv-sub">2026-05-30 周六</div>
            </div>
          </div>
        </div>

        <!-- 后台侧栏预览 -->
        <div class="preview-block">
          <div class="preview-label">后台 侧栏</div>
          <div class="pv-admin-mini">
            <div class="pv-admin-brand">
              <div class="pv-logo pv-logo-square">
                <img v-if="previewLogoUrl" :src="previewLogoUrl" :alt="previewLogoText" />
                <template v-else>{{ previewLogoText }}</template>
              </div>
              <div>
                <div class="pv-title">{{ previewSystemName }}</div>
                <div class="pv-sub">{{ previewSubtitle }} · Admin</div>
              </div>
            </div>
          </div>
        </div>

        <!-- 浏览器 tab 预览 -->
        <div class="preview-block">
          <div class="preview-label">浏览器标签页</div>
          <div class="pv-tab">
            <div class="pv-tab-fav"></div>
            <span class="pv-tab-text">{{ form.browserTitle.trim() || previewSystemName }}</span>
          </div>
        </div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.system-branding-admin {
  padding: 16px 20px 32px;
}
.page-head {
  margin-bottom: 16px;
}
.page-head h2 {
  margin: 0 0 4px;
  font-size: 20px;
  color: var(--v2-text-1);
  font-weight: 600;
}
.page-head .hint {
  margin: 0;
  font-size: 13px;
  color: var(--v2-text-3);
  line-height: 1.6;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(360px, 1fr);
  gap: 18px;
  align-items: start;
}
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
}

.form-card,
.preview-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
}
.form-card :deep(.el-card__body) {
  padding: 18px 20px 8px;
}

.form-help {
  margin-top: 4px;
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.4;
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 500;
  color: var(--v2-text-1);
}
.preview-sub {
  font-size: 12px;
  color: var(--v2-text-3);
  font-weight: 400;
}
.preview-block {
  margin-bottom: 18px;
}
.preview-block:last-child { margin-bottom: 0; }
.preview-label {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-bottom: 8px;
  letter-spacing: 0.04em;
}

/* ---- 平板 mini 预览 ---- */
.pv-shell-mini {
  display: grid;
  grid-template-columns: 64px 1fr;
  background: var(--v2-bg-0);
  border: 1px solid var(--v2-border-soft);
  border-radius: 10px;
  overflow: hidden;
}
.pv-nav {
  padding: 8px 12px;
  display: flex;
  justify-content: center;
  background: rgba(255, 255, 255, 0.02);
}
.pv-logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--v2-primary) 0%, var(--v2-info) 100%);
  display: grid;
  place-items: center;
  color: white;
  font-weight: 700;
  font-size: 16px;
  box-shadow: 0 4px 14px -4px rgba(6, 182, 212, 0.6);
  overflow: hidden;
}
.pv-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.pv-logo-square {
  width: 38px;
  height: 38px;
  border-radius: 8px;
  font-size: 16px;
}
.pv-header {
  padding: 10px 14px;
}
.pv-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--v2-text-1);
  line-height: 1.3;
}
.pv-sub {
  font-size: 11px;
  color: var(--v2-text-3);
  margin-top: 3px;
}

/* ---- 后台 mini 预览 ---- */
.pv-admin-mini {
  background: var(--v2-bg-0);
  border: 1px solid var(--v2-border-soft);
  border-radius: 10px;
  padding: 12px 14px;
}
.pv-admin-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ---- 浏览器 tab 预览 ---- */
.pv-tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--v2-border-soft);
  border-radius: 8px 8px 0 0;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--v2-text-1);
  max-width: 320px;
}
.pv-tab-fav {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: linear-gradient(135deg, var(--v2-primary), var(--v2-info));
  flex-shrink: 0;
}
.pv-tab-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
