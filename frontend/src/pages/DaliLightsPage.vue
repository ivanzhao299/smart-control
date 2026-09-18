<script setup lang="ts">
// DALI 单灯调试 —— 现场工程师: 扫描 → 认灯(闪烁) → 命名 → 分组 → 场景。
// 纯软件层, 灯里不写东西。手机/平板友好: 卡片网格自适应, 大点击区, 底部操作条。
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  ArrowLeft, Lightbulb, ScanLine, Activity, Zap, Plus, X, Check,
} from 'lucide-vue-next';
import { api } from '@/services/http';
import { useAdminUnlock } from '@/composables/useAdminUnlock';

interface DaliLight {
  id: number;
  gatewayCode: string;
  shortAddr: number;
  name: string | null;
  zoneCode: string | null;
  online: boolean;
  fault: boolean;
}
interface Gateway { code: string; slaveId: number }
interface Zone { code: string; name: string; floor?: string | null }
interface SceneItem { targetType: string; targetRef: string; on: boolean; brightness: number | null; kelvin: number | null }
interface Scene { code: string; name: string; items?: SceneItem[] }

const router = useRouter();
const { ensureAdmin } = useAdminUnlock();
const tab = ref<'lights' | 'zones' | 'scenes'>('lights');

const lights = ref<DaliLight[]>([]);
const gateways = ref<Gateway[]>([]);
const zones = ref<Zone[]>([]);
const scenes = ref<Scene[]>([]);
const scanning = ref(false);
const loading = ref(false);
const selectedId = ref<number | null>(null);
const gatewayFilter = ref<string>('');

// 分配分区对话框: 下拉选已有分区 + 没有就当场新建、建完立即选中 (不再手输分区名, 免得对不上)
const zoneDlg = ref<{ open: boolean; light: DaliLight | null; picked: string | null; creating: boolean; newName: string; busy: boolean }>({
  open: false, light: null, picked: null, creating: false, newName: '', busy: false,
});

const selected = computed(() => lights.value.find((l) => l.id === selectedId.value) ?? null);
const shownLights = computed(() =>
  gatewayFilter.value ? lights.value.filter((l) => l.gatewayCode === gatewayFilter.value) : lights.value,
);
const onlineCount = computed(() => lights.value.filter((l) => l.online).length);
const faultCount = computed(() => lights.value.filter((l) => l.fault).length);
const unassigned = computed(() => lights.value.filter((l) => !l.zoneCode));

function zoneName(code: string | null): string {
  if (!code) return '';
  return zones.value.find((z) => z.code === code)?.name ?? code;
}
function lightsInZone(code: string): DaliLight[] {
  return lights.value.filter((l) => l.zoneCode === code);
}
function label(l: DaliLight): string {
  return l.name?.trim() || `#${l.shortAddr}`;
}

async function loadAll(): Promise<void> {
  loading.value = true;
  try {
    const [gw, ls, zs, sc] = await Promise.all([
      api.get<Gateway[]>('/dali-lights/gateways'),
      api.get<DaliLight[]>('/dali-lights'),
      api.get<Zone[]>('/light-zones').catch(() => []),
      api.get<Scene[]>('/dali-lights/scenes'),
    ]);
    gateways.value = gw;
    lights.value = ls;
    zones.value = Array.isArray(zs) ? zs : [];
    scenes.value = sc;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

async function scan(): Promise<void> {
  scanning.value = true;
  try {
    const res = await api.post<{ found: number; lights: DaliLight[] }>('/dali-lights/scan', {
      gatewayCode: gatewayFilter.value || undefined,
    });
    lights.value = res.lights;
    ElMessage.success(`扫描完成, 发现 ${res.found} 盏在线灯`);
  } catch (err) {
    ElMessage.error('扫描失败: ' + (err as Error).message);
  } finally {
    scanning.value = false;
  }
}

async function identify(l: DaliLight): Promise<void> {
  try {
    await api.post(`/dali-lights/${l.id}/identify`);
    ElMessage.success(`${label(l)} 正在闪烁, 现场找一下`);
  } catch (err) {
    ElMessage.error('闪烁失败: ' + (err as Error).message);
  }
}

async function control(l: DaliLight, cmd: { on?: boolean; brightness?: number }): Promise<void> {
  try {
    await api.post(`/dali-lights/${l.id}/control`, cmd);
  } catch (err) {
    ElMessage.error('下发失败: ' + (err as Error).message);
  }
}

async function rename(l: DaliLight): Promise<void> {
  if (!(await ensureAdmin('灯具命名'))) return;
  try {
    const { value } = await ElMessageBox.prompt('给这盏灯起个名字', `命名 #${l.shortAddr}`, {
      inputValue: l.name ?? '',
      inputPlaceholder: '例如: 前厅筒灯1',
      confirmButtonText: '保存',
      cancelButtonText: '取消',
    });
    const updated = await api.put<DaliLight>(`/dali-lights/${l.id}/name`, { name: value ?? '' });
    Object.assign(l, updated);
    ElMessage.success('已命名');
  } catch {
    /* 取消 */
  }
}

async function assignZone(l: DaliLight, zoneCode: string | null): Promise<void> {
  if (!(await ensureAdmin('灯具分区'))) return;
  try {
    const updated = await api.put<DaliLight>(`/dali-lights/${l.id}/zone`, { zoneCode });
    Object.assign(l, updated);
    ElMessage.success(zoneCode ? `已归入 ${zoneName(zoneCode)}` : '已移出分区');
  } catch (err) {
    ElMessage.error('分配失败: ' + (err as Error).message);
  }
}

function openZoneDialog(l: DaliLight): void {
  zoneDlg.value = { open: true, light: l, picked: l.zoneCode ?? null, creating: false, newName: '', busy: false };
}
function closeZoneDialog(): void {
  zoneDlg.value.open = false;
}
/** 对话框内当场新建分区, 建完自动选中 —— 保证名称一致、不用切到分区页 */
async function createZoneInDialog(): Promise<void> {
  if (!(await ensureAdmin('新建分区'))) return;
  const name = zoneDlg.value.newName.trim();
  if (!name || zoneDlg.value.busy) return;
  zoneDlg.value.busy = true;
  const code = `lz-${Date.now()}`;
  try {
    await api.post('/light-zones', { name, floor: '1F', code });
    // 刷新分区列表, 让新分区出现在选项里
    zones.value = await api.get<Zone[]>('/light-zones').catch(() => zones.value);
    zoneDlg.value.picked = code; // 立即选中新建的
    zoneDlg.value.creating = false;
    zoneDlg.value.newName = '';
    ElMessage.success(`已新建「${name}」并选中`);
  } catch (err) {
    ElMessage.error('新建分区失败: ' + (err as Error).message);
  } finally {
    zoneDlg.value.busy = false;
  }
}
/** 确认: 把灯分到选中的分区 (picked 为 null = 移出) */
async function confirmZone(): Promise<void> {
  const l = zoneDlg.value.light;
  if (!l) return;
  await assignZone(l, zoneDlg.value.picked || null);
  closeZoneDialog();
}

async function controlZone(z: Zone, cmd: { on?: boolean; brightness?: number }): Promise<void> {
  try {
    const r = await api.post<{ total: number; ok: number }>(`/dali-lights/zones/${z.code}/control`, cmd);
    ElMessage.success(`${z.name}: ${r.ok}/${r.total} 盏已下发`);
  } catch (err) {
    ElMessage.error('下发失败: ' + (err as Error).message);
  }
}

async function newZone(): Promise<void> {
  if (!(await ensureAdmin('新建分区'))) return;
  try {
    const { value } = await ElMessageBox.prompt('新分区名字', '新建分区', {
      inputPlaceholder: '例如: 一层前厅',
      confirmButtonText: '创建',
      cancelButtonText: '取消',
    });
    const name = (value ?? '').trim();
    if (!name) return;
    await api.post('/light-zones', { name, floor: '1F', code: `lz-${Date.now()}` });
    await loadAll();
    ElMessage.success('分区已创建');
  } catch {
    /* 取消 */
  }
}

async function recallScene(s: Scene): Promise<void> {
  try {
    const r = await api.post<{ total: number; ok: number }>(`/dali-lights/scenes/${s.code}/recall`);
    ElMessage.success(`${s.name}: ${r.ok}/${r.total} 已调用`);
  } catch (err) {
    ElMessage.error('调用失败: ' + (err as Error).message);
  }
}

async function newScene(): Promise<void> {
  if (!(await ensureAdmin('新建场景'))) return;
  if (zones.value.length === 0) {
    ElMessage.warning('先建分区, 场景是把分区调到某个状态');
    return;
  }
  try {
    const { value } = await ElMessageBox.prompt(
      '场景名 (创建后把当前各分区状态存进去)',
      '新建场景',
      { inputPlaceholder: '例如: 接待模式', confirmButtonText: '创建', cancelButtonText: '取消' },
    );
    const name = (value ?? '').trim();
    if (!name) return;
    // 默认把所有分区以"开+80%"存入, 之后可在分区页调好再更新
    const items = zones.value.map((z) => ({ targetType: 'zone', targetRef: z.code, on: true, brightness: 80, kelvin: null }));
    await api.post('/dali-lights/scenes', { name, items });
    await loadAll();
    ElMessage.success('场景已创建, 可在分区页调好状态后覆盖保存');
  } catch {
    /* 取消 */
  }
}

async function deleteScene(s: Scene): Promise<void> {
  if (!(await ensureAdmin('删除场景'))) return;
  try {
    await ElMessageBox.confirm(`删除场景「${s.name}」?`, '确认', { type: 'warning' });
    await api.del(`/dali-lights/scenes/${s.code}`);
    scenes.value = scenes.value.filter((x) => x.code !== s.code);
    ElMessage.success('已删除');
  } catch {
    /* 取消 */
  }
}

onMounted(loadAll);
</script>

<template>
  <section class="dali-page v2-page">
    <!-- 2026-07-25 业主: 单灯页向全站风格对齐 — 标准头部骨架 + lucide 图标 + 胶囊 tab -->
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="router.back()" aria-label="返回">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><Lightbulb :size="18" :stroke-width="1.8" /> 单灯调试</div>
          <div class="sub">在线 {{ onlineCount }}<span v-if="faultCount"> · 故障 {{ faultCount }}</span> · 共 {{ lights.length }}</div>
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: tab === 'lights' }" @click="tab = 'lights'">灯 {{ lights.length }}</button>
          <button class="v2-tab" :class="{ active: tab === 'zones' }" @click="tab = 'zones'">分区 {{ zones.length }}</button>
          <button class="v2-tab" :class="{ active: tab === 'scenes' }" @click="tab = 'scenes'">场景 {{ scenes.length }}</button>
        </div>
      </div>
      <div class="quick-actions">
        <select v-if="gateways.length > 1" v-model="gatewayFilter" class="gw-select">
          <option value="">全部网关</option>
          <option v-for="g in gateways" :key="g.code" :value="g.code">{{ g.code }}</option>
        </select>
        <button class="v2-quick" @click="router.push({ name: 'dali-diagnose' })">
          <Activity :size="14" :stroke-width="2" /> 总线体检
        </button>
        <button class="v2-quick primary" :disabled="scanning" @click="scan">
          <ScanLine :size="14" :stroke-width="2" /> {{ scanning ? '扫描中…' : '扫描' }}
        </button>
      </div>
    </header>

    <!-- 灯 -->
    <div v-if="tab === 'lights'" class="pane">
      <p v-if="lights.length === 0" class="empty">
        还没有灯。点右上角<b>扫描</b>发现网关上的灯。
      </p>
      <p v-else-if="unassigned.length" class="hint">
        {{ unassigned.length }} 盏未分区
      </p>
      <div class="light-grid">
        <button
          v-for="l in shownLights"
          :key="l.id"
          class="light-card"
          :class="{ sel: selectedId === l.id, off: !l.online, fault: l.fault }"
          @click="selectedId = selectedId === l.id ? null : l.id"
        >
          <span class="dot" :class="l.fault ? 'd-fault' : l.online ? 'd-on' : 'd-off'" />
          <span class="l-name">{{ label(l) }}</span>
          <span class="l-meta">#{{ l.shortAddr }}<template v-if="l.zoneCode"> · {{ zoneName(l.zoneCode) }}</template></span>
        </button>
      </div>
    </div>

    <!-- 分区 -->
    <div v-else-if="tab === 'zones'" class="pane">
      <button class="add-row" @click="newZone"><Plus :size="15" :stroke-width="2" /> 新建分区</button>
      <div v-for="z in zones" :key="z.code" class="zone-block">
        <div class="zone-head">
          <div class="zone-name">{{ z.name }} <span class="zone-count">{{ lightsInZone(z.code).length }} 盏</span></div>
          <div class="zone-ops">
            <button @click="controlZone(z, { on: true })">开</button>
            <button @click="controlZone(z, { on: false })">关</button>
            <button @click="controlZone(z, { brightness: 50 })">50%</button>
            <button @click="controlZone(z, { brightness: 100 })">100%</button>
          </div>
        </div>
        <div class="zone-lights">
          <span v-for="l in lightsInZone(z.code)" :key="l.id" class="chip" :class="{ off: !l.online }">{{ label(l) }}</span>
          <span v-if="lightsInZone(z.code).length === 0" class="chip empty-chip">暂无成员</span>
        </div>
      </div>
    </div>

    <!-- 场景 -->
    <div v-else class="pane">
      <button class="add-row" @click="newScene"><Plus :size="15" :stroke-width="2" /> 新建场景</button>
      <div class="scene-grid">
        <div v-for="s in scenes" :key="s.code" class="scene-card">
          <button class="scene-main" @click="recallScene(s)">
            <span class="s-name">{{ s.name }}</span>
            <span class="s-meta">{{ s.items?.length ?? 0 }} 项</span>
          </button>
          <button class="s-del" @click="deleteScene(s)" aria-label="删除"><X :size="14" :stroke-width="2" /></button>
        </div>
        <p v-if="scenes.length === 0" class="empty">暂无场景</p>
      </div>
    </div>

    <!-- 选中灯的底部操作条 -->
    <div v-if="tab === 'lights' && selected" class="dock">
      <div class="dock-title">{{ label(selected) }} <span class="dock-sub">#{{ selected.shortAddr }} · {{ selected.gatewayCode }}</span></div>
      <div class="dock-ops">
        <button class="op flash" @click="identify(selected)"><Zap :size="14" :stroke-width="2" /> 闪烁认灯</button>
        <button class="op" @click="control(selected, { on: true })">开</button>
        <button class="op" @click="control(selected, { on: false })">关</button>
        <button class="op" @click="control(selected, { brightness: 50 })">50%</button>
        <button class="op" @click="rename(selected)">命名</button>
        <button class="op" @click="openZoneDialog(selected)">分区</button>
      </div>
    </div>

    <!-- 分配分区对话框: 下拉选已有 + 当场新建 (建完立即可选) -->
    <div v-if="zoneDlg.open" class="zone-modal-mask" @click.self="closeZoneDialog">
      <div class="zone-modal">
        <div class="zm-title">分到哪个区<span class="zm-sub">{{ zoneDlg.light ? label(zoneDlg.light) : '' }}</span></div>
        <div class="zm-list">
          <button type="button" class="zm-opt" :class="{ sel: !zoneDlg.picked }" @click="zoneDlg.picked = null">
            不分区(移出)<Check v-if="!zoneDlg.picked" class="zm-check" :size="16" :stroke-width="2.5" />
          </button>
          <button
            v-for="z in zones" :key="z.code" type="button"
            class="zm-opt" :class="{ sel: zoneDlg.picked === z.code }"
            @click="zoneDlg.picked = z.code"
          >
            {{ z.name }}<Check v-if="zoneDlg.picked === z.code" class="zm-check" :size="16" :stroke-width="2.5" />
          </button>
          <p v-if="zones.length === 0" class="zm-empty">暂无分区</p>
        </div>

        <!-- 当场新建分区 -->
        <div class="zm-new">
          <button v-if="!zoneDlg.creating" type="button" class="zm-new-btn" @click="zoneDlg.creating = true"><Plus :size="14" :stroke-width="2" /> 新建分区</button>
          <div v-else class="zm-new-row">
            <input
              v-model="zoneDlg.newName" class="zm-input"
              placeholder="新分区名, 例如: 一层前厅"
              @keyup.enter="createZoneInDialog"
            />
            <button type="button" class="zm-create" :disabled="zoneDlg.busy || !zoneDlg.newName.trim()" @click="createZoneInDialog">创建</button>
          </div>
        </div>

        <div class="zm-actions">
          <button type="button" class="zm-cancel" @click="closeZoneDialog">取消</button>
          <button type="button" class="zm-save" @click="confirmZone">保存</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dali-page { min-height: 100vh; padding-bottom: 96px; color: var(--v2-text-1); }
/* 标准头部骨架 (与状态/媒体/电源页一致, 2026-07-25 全站对齐) */
.v2-page { padding: var(--v2-sp-5); display: flex; flex-direction: column; gap: var(--v2-sp-4); }
.v2-page-head { display: flex; justify-content: space-between; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap; }
.back-row { display: flex; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap; }
.v2-back-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title-block { display: flex; flex-direction: column; }
.title { font-size: 20px; font-weight: 700; color: var(--v2-text-1); display: inline-flex; align-items: center; gap: var(--v2-sp-2); }
.sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); margin-top: 2px; font-variant-numeric: tabular-nums; }
.v2-tabs {
  display: inline-flex;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  padding: 3px;
  margin-left: var(--v2-sp-3);
}
.v2-tab {
  padding: 5px 14px; border-radius: 6px; font-size: var(--v2-fs-sm);
  color: var(--v2-text-2); cursor: pointer; background: transparent; border: none;
  transition: all 0.18s ease; white-space: nowrap;
}
.v2-tab.active { background: var(--v2-primary-soft); color: var(--v2-primary); box-shadow: 0 0 0 1px rgba(var(--v2-primary-rgb), 0.2); }
.quick-actions { display: flex; gap: var(--v2-sp-2); flex-wrap: wrap; }
.v2-quick {
  padding: 8px 14px; border-radius: var(--v2-r-sm); font-size: var(--v2-fs-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.18s ease; min-height: 36px;
}
.v2-quick:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.v2-quick.primary { background: var(--v2-primary-soft); color: var(--v2-primary); border-color: rgba(var(--v2-primary-rgb), 0.3); }
.v2-quick:disabled { opacity: 0.5; cursor: not-allowed; }
.gw-select {
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
  border-radius: var(--v2-r-sm); padding: 6px 8px; font-size: 13px; max-width: 130px;
}

.pane { padding: 0; }
.empty { color: var(--v2-text-3); font-size: 14px; text-align: center; padding: 40px 20px; line-height: 1.7; }
.hint { color: var(--v2-text-3); font-size: 12.5px; margin: 4px 2px 12px; }

.light-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.light-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px;
  padding: 12px 12px 11px; border-radius: 12px; text-align: left; cursor: pointer;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
  min-height: 64px; position: relative;
}
.light-card.sel { border-color: var(--v2-primary); background: var(--v2-primary-soft); }
.light-card.off { opacity: .55; }
.light-card .dot { width: 8px; height: 8px; border-radius: 50%; position: absolute; top: 12px; right: 12px; }
.d-on { background: var(--v2-success); }
.d-off { background: var(--v2-text-3); }
.d-fault { background: var(--v2-danger); }
.l-name { font-size: 14px; font-weight: 600; padding-right: 14px; }
.l-meta { font-size: 11.5px; color: var(--v2-text-3); font-variant-numeric: tabular-nums; }

.add-row {
  width: 100%; padding: 12px; margin-bottom: 12px; border-radius: 12px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--v2-surf-1); border: 1px dashed var(--v2-border-strong); color: var(--v2-text-2);
  font-size: 14px; cursor: pointer;
}
.zone-block { background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
.zone-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.zone-name { font-size: 15px; font-weight: 600; }
.zone-count { font-size: 12px; color: var(--v2-text-3); font-weight: 400; }
.zone-ops { display: flex; gap: 6px; }
.zone-ops button {
  padding: 6px 12px; border-radius: var(--v2-r-sm); font-size: 13px; cursor: pointer;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.zone-lights { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); }
.chip.off { opacity: .5; }
.empty-chip { border-style: dashed; }

.scene-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.scene-card { position: relative; }
.scene-main {
  width: 100%; display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
  padding: 16px 14px; border-radius: 12px; cursor: pointer;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.s-name { font-size: 15px; font-weight: 600; }
.s-meta { font-size: 11.5px; color: var(--v2-text-3); }
.s-del {
  position: absolute; top: 8px; right: 8px; width: 26px; height: 26px; border-radius: 50%;
  background: transparent; border: none; color: var(--v2-text-3); cursor: pointer;
  display: grid; place-items: center;
}
.s-del:hover { color: var(--v2-danger); background: var(--v2-ov-2); }

.dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  background: var(--v2-surf-2); border-top: 1px solid var(--v2-border-strong);
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
}
.dock-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.dock-sub { font-size: 12px; color: var(--v2-text-3); font-weight: 400; }
.dock-ops { display: flex; gap: 8px; overflow-x: auto; }
.op {
  flex: none; padding: 9px 16px; display: inline-flex; align-items: center; gap: 6px; border-radius: var(--v2-r-sm); font-size: 14px; cursor: pointer;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.op.flash { background: var(--v2-primary-soft); border-color: var(--v2-primary); color: var(--v2-primary); font-weight: 600; }

/* ============ 分配分区对话框 (手机底部弹出 sheet / 桌面居中) ============ */
.zone-modal-mask {
  position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, .55);
  display: flex; align-items: flex-end; justify-content: center;
}
@media (min-width: 560px) { .zone-modal-mask { align-items: center; padding: 20px; } }
.zone-modal {
  width: 100%; max-width: 460px;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-strong);
  border-radius: 16px 16px 0 0; box-shadow: var(--v2-elev-3);
  padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
}
@media (min-width: 560px) { .zone-modal { border-radius: 16px; } }
.zm-title { font-size: 15px; font-weight: 600; margin-bottom: 12px; }
.zm-title .zm-sub { font-size: 12px; color: var(--v2-text-3); font-weight: 400; margin-left: 8px; }
.zm-list { display: flex; flex-direction: column; gap: 6px; max-height: 44vh; overflow-y: auto; }
.zm-opt {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; border-radius: 10px; text-align: left; cursor: pointer; font-size: 14px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.zm-opt.sel { border-color: var(--v2-primary); background: var(--v2-primary-soft); color: var(--v2-primary); font-weight: 600; }
.zm-check { flex: 0 0 auto; }
.zm-empty { color: var(--v2-text-3); font-size: 13px; text-align: center; padding: 10px 0; }
.zm-new { margin-top: 10px; }
.zm-new-btn {
  width: 100%; padding: 11px; border-radius: 10px; cursor: pointer; font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--v2-surf-1); border: 1px dashed var(--v2-border-strong); color: var(--v2-text-2);
}
.zm-new-row { display: flex; gap: 8px; }
.zm-input {
  flex: 1; min-width: 0; padding: 11px 12px; border-radius: 10px; font-size: 14px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.zm-create {
  flex: none; padding: 11px 18px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 600;
  background: var(--v2-primary-soft); border: 1px solid var(--v2-primary); color: var(--v2-primary);
}
.zm-create:disabled { opacity: .5; }
.zm-actions { display: flex; gap: 10px; margin-top: 16px; }
.zm-cancel, .zm-save { flex: 1; padding: 12px; border-radius: 10px; cursor: pointer; font-size: 15px; font-weight: 600; }
.zm-cancel { background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); }
.zm-save { background: var(--v2-primary); border: 1px solid var(--v2-primary); color: var(--v2-on-primary); }
</style>
