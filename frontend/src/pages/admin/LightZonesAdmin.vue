<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
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
        z.gatewayCode.toLowerCase().includes(q) ||
        z.gatewayDisplayName.toLowerCase().includes(q),
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
  gatewayCode: '',
  daliGroup: 1,
  sortOrder: 100,
  icon: 'Lightbulb',
  description: '',
  enabled: true,
});

const rules: FormRules = {
  code: [{ required: true, message: 'code 必填, 业务唯一, e.g. 1f-front-hall', trigger: 'blur' }],
  name: [{ required: true, message: '显示名必填', trigger: 'blur' }],
  floor: [{ required: true, message: '楼层必填', trigger: 'blur' }],
  gatewayCode: [{ required: true, message: '必须关联一台 DALI 网关', trigger: 'change' }],
  daliGroup: [{ required: true, type: 'number', message: 'DALI 组号 1-16', trigger: 'blur' }],
};

function openCreate(): void {
  editMode.value = 'create';
  Object.assign(form, {
    id: undefined,
    code: '',
    name: '',
    floor: floorFilter.value || '1F',
    gatewayCode: gateways.value[0]?.code ?? '',
    daliGroup: 1,
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
    gatewayCode: row.gatewayCode,
    daliGroup: row.daliGroup,
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
      gatewayCode: form.gatewayCode,
      daliGroup: Number(form.daliGroup),
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
      <div>
        <h2>灯光分区</h2>
        <p class="sub">
          前台 LightingPage 的 zone 数据源. 一个 zone = (DALI 网关 + DALI 组号). 同一组号
          在不同网关上是物理不同的两束灯, 互不影响.
        </p>
      </div>
      <div class="actions">
        <el-select v-model="floorFilter" placeholder="全部楼层" clearable style="width: 140px;">
          <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
        </el-select>
        <el-input v-model="search" placeholder="搜索名称 / code / 网关" clearable style="width: 240px;" />
        <el-button type="primary" @click="openCreate" :disabled="gateways.length === 0">新增分区</el-button>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </header>

    <el-alert
      v-if="gateways.length === 0"
      type="warning"
      :closable="false"
      title="没有可用的 DALI 网关"
      description="先到 硬件清单 添加 category=dali-gateway 的硬件 (e.g. CY-DALI64A), 再回来添加灯光分区."
      show-icon
      style="margin-bottom: 16px;"
    />

    <el-table :data="filtered" v-loading="loading" stripe class="zones-table">
      <el-table-column prop="sortOrder" label="排序" width="56" align="center" />
      <el-table-column label="名称" min-width="150">
        <template #default="{ row }">
          <div class="name-cell">
            <span class="zone-name">{{ row.name }}</span>
            <code class="zone-code">{{ row.code }}</code>
            <div v-if="row.description" class="zone-desc">{{ row.description }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="floor" label="楼层" width="64" align="center" />
      <el-table-column label="DALI 网关" min-width="150">
        <template #default="{ row }">
          <div>{{ row.gatewayDisplayName }}</div>
          <code class="gw-code">
            {{ row.gatewayCode }}<span v-if="row.gatewaySlaveId !== null"> · slaveId={{ row.gatewaySlaveId }}</span>
          </code>
        </template>
      </el-table-column>
      <el-table-column label="DALI 组" width="96" align="center">
        <template #default="{ row }">
          <el-tag size="default" type="primary">GROUP {{ row.daliGroup }}</el-tag>
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
      <el-table-column label="操作" width="156" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="success"
            :loading="testingId === row.id"
            @click="testZone(row)"
            title="发 50% 亮度 → 等 1.2s → 关. 看灯有没有亮"
          >测试</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 测试结果对话框 -->
    <el-dialog v-model="testDialogOpen" title="分区测试结果" width="640px">
      <div v-if="testResult" class="test-result">
        <div class="kv-grid">
          <div class="kv-label">分区</div>
          <div class="kv-value">{{ testResult.zone.name }} <code class="muted">({{ testResult.zone.code }} #{{ testResult.zone.id }})</code></div>

          <div class="kv-label">关联网关</div>
          <div class="kv-value">{{ testResult.gateway.displayName }} <code class="muted">({{ testResult.gateway.code }})</code></div>

          <div class="kv-label">slaveId</div>
          <div class="kv-value">
            <code v-if="testResult.gateway.slaveId !== null" class="strong">{{ testResult.gateway.slaveId }}</code>
            <span v-else class="err">未解析出 — 检查硬件清单的 addressing JSON</span>
          </div>

          <div class="kv-label">DALI 组号</div>
          <div class="kv-value"><code class="strong">GROUP {{ testResult.daliGroup }}</code></div>

          <div class="kv-label">路由阶段</div>
          <div class="kv-value">
            <el-tag v-if="testResult.routing.ok" type="success" size="small">通过</el-tag>
            <el-tag v-else type="danger" size="small">失败: {{ testResult.routing.error }}</el-tag>
          </div>

          <template v-if="testResult.dispatch">
            <div class="kv-label">下发 50% on</div>
            <div class="kv-value">
              <el-tag v-if="testResult.dispatch.on.ok" type="success" size="small">{{ testResult.dispatch.on.durationMs }}ms</el-tag>
              <el-tag v-else type="danger" size="small">失败: {{ testResult.dispatch.on.error }}</el-tag>
              <el-tag v-if="testResult.dispatch.on.mock" type="warning" size="small" style="margin-left: 6px;">MOCK</el-tag>
            </div>

            <div class="kv-label">下发 0 off</div>
            <div class="kv-value">
              <el-tag v-if="testResult.dispatch.off.ok" type="success" size="small">{{ testResult.dispatch.off.durationMs }}ms</el-tag>
              <el-tag v-else type="danger" size="small">失败: {{ testResult.dispatch.off.error }}</el-tag>
              <el-tag v-if="testResult.dispatch.off.mock" type="warning" size="small" style="margin-left: 6px;">MOCK</el-tag>
            </div>
          </template>
        </div>
        <el-alert
          v-if="testResult.dispatch && (testResult.dispatch.on.mock || testResult.dispatch.off.mock)"
          type="warning"
          :closable="false"
          show-icon
          title="后端跑在 MOCK 模式"
          description="命令没真打到 modbus / DALI 网关. 灯不会亮. 检查 GK9000 后端 .env 的 MOCK_MODE 和 LIGHTING_ADAPTER_KIND."
          style="margin-top: 12px;"
        />
        <el-alert
          v-else-if="testResult.dispatch && testResult.dispatch.on.ok && testResult.dispatch.off.ok"
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
        <el-form-item label="DALI 网关" prop="gatewayCode">
          <el-select v-model="form.gatewayCode" placeholder="选 DALI 网关" style="width: 100%;">
            <el-option
              v-for="g in gateways"
              :key="g.code"
              :value="g.code"
              :label="`${g.name} · ${g.code}`"
            />
          </el-select>
          <div class="hint">从硬件清单 category=dali-gateway 拉</div>
        </el-form-item>
        <el-form-item label="DALI 组号" prop="daliGroup">
          <el-input-number v-model="form.daliGroup" :min="1" :max="16" controls-position="right" />
          <span class="hint inline">现场 CY-DALI64A 上的 group 编号 (1-16)</span>
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
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 16px; gap: 16px;
}
.page-head h2 { margin: 0; font-size: 20px; color: var(--v2-text-1); }
.sub { color: var(--v2-text-2); margin: 4px 0 0; font-size: 13px; max-width: 720px; line-height: 1.6; }
.actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

.name-cell { display: flex; flex-direction: column; gap: 3px; }
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
