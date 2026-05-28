<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { driverService, type DriverTemplate } from '@/services/driver.service';

const list = ref<DriverTemplate[]>([]);
const loading = ref(false);
const selected = ref<DriverTemplate | null>(null);
const drawerVisible = ref(false);

const categoryFilter = ref<string>('');
const search = ref<string>('');

const filtered = computed<DriverTemplate[]>(() => {
  let rows = list.value;
  if (categoryFilter.value) rows = rows.filter((d) => d.category === categoryFilter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    rows = rows.filter(
      (d) =>
        d.kind.toLowerCase().includes(q) ||
        d.displayName.toLowerCase().includes(q) ||
        d.vendor.toLowerCase().includes(q),
    );
  }
  return rows;
});

const categories = computed<string[]>(() => {
  const set = new Set(list.value.map((d) => d.category));
  return Array.from(set).sort();
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    list.value = await driverService.list();
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function openDetail(row: DriverTemplate): void {
  selected.value = row;
  drawerVisible.value = true;
}

async function remove(row: DriverTemplate): Promise<void> {
  if (row.builtin) {
    ElMessage.warning('代码内置的 driver 不能删除, 只能删 UI 创建的');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除驱动模板 "${row.displayName}" (kind=${row.kind})?`,
      '确认删除',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await driverService.remove(row.kind);
    ElMessage.success('删除成功');
    await refresh();
  } catch (err) {
    ElMessage.error(`删除失败: ${(err as Error).message}`);
  }
}

onMounted(refresh);
</script>

<template>
  <section class="drivers-admin">
    <header class="page-head">
      <div>
        <h2>驱动模板</h2>
        <p class="sub">代码内置 driver + UI 创建的扩展模板. 实例化硬件时从这里选驱动.</p>
      </div>
      <div class="actions">
        <el-input v-model="search" placeholder="搜索 kind / 名字 / 厂商" clearable style="width: 220px;" />
        <el-select v-model="categoryFilter" placeholder="按品类筛选" clearable style="width: 180px;">
          <el-option v-for="c in categories" :key="c" :value="c" :label="c" />
        </el-select>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </header>

    <el-table :data="filtered" v-loading="loading" stripe @row-click="openDetail" class="drivers-table">
      <el-table-column prop="kind" label="kind" width="160" />
      <el-table-column prop="displayName" label="显示名" min-width="240" />
      <el-table-column prop="vendor" label="厂商" width="160" />
      <el-table-column prop="category" label="品类" width="140" />
      <el-table-column prop="protocol" label="协议" width="180" />
      <el-table-column label="能力" min-width="280">
        <template #default="{ row }">
          <el-tag
            v-for="cap in row.capabilities.slice(0, 4)"
            :key="cap"
            size="small"
            class="cap-tag"
            type="info"
          >
            {{ cap }}
          </el-tag>
          <span v-if="row.capabilities.length > 4" class="more">+{{ row.capabilities.length - 4 }}</span>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.builtin" type="success" size="small">代码</el-tag>
          <el-tag v-else type="warning" size="small">UI</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="!row.builtin" type="danger" link @click.stop="remove(row)">删除</el-button>
          <span v-else class="muted">内置</span>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="drawerVisible"
      :title="selected?.displayName ?? '驱动详情'"
      size="40%"
      direction="rtl"
    >
      <div v-if="selected" class="detail">
        <dl>
          <dt>kind</dt><dd><code>{{ selected.kind }}</code></dd>
          <dt>厂商</dt><dd>{{ selected.vendor }}</dd>
          <dt>品类</dt><dd>{{ selected.category }}</dd>
          <dt>协议族</dt><dd>{{ selected.protocol }}</dd>
          <dt>能力</dt>
          <dd>
            <el-tag v-for="cap in selected.capabilities" :key="cap" size="small" class="cap-tag">
              {{ cap }}
            </el-tag>
          </dd>
          <dt>默认 addressing</dt>
          <dd>
            <pre v-if="selected.defaultAddressing">{{ JSON.stringify(selected.defaultAddressing, null, 2) }}</pre>
            <span v-else class="muted">(无)</span>
          </dd>
          <dt>实例化参数 schema</dt>
          <dd>
            <div v-if="selected.paramSchema" class="schema-grid">
              <div v-for="(field, key) in selected.paramSchema" :key="key" class="schema-row">
                <span class="schema-key">{{ key }}</span>
                <span class="schema-meta">
                  {{ field.label }} · {{ field.type }}
                  <span v-if="field.required" class="req">必填</span>
                  <span v-if="field.default !== undefined">默认: {{ field.default }}</span>
                </span>
              </div>
            </div>
            <span v-else class="muted">(无)</span>
          </dd>
          <dt>备注</dt><dd>{{ selected.remark || '—' }}</dd>
        </dl>
      </div>
    </el-drawer>
  </section>
</template>

<style scoped>
.drivers-admin { padding: 16px 24px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 16px; }
.page-head h2 { margin: 0; font-size: 20px; }
.sub { color: var(--el-text-color-secondary); margin: 4px 0 0; font-size: 13px; }
.actions { display: flex; gap: 12px; align-items: center; }
.drivers-table :deep(.el-table__row) { cursor: pointer; }
.cap-tag { margin-right: 4px; margin-bottom: 4px; }
.more { color: var(--el-text-color-secondary); font-size: 12px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.detail dl { display: grid; grid-template-columns: 100px 1fr; gap: 12px 16px; padding: 16px 24px; }
.detail dt { color: var(--el-text-color-secondary); font-size: 13px; }
.detail dd { margin: 0; }
.detail pre { background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 6px; font-size: 12px; }
.schema-grid { display: flex; flex-direction: column; gap: 8px; }
.schema-row { display: flex; gap: 12px; font-size: 13px; }
.schema-key { font-family: monospace; min-width: 140px; color: var(--el-color-primary); }
.schema-meta { color: var(--el-text-color-secondary); }
.req { color: var(--el-color-danger); margin-left: 6px; font-size: 11px; }
</style>
