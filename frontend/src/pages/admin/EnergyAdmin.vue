<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  energyService,
  type EnergyAssets,
  type TransformerAsset,
  type BuildingAsset,
  type ElevatorAsset,
} from '@/services/energy.service';

// P4 起：水电总览 / 逐表明细 / 缴费流水 / 欠费 / 控制记录已搬至前台 PWA「水电管理平台」
// （路由 /energy，按 energy:view/detail/export 权限点放行）。后台 /admin/energy 仅保留
// 园区能源台账（变压器 / 楼栋维护，模块 energy，后台要求 energy:ledger）。
const ZONE_OPTIONS = [
  { value: 'center', label: '展贸中心' },
  { value: 'phase1', label: '一期·智造区' },
  { value: 'phase2', label: '二期·研发区' },
  { value: 'future', label: '远期·科创区' },
] as const;
const FUNC_OPTIONS = [
  { value: 'exhibition', label: '展贸' },
  { value: 'plant', label: '工业厂房' },
  { value: 'office', label: '研发办公' },
  { value: 'support', label: '配套服务' },
  { value: 'dorm', label: '宿舍公寓' },
] as const;

const assetsLoading = ref(true);
const assetsError = ref<string | null>(null);
const assetsRevision = ref(0);
const assetsDirty = ref(false);
const assetsSaving = ref(false);
const assetsMsg = ref<string | null>(null);
const editTransformers = ref<TransformerAsset[]>([]);
const editBuildings = ref<BuildingAsset[]>([]);
const keepElevators = ref<ElevatorAsset[]>([]);

function markDirty(): void {
  assetsDirty.value = true;
  assetsMsg.value = null;
  assetsError.value = null;
}
async function loadAssets(): Promise<void> {
  assetsLoading.value = true;
  assetsError.value = null;
  try {
    const doc = await energyService.getAssets();
    assetsRevision.value = doc.revision;
    editTransformers.value = doc.value.transformers.map((t) => ({ ...t, feeds: [...t.feeds] }));
    editBuildings.value = doc.value.buildings.map((b) => ({ ...b }));
    keepElevators.value = doc.value.elevators.map((e) => ({ ...e }));
    assetsDirty.value = false;
  } catch (e) {
    assetsError.value = `台账加载失败：${(e as Error).message}`;
  } finally {
    assetsLoading.value = false;
  }
}
async function saveAssets(): Promise<void> {
  assetsSaving.value = true;
  assetsMsg.value = null;
  assetsError.value = null;
  try {
    const payload: EnergyAssets = {
      transformers: editTransformers.value,
      buildings: editBuildings.value,
      elevators: keepElevators.value,
    };
    const r = await energyService.saveAssets(payload, assetsRevision.value);
    assetsRevision.value = r.revision;
    assetsDirty.value = false;
    assetsMsg.value = `台账已保存（修订版本 r${r.revision}），大屏能源中心已更新。`;
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status;
    if (status === 409) {
      assetsError.value =
        '台账已被他人修改（版本冲突）。请点击「重新加载」获取最新版本后再编辑，避免覆盖他人数据。';
    } else {
      assetsError.value = `保存失败：${(e as Error).message}`;
    }
  } finally {
    assetsSaving.value = false;
  }
}

onMounted(() => {
  void loadAssets();
});
</script>

<template>
  <section class="page energy-admin">
    <header class="en-hero">
      <h2>园区能源台账</h2>
    </header>

    <section class="en-card">
      <div class="en-card-head">
        <h3>园区能源台账 <span class="assets-rev">修订版本 r{{ assetsRevision }}</span></h3>
        <div class="assets-actions">
          <button class="assets-btn" :disabled="assetsSaving" @click="loadAssets">重新加载</button>
          <button class="assets-btn primary" :disabled="!assetsDirty || assetsSaving" @click="saveAssets">
            {{ assetsSaving ? '保存中…' : '保存台账' }}
          </button>
        </div>
      </div>
      <p class="assets-hint">
        变压器、楼栋为规划/台账口径，可直接修改名称、所属分区、容量或建筑面积，保存后大屏能源中心即时更新；接入真实电表后以计量为准。
      </p>

      <div v-if="assetsLoading" class="en-state">台账加载中…</div>
      <div v-else-if="assetsError" class="en-state error">
        {{ assetsError }}
        <button class="en-retry" @click="loadAssets">重试</button>
      </div>
      <div v-else class="assets-grid">
        <div class="assets-col">
          <h4>变压器（{{ editTransformers.length }} 台）</h4>
          <div class="assets-scroll">
            <div v-for="t in editTransformers" :key="t.code" class="asset-row">
              <span class="ar-code">{{ t.code }}</span>
              <input v-model="t.name" @input="markDirty" class="ar-name" placeholder="名称" />
              <select v-model="t.zone" @change="markDirty" class="ar-zone" title="所属分区">
                <option v-for="z in ZONE_OPTIONS" :key="z.value" :value="z.value">{{ z.label }}</option>
              </select>
              <input type="number" v-model.number="t.capacityKva" @input="markDirty" class="ar-num" min="50" step="50" />
              <span class="ar-unit">kVA</span>
            </div>
          </div>
        </div>
        <div class="assets-col">
          <h4>楼栋（{{ editBuildings.length }} 栋）</h4>
          <div class="assets-scroll">
            <div v-for="b in editBuildings" :key="b.code" class="asset-row">
              <span class="ar-code">{{ b.code }}</span>
              <input v-model="b.name" @input="markDirty" class="ar-name" placeholder="名称" />
              <select v-model="b.zone" @change="markDirty" class="ar-zone" title="所属分区">
                <option v-for="z in ZONE_OPTIONS" :key="z.value" :value="z.value">{{ z.label }}</option>
              </select>
              <select v-model="b.function" @change="markDirty" class="ar-func" title="功能类型">
                <option v-for="f in FUNC_OPTIONS" :key="f.value" :value="f.value">{{ f.label }}</option>
              </select>
              <input type="number" v-model.number="b.areaM2" @input="markDirty" class="ar-num" min="50" step="100" />
              <span class="ar-unit">㎡</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="assetsMsg" class="assets-msg ok">{{ assetsMsg }}</div>
    </section>
  </section>
</template>

<style scoped>
.energy-admin {
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--v2-text-2);
  min-width: 0;
}
.en-hero h2 {
  margin: 0;
  font-size: 20px;
  color: var(--v2-text-1);
}

/* 园区台账 */
.en-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg, 14px);
  padding: 16px;
  box-shadow: var(--v2-elev-1);
}
.en-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.en-card-head h3 {
  margin: 0;
  font-size: 15px;
  color: var(--v2-text-1);
}
.assets-rev {
  margin-left: 10px;
  font-size: 12px;
  font-weight: 400;
  color: var(--v2-text-3);
}
.assets-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.assets-btn {
  padding: 7px 14px;
  border-radius: var(--v2-r-md, 9px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  font-size: 12px;
  cursor: pointer;
}
.assets-btn.primary {
  background: var(--v2-primary-fill);
  color: var(--v2-on-primary, #fff);
  border-color: var(--v2-primary-fill);
}
.assets-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.assets-hint {
  margin: 10px 0 12px;
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.6;
}
.assets-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: 16px;
}
.assets-col h4 {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--v2-text-1);
}
.assets-scroll {
  max-height: 340px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 4px;
}
.asset-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.ar-code {
  width: 40px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--v2-text-3);
  font-variant-numeric: tabular-nums;
}
.ar-name {
  flex: 1.4;
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-inset-bg);
  color: var(--v2-text-1);
  font-size: 12px;
}
.ar-zone,
.ar-func {
  flex: 1;
  min-width: 0;
  padding: 6px 4px;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-inset-bg);
  color: var(--v2-text-2);
  font-size: 11px;
}
.ar-num {
  width: 64px;
  flex-shrink: 0;
  padding: 6px;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-inset-bg);
  color: var(--v2-text-1);
  font-size: 12px;
}
.ar-unit {
  font-size: 10px;
  color: var(--v2-text-3);
  flex-shrink: 0;
}
.assets-msg {
  margin-top: 10px;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: var(--v2-r-md, 9px);
}
.assets-msg.ok {
  background: var(--v2-success-soft, rgba(52, 211, 153, 0.15));
  color: var(--v2-success, #34d399);
}
.en-state {
  padding: 36px;
  text-align: center;
  color: var(--v2-text-3);
}
.en-state.error {
  color: var(--v2-danger, #f87171);
}
.en-retry {
  display: block;
  margin: 12px auto 0;
  padding: 8px 18px;
  border-radius: var(--v2-r-md, 9px);
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-1);
  cursor: pointer;
}

@media (max-width: 860px) {
  .assets-grid {
    grid-template-columns: 1fr;
  }
}
</style>
