<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { Upload, Trash2, Lock } from 'lucide-vue-next';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { adminChangePassword } from '@/services/admin-auth.service';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useRouter } from 'vue-router';

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

// logoUrl 不放 rules — 它是上传出来的 data URL, 不归用户管. 校验只看其他字段.
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

// ============ Logo 图片上传 + 客户端 canvas 压缩 ============
// 设计目标:
//   - 用户上传任意 JPG/PNG/SVG (≤5MB), 浏览器端 canvas resize 到 256×256, WebP 压缩
//   - 结果 ~10-30 KB data URL 内嵌 logoUrl 字段, 不依赖文件系统 / nginx 静态
//   - 加载快: 跟 layout chunk 一起来, 不用单独 fetch 一次
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_SIZE_PX = 256;     // logo 通常 40-80px 显示, 256×256 足够 retina
const WEBP_QUALITY = 0.85;
const ACCEPT_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif';
const uploading = ref(false);

/** 读 File → HTMLImageElement (走 object URL, 用完释放) */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解析失败')); };
    img.src = url;
  });
}

/** canvas resize + WebP 编码 → data URL
 *
 * 输出统一是 256×256 正方形 (跟前台 .v2-nav-brand 容器形状一致).
 * 原图按宽高比缩放后居中绘制, 短边方向留透明 padding (object-fit: contain 风格),
 * 这样长方形 logo 也不会被前台 object-fit: cover 裁掉关键部分.
 * 透明区域走 WebP/PNG 自带 alpha 通道, 显示时透出 v2-logo 的青色渐变背景,
 * 跟原来纯文字 logo 的视觉风格自然衔接.
 */
function resizeToWebP(img: HTMLImageElement): string {
  const SIZE = TARGET_SIZE_PX;
  const srcRatio = img.naturalWidth / img.naturalHeight;
  let drawW = SIZE;
  let drawH = SIZE;
  if (srcRatio >= 1) {
    // wide: 撑满宽度, 高度等比缩
    drawH = SIZE / srcRatio;
  } else {
    // tall: 撑满高度, 宽度等比缩
    drawW = SIZE * srcRatio;
  }
  const dx = (SIZE - drawW) / 2;
  const dy = (SIZE - drawH) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context 拿不到, 浏览器太老');
  // 不画背景, 留透明
  ctx.clearRect(0, 0, SIZE, SIZE);
  // 高质量缩放
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, drawW, drawH);
  // 优先 WebP (支持 alpha), 不支持时浏览器自动 fallback PNG (也支持 alpha)
  const dataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);
  if (dataUrl.startsWith('data:image/webp')) return dataUrl;
  return canvas.toDataURL('image/png');
}

/** el-upload 的 :before-upload 拦截 — 不真去 POST, 而是本地处理后塞到 form */
async function handleFileSelected(file: File): Promise<boolean> {
  if (!file.type.startsWith('image/')) {
    ElMessage.error('只支持图片格式 (PNG / JPG / WebP / SVG)');
    return false;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    ElMessage.error(`图片不能超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB (当前 ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
    return false;
  }
  uploading.value = true;
  try {
    const img = await loadImage(file);
    const dataUrl = resizeToWebP(img);
    form.logoUrl = dataUrl;
    const kb = Math.round(dataUrl.length * 0.75 / 1024); // base64 → 字节 = len*0.75
    ElMessage.success(`图片已压缩到 ${TARGET_SIZE_PX}px, 约 ${kb} KB, 保存后生效`);
  } catch (e) {
    ElMessage.error(`图片处理失败: ${(e as Error).message}`);
  } finally {
    uploading.value = false;
  }
  return false; // false → 阻止 el-upload 真去 POST, 我们走 save() 统一提交
}

function clearLogoImage(): void {
  form.logoUrl = '';
}

// ============ 改后台密码 ============
const router = useRouter();
const authStore = useAdminAuthStore();
const pwForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });
const pwSubmitting = ref(false);

async function changePassword(): Promise<void> {
  if (!pwForm.oldPassword || !pwForm.newPassword) {
    ElMessage.warning('请填旧密码 + 新密码');
    return;
  }
  if (pwForm.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位');
    return;
  }
  if (pwForm.newPassword !== pwForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致');
    return;
  }
  pwSubmitting.value = true;
  try {
    await adminChangePassword(pwForm.oldPassword, pwForm.newPassword);
    ElMessage.success('密码已修改, 所有 session 失效, 请重新登录');
    pwForm.oldPassword = '';
    pwForm.newPassword = '';
    pwForm.confirmPassword = '';
    // 改完密码当前 token 也失效了, 主动登出 + 跳登录页
    await authStore.logout();
    router.replace({ name: 'admin-login' });
  } catch (e) {
    ElMessage.error(`改密失败: ${(e as Error).message}`);
  } finally {
    pwSubmitting.value = false;
  }
}

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
      <!-- 左: 表单 + 改密码 -->
      <div class="left-col">
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

          <el-form-item label="Logo 图片">
            <div class="logo-upload-block">
              <!-- 已上传 / 当前图片预览 -->
              <div v-if="form.logoUrl" class="logo-current">
                <img :src="form.logoUrl" alt="logo" class="logo-current-img" />
                <div class="logo-current-meta">
                  <div class="logo-current-size">
                    已压缩到 {{ TARGET_SIZE_PX }}px · 约 {{ Math.round(form.logoUrl.length * 0.75 / 1024) }} KB
                  </div>
                  <el-button size="small" link type="danger" @click="clearLogoImage">
                    <Trash2 :size="14" /> 删除, 回退文字 logo
                  </el-button>
                </div>
              </div>

              <!-- 上传 -->
              <el-upload
                :accept="ACCEPT_TYPES"
                :before-upload="handleFileSelected"
                :show-file-list="false"
                drag
                class="logo-uploader"
              >
                <div class="logo-uploader-inner">
                  <Upload :size="22" :stroke-width="1.6" />
                  <div class="logo-uploader-text">
                    {{ form.logoUrl ? '换张图片' : '点击或拖拽上传' }}
                  </div>
                  <div class="logo-uploader-hint">
                    支持 PNG / JPG / WebP / SVG, ≤ 5MB. 自动压缩到 {{ TARGET_SIZE_PX }}px WebP, 不用管原图大小.
                  </div>
                </div>
              </el-upload>
              <div v-if="uploading" class="logo-uploader-loading">处理中...</div>
            </div>
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

      <!-- 改后台密码 (放在左列底部, 跟系统品牌一组"系统配置") -->
      <el-card class="pw-card" shadow="never">
        <template #header>
          <div class="pw-head">
            <Lock :size="16" :stroke-width="1.8" />
            <span>修改后台密码</span>
          </div>
        </template>
        <el-form label-position="top" @submit.prevent="changePassword">
          <el-form-item label="旧密码">
            <el-input v-model="pwForm.oldPassword" type="password" show-password placeholder="当前登录用的密码" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="pwForm.newPassword" type="password" show-password placeholder="至少 6 位" />
          </el-form-item>
          <el-form-item label="再输一次新密码">
            <el-input v-model="pwForm.confirmPassword" type="password" show-password placeholder="跟上面一致" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="pwSubmitting" @click="changePassword">改密码</el-button>
          </el-form-item>
          <div class="pw-hint">
            ⚠️ 改完密码后, 所有正在用的登录 session 都会失效, 你自己也要重登一次.
          </div>
        </el-form>
      </el-card>
      </div>

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
.left-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
@media (max-width: 1100px) {
  .layout { grid-template-columns: 1fr; }
}

.form-card,
.preview-card,
.pw-card {
  background: var(--v2-ov-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
}
.pw-card {
  margin-top: 14px;
}
.pw-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  color: var(--v2-text-1);
}
.pw-hint {
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.6;
  margin-top: 4px;
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
  background: var(--v2-ov-1);
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
  box-shadow: 0 4px 14px -4px rgba(76, 154, 255, 0.6);
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
  background: var(--v2-ov-1);
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

/* ---- Logo 上传 ---- */
.logo-upload-block {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}
.logo-current {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  background: rgba(76, 154, 255, 0.06);
  border: 1px solid rgba(76, 154, 255, 0.25);
  border-radius: 10px;
}
.logo-current-img {
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 10px;
  flex-shrink: 0;
  background: var(--v2-ov-1);
}
.logo-current-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.logo-current-size {
  font-size: 12px;
  color: var(--v2-text-2);
}
.logo-uploader :deep(.el-upload-dragger) {
  background: rgba(255, 255, 255, 0.025);
  border: 1px dashed var(--v2-border-soft);
  border-radius: 10px;
  padding: 18px 16px;
  transition: border-color 0.18s, background 0.18s;
}
.logo-uploader :deep(.el-upload-dragger:hover) {
  border-color: var(--v2-primary);
  background: rgba(76, 154, 255, 0.05);
}
.logo-uploader-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--v2-text-2);
}
.logo-uploader-text {
  font-size: 13px;
  font-weight: 500;
  color: var(--v2-text-1);
}
.logo-uploader-hint {
  font-size: 11px;
  color: var(--v2-text-3);
  text-align: center;
  line-height: 1.5;
}
.logo-uploader-loading {
  font-size: 12px;
  color: var(--v2-primary);
  text-align: center;
  margin-top: 6px;
}
</style>
