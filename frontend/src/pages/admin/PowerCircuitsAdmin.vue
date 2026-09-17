<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { type FormInstance, type FormRules } from 'element-plus';
import { usePowerConfigEditor } from '@/features/usePowerConfigEditor';
const { list, loading, saving, needsReload, editVisible, editMode, form, refresh, openCreate, openEdit, submit: saveConfig, remove, toggleEnabled } = usePowerConfigEditor();
const CATEGORIES = [
  { value: 'lighting', label: '照明' }, { value: 'socket', label: '插座' },
  { value: 'hvac', label: '空调' }, { value: 'led', label: 'LED 大屏' },
  { value: 'audio', label: '音响' }, { value: 'misc', label: '其它' },
];
const search = ref(''), floorFilter = ref('');
const formRef = ref<FormInstance>();
const floorOptions = computed(() => [...new Set(list.value.map(row => row.floor))].sort());
const filtered = computed(() => list.value.filter(row => (!floorFilter.value || row.floor === floorFilter.value) &&
  (!search.value.trim() || [row.name, row.code, row.gatewayCode || ''].some(value => value.toLowerCase().includes(search.value.trim().toLowerCase())))));
const rules: FormRules = {
  code: [{ required: true, message: 'code 必填', trigger: 'blur' }],
  name: [{ required: true, message: '显示名必填', trigger: 'blur' }],
  floor: [{ required: true, message: '楼层必填', trigger: 'blur' }],
};
async function submit() {
  if (!formRef.value || saving.value || loading.value || needsReload.value) return;
  if (await formRef.value.validate().catch(() => false)) await saveConfig();
}
onMounted(refresh);
</script>

<template>
  <section class="circuits-admin">
    <header class="page-head">
      <h2>电源回路</h2>
      <el-select v-model="floorFilter" placeholder="全部楼层" clearable class="floor-sel">
        <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
      </el-select>
      <el-input v-model="search" placeholder="搜索名称 / code / 继电器" clearable class="search-inp" />
      <el-button type="primary" class="head-add" :disabled="loading || saving || needsReload" @click="openCreate(floorFilter || '1F')">新增回路</el-button>
      <el-button @click="refresh" :loading="loading" :disabled="saving">重新读取</el-button>
    </header>
    <p class="sub">
      此页只管理回路配置，保存、启用和删除均不发送通断电命令，也不等待硬件读数。实时状态请在电源控制页查看。
    </p>
    <el-alert v-if="needsReload" title="尚未取得可保存的最新版本。草稿已保留，请重新读取。" type="warning" :closable="false" />

    <AppSkeleton v-if="loading && filtered.length === 0" variant="table" :rows="8" />
    <el-table v-else :data="filtered" v-loading="loading" stripe class="circuits-table">
      <el-table-column label="名称" min-width="150">
        <template #default="{ row }">
          <div class="name-cell">
            <div class="name-row">
              <span class="circuit-name">{{ row.name }}</span>
              <span v-if="row.floor" class="floor-tag">{{ row.floor }}</span>
            </div>
            <code class="circuit-code">{{ row.code }}</code>
            <div v-if="row.description" class="circuit-desc">{{ row.description }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="76" align="center">
        <template #default="{ row }">
          <el-tag size="default" :type="row.category === 'misc' ? 'info' : 'primary'">
            {{ CATEGORIES.find(c => c.value === row.category)?.label ?? row.category }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="继电器" min-width="120">
        <template #default="{ row }">
          <code v-if="row.gatewayCode" class="gw-code">{{ row.gatewayCode }} · CH{{ row.relayChannel ?? '?' }}</code>
          <span v-else class="muted">未配置</span>
        </template>
      </el-table-column>
      <el-table-column label="额定" width="108">
        <template #default="{ row }">
          <code class="gw-code">{{ row.ratedVoltage }}V · {{ row.ratedCurrent }}A · {{ row.ratedPower }}W</code>
        </template>
      </el-table-column>
      <el-table-column label="配置版本" width="90" align="center">
        <template #default="{ row }">
          <el-tag size="default">{{ row.configRevision }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="84" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            :disabled="loading || saving || needsReload"
            @change="toggleEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :disabled="loading || saving || needsReload" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" :disabled="loading || saving || needsReload" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="editVisible"
      :title="editMode === 'create' ? '新增电源回路' : `编辑 — ${form.name}`"
      size="40%" direction="rtl"
    >
      <el-alert v-if="needsReload" title="草稿已保留；复制需要保留的内容后，重新读取最新配置。" type="warning" :closable="false" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" label-position="right" class="form">
        <el-form-item label="业务 code" prop="code">
          <el-input v-model="form.code" :disabled="editMode === 'edit'" placeholder="e.g. 1f-main, 2f-hvac" />
        </el-form-item>
        <el-form-item label="显示名" prop="name">
          <el-input v-model="form.name" placeholder="e.g. 一层总闸" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input v-model="form.floor" placeholder="1F / 2F" style="width: 160px;" />
        </el-form-item>
        <el-form-item label="类型" prop="category">
          <el-select v-model="form.category" style="width: 200px;">
            <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="继电器 code">
          <el-input v-model="form.gatewayCode" placeholder="对应 硬件清单 power-relay 设备 code, e.g. RELAY-1F-1" />
          <div class="hint">此项决定后续控制目标，必须依据现场接线配置；保存本身不操作设备。</div>
        </el-form-item>
        <el-form-item label="通道号">
          <el-input-number v-model="form.relayChannel" :min="1" :max="32" controls-position="right" />
          <span class="hint inline">继电器的第几路 (1-32)</span>
        </el-form-item>
        <el-form-item label="电表地址">
          <el-input-number v-model="form.meterAddress" :min="1" :max="247" controls-position="right" />
          <span class="hint inline">Modbus 电能表从机号, 留空走 mock</span>
        </el-form-item>
        <el-form-item label="额定电压">
          <el-input-number v-model="form.ratedVoltage" :min="0" :max="600" controls-position="right" />
          <span class="hint inline">V (220 / 380)</span>
        </el-form-item>
        <el-form-item label="额定电流">
          <el-input-number v-model="form.ratedCurrent" :min="0" :max="200" controls-position="right" />
          <span class="hint inline">A (开关额定)</span>
        </el-form-item>
        <el-form-item label="额定功率">
          <el-input-number v-model="form.ratedPower" :min="0" :max="100000" controls-position="right" />
          <span class="hint inline">W, 0 = 按电压×电流估算</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :max="9999" controls-position="right" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button @click="refresh" :disabled="saving || loading">重新读取</el-button>
        <el-button type="primary" :loading="saving" :disabled="loading || saving || needsReload" @click="submit">保存</el-button>
      </template>
    </el-drawer>
  </section>
</template>

<style scoped>
.circuits-admin { padding: 16px 24px; color: var(--v2-text-1); }
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
  background: rgba(76, 154, 255, 0.12); color: #67E8F9;
  white-space: nowrap; flex-shrink: 0;
}
.circuit-name { font-weight: 600; color: var(--v2-text-1); font-size: 14px; letter-spacing: 0.3px; }
.circuit-code {
  font-size: 11.5px;
  color: var(--v2-text-2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.4px;
}
.circuit-desc { font-size: 11.5px; color: var(--v2-text-2); font-style: italic; }
.gw-code {
  font-size: 11.5px;
  color: var(--v2-text-2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.muted { color: var(--v2-text-3); font-size: 12px; }

.form { padding: 16px 0; }
.hint { font-size: 12px; color: var(--v2-text-2); margin-top: 4px; line-height: 1.5; }
.hint.inline { margin-left: 8px; }
</style>
