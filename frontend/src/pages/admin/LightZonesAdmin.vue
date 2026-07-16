<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  lightZonesService,
  type LightZoneView,
  type LightZoneUpsertDto,
  type LightZoneTestResult,
} from '@/services/light-zones.service';
import { adminHardwareService } from '@/services/admin.service';
import type { HardwareUnit } from '@/types/api';

/**
 * Sprint E (2026-05-31) — 灯光分区后台维护
 *
 * 跟以前的差异:
 *   - 灯光分区不再硬编码在 LightingPage.vue, 改成 DB 表 light_zone
 *   - 业主自己能在后台加/改/删 zone, 不再需要找开发改代码重新部署
 *
 * 关键字段:
 *   - gatewayCode: 必须对应 hardware_unit.code (category=dali-gateway). 下拉
 *     菜单实时从硬件清单拉, 删除/改了 gateway code 这里能立刻看到
 *   - daliGroup: DALI 组号 1-16, 跟现场 CY-DALI64A 网关上配的 group 一致
 *
 * 路由后果: 业主创建一个 zone {gatewayCode: GW-DALI-2, daliGroup: 3} 后,
 * 前台 LightingPage 点这个 zone 的"开"按钮, backend 会直接调 GW-DALI-2 网关
 * (slaveId=2) 的 group 3, 跟"GW-DALI-1 的 group 3"是两束灯, 不冲突.
 */

const list = ref<LightZoneView[]>([]);
const loading = ref(false);
const search = ref('');
const floorFilter = ref<string>('');
const gateways = ref<HardwareUnit[]>([]);

const floorOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const z of list.value) set.add(z.floor);
  return Array.from(set).sort();
});

const filtered = computed<LightZoneView[]>(() => {
  let rows = list.value;
  if (floorFilter.value) {
    rows = rows.filter((z) => z.floor === floorFilter.value);
  }
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    rows = rows.filter(
      (z) =>
        z.name.toLowerCase().includes(q) ||
        z.code.toLowerCase().includes(q) ||
        z.groups.some((g) => g.gatewayCode.toLowerCase().includes(q)) ||
        z.groups.some((g) => g.gatewayDisplayName.toLowerCase().includes(q)),
    );
  }
  return rows;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [zones, hwPage] = await Promise.all([
      lightZonesService.list(true),
      adminHardwareService.list({ category: 'dali-gateway' }),
    ]);
    list.value = zones;
    gateways.value = hwPage.list;
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

// ============ 新增/编辑 drawer ============
const editVisible = ref(false);
const editMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();

interface FormState extends LightZoneUpsertDto { id?: number }
const form = reactive<FormState>({
  code: '',
  name: '',
  floor: '1F',
  sortOrder: 100,
  icon: 'Lightbulb',
  description: '',
  enabled: true,
});

const rules: FormRules = {
  code: [{ required: true, message: 'code 必填, 业务唯一, e.g. 1f-front-hall', trigger: 'blur' }],
  name: [{ required: true, message: '显示名必填', trigger: 'blur' }],
  floor: [{ required: true, message: '楼层必填', trigger: 'blur' }],
};

function openCreate(): void {
  editMode.value = 'create';
  Object.assign(form, {
    id: undefined,
    code: '',
    name: '',
    floor: floorFilter.value || '1F',
    sortOrder: 100,
    icon: 'Lightbulb',
    description: '',
    enabled: true,
  });
  editVisible.value = true;
}

function openEdit(row: LightZoneView): void {
  editMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    code: row.code,
    name: row.name,
    floor: row.floor,
    sortOrder: row.sortOrder,
    icon: row.icon ?? 'Lightbulb',
    description: row.description ?? '',
    enabled: row.enabled,
  });
  editVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    const payload: LightZoneUpsertDto = {
      code: form.code.trim(),
      name: form.name.trim(),
      floor: form.floor.trim(),
      sortOrder: Number(form.sortOrder ?? 100),
      icon: (form.icon || 'Lightbulb').trim() || null,
      description: (form.description || '').trim() || null,
      enabled: form.enabled ?? true,
    };
    try {
      if (editMode.value === 'create') {
        await lightZonesService.create(payload);
        ElMessage.success('已新增灯光分区');
      } else if (form.id) {
        await lightZonesService.update(form.id, payload);
        ElMessage.success('已更新灯光分区');
      }
      editVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error(`保存失败: ${(err as Error).message}`);
    }
  });
}

async function remove(row: LightZoneView): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除灯光分区 "${row.name}" (${row.code})? 删除后前台 LightingPage 不再显示, 已发的命令历史保留.`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch { return; }
  try {
    await lightZonesService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error(`删除失败: ${(err as Error).message}`);
  }
}

async function toggleEnabled(row: LightZoneView): Promise<void> {
  try {
    await lightZonesService.update(row.id, { enabled: !row.enabled });
    await refresh();
  } catch (err) {
    ElMessage.error(`切换状态失败: ${(err as Error).message}`);
  }
}

// ============ 测试此分区 ============
const testingId = ref<number | null>(null);
const testResult = ref<LightZoneTestResult | null>(null);
const testDialogOpen = ref(false);

async function testZone(row: LightZoneView): Promise<void> {
  testingId.value = row.id;
  testResult.value = null;
  try {
    const result = await lightZonesService.test(row.id);
    testResult.value = result;
    testDialogOpen.value = true;
  } catch (err) {
    ElMessage.error(`测试失败: ${(err as Error).message}`);
  } finally {
    testingId.value = null;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="zones-admin">
    <header class="page-head">
      <h2>灯光分区</h2>
      <el-select v-model="floorFilter" placeholder="全部楼层" clearable class="floor-sel">
        <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
      </el-select>
      <el-input v-model="search" placeholder="搜索名称 / code / 网关" clearable class="search-inp" />
      <el-button type="primary" class="head-add" @click="openCreate" :disabled="gateways.length === 0">新增分区</el-button>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </header>
    <p class="sub">
      前台 LightingPage 的 zone 数据源. 一个 zone = (DALI 网关 + DALI 组号). 同一组号
      在不同网关上是物理不同的两束灯, 互不影响.
    </p>

    <el-alert
      v-if="gateways.length === 0"
      type="warning"
      :closable="false"
      title="没有可用的 DALI 网关"
      description="先到 硬件清单 添加 category=dali-gateway 的硬件 (e.g. CY-DALI64A), 再回来添加灯光分区."
      show-icon
      style="margin-bottom: 16px;"
    />

    <AppSkeleton v-if="loading && filtered.length === 0" variant="table" :rows="8" />
    <el-table v-else :data="filtered" v-loading="loading" stripe class="zones-table">
      <el-table-column label="名称" min-width="160">
        <template #default="{ row }">
          <div class="name-cell">
            <div class="name-row">
              <span class="zone-name">{{ row.name }}</span>
              <span v-if="row.floor" class="floor-tag">{{ row.floor }}</span>
            </div>
            <code class="zone-code">{{ row.code }}</code>
            <div v-if="row.description" class="zone-desc">{{ row.description }}</div>
          </div>
        </template>
      </el-table-column>
      <!-- 一个分区可含多组、且可跨网关, 所以组号必须连网关一起显示 -->
      <el-table-column label="包含灯组" min-width="240">
        <template #default="{ row }">
          <span v-if="row.groups.length === 0" class="muted">未分配灯组 — 去灯光页「编组」里放</span>
          <el-tag
            v-for="g in row.groups"
            :key="g.id"
            size="default"
            type="primary"
            style="margin: 2px 4px 2px 0;"
          >{{ g.gatewayDisplayName }} · {{ g.daliGroup }}组</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="84" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            @change="toggleEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <span class="acts">
            <el-button
              link
              type="success"
              :loading="testingId === row.id"
              @click="testZone(row)"
              title="发 50% 亮度 → 等 1.2s → 关. 看灯有没有亮"
            >测试</el-button>
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="remove(row)">删除</el-button>
          </span>
        </template>
      </el-table-column>
    </el-table>

    <!-- 测试结果对话框 -->
    <el-dialog v-model="testDialogOpen" title="分区测试结果" width="640px">
      <div v-if="testResult" class="test-result">
        <div class="kv-grid">
          <div class="kv-label">分区</div>
          <div class="kv-value">{{ testResult.zone.name }} <code class="muted">({{ testResult.zone.code }} #{{ testResult.zone.id }})</code></div>

          <div class="kv-label">路由阶段</div>
          <div class="kv-value">
            <el-tag v-if="testResult.routing.ok" type="success" size="small">通过</el-tag>
            <el-tag v-else type="danger" size="small">失败: {{ testResult.routing.error }}</el-tag>
          </div>

          <!-- 逐组一行: 哪组没亮一眼看到 -->
          <template v-for="d in testResult.dispatch ?? []" :key="`${d.gateway.code}-${d.daliGroup}`">
            <div class="kv-label">{{ d.gateway.code }} · {{ d.daliGroup }}组</div>
            <div class="kv-value">
              <el-tag v-if="d.on.ok" type="success" size="small">开 {{ d.on.durationMs }}ms</el-tag>
              <el-tag v-else type="danger" size="small">开失败: {{ d.on.error }}</el-tag>
              <el-tag v-if="d.off.ok" type="success" size="small" style="margin-left: 6px;">关 {{ d.off.durationMs }}ms</el-tag>
              <el-tag v-else type="danger" size="small" style="margin-left: 6px;">关失败: {{ d.off.error }}</el-tag>
              <el-tag v-if="d.on.mock || d.off.mock" type="warning" size="small" style="margin-left: 6px;">MOCK</el-tag>
            </div>
          </template>
        </div>
        <el-alert
          v-if="testResult.dispatch?.some((d) => d.on.mock || d.off.mock)"
          type="warning"
          :closable="false"
          show-icon
          title="后端跑在 MOCK 模式"
          description="命令没真打到 modbus / DALI 网关. 灯不会亮. 检查 GK9000 后端 .env 的 MOCK_MODE 和 LIGHTING_ADAPTER_KIND."
          style="margin-top: 12px;"
        />
        <el-alert
          v-else-if="testResult.dispatch?.length && testResult.dispatch.every((d) => d.on.ok && d.off.ok)"
          type="success"
          :closable="false"
          show-icon
          title="命令已下发到硬件"
          description="如果灯仍未亮, 可能是: (1) DALI 短地址没加入这个 group  (2) 灯电源未供电  (3) gateway 与现场实际 slaveId 不一致"
          style="margin-top: 12px;"
        />
      </div>
    </el-dialog>

    <el-drawer
      v-model="editVisible"
      :title="editMode === 'create' ? '新增灯光分区' : `编辑 — ${form.name}`"
      size="40%"
      direction="rtl"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" label-position="right" class="form">
        <el-form-item label="业务 code" prop="code">
          <el-input v-model="form.code" placeholder="e.g. 1f-front-hall, 2f-test-a" :disabled="editMode === 'edit'" />
          <div class="hint">业务唯一, 编辑模式下不能改, 用于 seed / 升级</div>
        </el-form-item>
        <el-form-item label="显示名" prop="name">
          <el-input v-model="form.name" placeholder="e.g. 一层前厅 / 园区展示" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input v-model="form.floor" placeholder="1F / 2F / 3F / 室外" style="width: 160px;" />
          <span class="hint inline">前台 LightingPage 按这个分 tab</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :max="9999" controls-position="right" />
          <span class="hint inline">同楼层内升序排列, 默认 100</span>
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="form.icon" placeholder="lucide 图标名, 默认 Lightbulb" />
          <div class="hint">支持 Lightbulb / Sparkles / Sun / Moon 等</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" :rows="3" placeholder="施工说明 / 联系人 / 调试历史" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.zones-admin { padding: 16px 24px; color: var(--v2-text-1); }
.page-head {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; margin-bottom: 10px;
}
.page-head h2 { margin: 0 6px 0 0; font-size: 20px; color: var(--v2-text-1); white-space: nowrap; }
.floor-sel { width: 120px; }
.search-inp { width: 220px; }
.head-add { margin-left: auto; }
.sub { color: var(--v2-text-2); margin: 0 0 14px; font-size: 13px; max-width: 720px; line-height: 1.6; }

.name-cell { display: flex; flex-direction: column; gap: 3px; }
.name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.floor-tag {
  font-size: 11px; font-weight: 500;
  padding: 0 7px; line-height: 18px; border-radius: 9px;
  background: rgba(0, 229, 255, 0.12); color: #67E8F9;
  white-space: nowrap; flex-shrink: 0;
}
/* 操作列按钮强制单行, 不换行 */
.acts { display: inline-flex; align-items: center; white-space: nowrap; }
.zone-name {
  font-weight: 600;
  color: var(--v2-text-1);
  font-size: 14px;
  letter-spacing: 0.3px;
}
.zone-code {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  letter-spacing: 0.4px;
}
.zone-desc {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--v2-text-2);
  font-style: italic;
}
.gw-code {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  letter-spacing: 0.4px;
  display: block;
  margin-top: 2px;
}

.form { padding: 16px 0; }
.hint { font-size: 12px; color: var(--v2-text-2); margin-top: 4px; line-height: 1.5; }
.hint.inline { margin-left: 8px; }

/* 测试结果对话框 */
.test-result { padding: 4px 0; }
.kv-grid {
  display: grid;
  grid-template-columns: 120px 1fr;
  row-gap: 10px;
  column-gap: 16px;
  font-size: 13px;
  align-items: center;
}
.kv-label { color: var(--el-text-color-secondary); }
.kv-value { color: var(--el-text-color-primary); }
.kv-value code { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.kv-value code.strong { color: var(--el-color-primary); font-weight: 600; }
.kv-value code.muted { color: var(--el-text-color-secondary); margin-left: 6px; font-size: 11px; }
.kv-value .err { color: var(--el-color-danger); font-size: 12px; }
</style>
