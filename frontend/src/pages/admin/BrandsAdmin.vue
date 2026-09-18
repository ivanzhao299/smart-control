<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Brand } from '@/services/brand.service';
import { useBrandConfigEditor } from '@/features/useBrandConfigEditor';
import { safeBrandLink } from '@/features/brand-links';

const { list, loading, saving, needsReload, editVisible, editMode, expectedRevision, form,
  refresh, openCreate, openEdit, submit, remove, toggleEnabled } = useBrandConfigEditor();
const search = ref('');
const disabled = computed(() => loading.value || saving.value || needsReload.value);
const filtered = computed<Brand[]>(() => {
  const q = search.value.trim().toLowerCase();
  return !q ? list.value : list.value.filter(b =>
    b.name.toLowerCase().includes(q) || (b.displayName ?? '').toLowerCase().includes(q) ||
    (b.country ?? '').toLowerCase().includes(q));
});
onMounted(refresh);
</script>

<template>
  <section class="brands-admin">
    <header class="page-head">
      <div>
        <h2>品牌维护</h2>
        <p class="sub">设备厂商目录。新增硬件或自定义驱动时同步建档，可在这里补充 logo、联系方式和备注。</p>
      </div>
      <div class="actions">
        <el-input v-model="search" placeholder="搜索品牌 / 国家" clearable style="width: 240px;" />
        <el-button type="primary" @click="openCreate" :disabled="disabled || editVisible">新增品牌</el-button>
        <el-button @click="refresh" :loading="loading" :disabled="saving">刷新</el-button>
      </div>
    </header>

    <el-alert v-if="needsReload" title="请重新读取品牌配置后再保存；未确认的草稿会保留。" type="warning" :closable="false" />
    <el-table :data="filtered" v-loading="loading" stripe class="brands-table">
      <el-table-column label="Logo" width="80">
        <template #default="{ row }">
          <img v-if="safeBrandLink(row.logoUrl, true)" :src="safeBrandLink(row.logoUrl, true)!" :alt="row.name" class="logo-thumb" loading="lazy" decoding="async" />
          <span v-else class="no-logo">—</span>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="品牌标识" min-width="180">
        <template #default="{ row }">
          <code class="brand-name">{{ row.name }}</code>
          <div v-if="row.displayName" class="brand-display">{{ row.displayName }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="country" label="国家/地区" width="140" />
      <el-table-column label="联系方式" min-width="240">
        <template #default="{ row }">
          <div v-if="row.salesContact" class="contact-row"><span class="tag">销售</span>{{ row.salesContact }}</div>
          <div v-if="row.techContact" class="contact-row"><span class="tag tech">技术</span>{{ row.techContact }}</div>
          <span v-if="!row.salesContact && !row.techContact" class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="官网" width="140">
        <template #default="{ row }">
          <a v-if="safeBrandLink(row.website)" :href="safeBrandLink(row.website)!" target="_blank" rel="noopener noreferrer" class="link-cell">访问 ↗</a>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="引用" width="160">
        <template #default="{ row }">
          <el-tag size="small" type="info">{{ row.hardwareCount }} 设备</el-tag>
          <el-tag size="small" type="success" style="margin-left: 4px;">{{ row.driverCount }} 驱动</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            :disabled="disabled || editVisible"
            @change="toggleEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)" :disabled="disabled || editVisible">编辑</el-button>
          <el-button link type="danger" @click="remove(row)" :disabled="disabled || editVisible">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="editVisible"
      :title="editMode === 'create' ? '新增品牌' : `编辑 — ${form.name}`"
      size="40%"
      direction="rtl"
    >
      <el-form :model="form" label-width="100px" label-position="right" class="form">
        <el-form-item label="品牌标识" prop="name">
          <el-input v-model="form.name" placeholder="跟硬件清单 vendor 字段一致, e.g. 诺瓦 NovaStar" :disabled="editMode === 'edit'" />
          <div class="hint">编辑模式下不能改, 改了会跟硬件清单脱钩</div>
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.displayName" placeholder="给用户看的友好名 (可选)" />
        </el-form-item>
        <el-form-item label="Logo URL">
          <el-input v-model="form.logoUrl" placeholder="https://... 或 /media/brand-logos/xxx.png" />
          <div v-if="safeBrandLink(form.logoUrl, true)" class="logo-preview">
            <img :src="safeBrandLink(form.logoUrl, true)!" alt="preview" />
          </div>
        </el-form-item>
        <el-form-item label="国家/地区">
          <el-input v-model="form.country" placeholder="中国 · 西安 / 美国" />
        </el-form-item>
        <el-form-item label="官网">
          <el-input v-model="form.website" placeholder="https://" />
        </el-form-item>
        <el-form-item label="销售联系">
          <el-input v-model="form.salesContact" type="textarea" :rows="2" placeholder="姓名 · 电话 · 邮箱" />
        </el-form-item>
        <el-form-item label="技术支持">
          <el-input v-model="form.techContact" type="textarea" :rows="2" placeholder="姓名 · 电话 · 工单系统 URL" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="4" placeholder="售后政策 / 报价文档链接 / 历史合作" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <span v-if="expectedRevision">配置版本 {{ expectedRevision }}</span>
        <el-button @click="refresh" :disabled="saving" :loading="loading">重新读取</el-button>
        <el-button type="primary" @click="submit" :loading="saving" :disabled="disabled">保存</el-button>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.brands-admin { padding: 16px 24px; }
.page-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 16px; gap: 16px;
}
.page-head h2 { margin: 0; font-size: 20px; }
.sub { color: var(--el-text-color-secondary); margin: 4px 0 0; font-size: 13px; }
.actions { display: flex; gap: 12px; align-items: center; }

.logo-thumb {
  width: 40px; height: 40px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--v2-ov-1);
  padding: 4px;
}
.no-logo, .muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.brand-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
}
.brand-display {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.contact-row {
  font-size: 12px;
  margin: 2px 0;
  display: flex; align-items: center; gap: 6px;
}
.tag {
  display: inline-block;
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 4px;
  background: rgba(76, 154, 255, 0.16);
  color: var(--el-color-primary);
  letter-spacing: 0.5px;
}
.tag.tech {
  background: rgba(224, 160, 48, 0.14);
  color: var(--el-color-warning);
}
.link-cell {
  color: var(--el-color-primary);
  text-decoration: none;
  font-size: 13px;
}
.link-cell:hover { text-decoration: underline; }

.form { padding: 0 24px; }
.hint {
  color: var(--el-text-color-secondary);
  font-size: 11px;
  margin-top: 2px;
}
.logo-preview {
  margin-top: 8px;
  padding: 12px;
  background: var(--v2-ov-1);
  border-radius: 6px;
  text-align: center;
}
.logo-preview img {
  max-width: 200px;
  max-height: 80px;
  object-fit: contain;
}
</style>
