<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Speaker, Sparkles, Save, Mic, Grid3x3, Send } from 'lucide-vue-next';
import {
  audioConfigService,
  parseSceneContent,
  type AudioOutputZone,
  type AudioInputSource,
  type AudioScene,
  type SceneContent,
} from '@/services/audio-config.service';

/**
 * 音响配置 — 业主自定义输出/输入名 + 一键场景(含真实矩阵路由+音量).
 * 输出 8 路 (OUT1-8) / 输入 8 路 (IN1-8) channel 硬件固定; 场景 12 个 (U01-12 固定).
 * 场景"内容"(哪路输入→哪路输出+音量+静音)存我们 DB, 切场景时后端逐条下发到矩阵,
 * 不依赖厂家 PC Editor.
 */

const zones = ref<AudioOutputZone[]>([]);
const inputs = ref<AudioInputSource[]>([]);
const scenes = ref<AudioScene[]>([]);
const loading = ref(false);
const savingId = ref<string | null>(null);

const enabledInputs = computed(() =>
  [...inputs.value].filter((i) => i.enabled).sort((a, b) => a.sortOrder - b.sortOrder || a.channel - b.channel),
);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    [zones.value, inputs.value, scenes.value] = await Promise.all([
      audioConfigService.listZones(true),
      audioConfigService.listInputs(true),
      audioConfigService.listScenes(true),
    ]);
  } catch (e) {
    ElMessage.error(`加载失败: ${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}

async function saveZone(z: AudioOutputZone): Promise<void> {
  savingId.value = `z${z.id}`;
  try {
    await audioConfigService.updateZone(z.id, {
      name: z.name, floor: z.floor, color: z.color, enabled: z.enabled, sortOrder: z.sortOrder,
    });
    ElMessage.success(`已保存 OUT${z.channel + 1}: ${z.name}`);
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
  } finally {
    savingId.value = null;
  }
}

async function saveInput(s: AudioInputSource): Promise<void> {
  savingId.value = `i${s.id}`;
  try {
    await audioConfigService.updateInput(s.id, {
      name: s.name, color: s.color, enabled: s.enabled, sortOrder: s.sortOrder,
    });
    ElMessage.success(`已保存 IN${s.channel + 1}: ${s.name}`);
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
  } finally {
    savingId.value = null;
  }
}

async function saveScene(s: AudioScene): Promise<void> {
  savingId.value = `s${s.id}`;
  try {
    await audioConfigService.updateScene(s.id, {
      name: s.name, hint: s.hint, enabled: s.enabled, sortOrder: s.sortOrder,
    });
    ElMessage.success(`已保存 U${String(s.presetNum).padStart(2, '0')}: ${s.name}`);
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
  } finally {
    savingId.value = null;
  }
}

/** 某场景已配几路输出 (有路由的) */
function sceneRouteCount(s: AudioScene): number {
  const c = parseSceneContent(s);
  if (!c) return 0;
  return c.outputs.filter((o) => (o.inputs?.length ?? 0) > 0 || typeof o.volume === 'number' || typeof o.muted === 'boolean').length;
}

// ============ 矩阵路由编辑器 ============

interface EditorRow { ch: number; name: string; inputs: number[]; volume: number; muted: boolean }

const editorVisible = ref(false);
const editingScene = ref<AudioScene | null>(null);
const editorRows = ref<EditorRow[]>([]);
const applying = ref(false);
const savingContent = ref(false);

function openEditor(scene: AudioScene): void {
  editingScene.value = scene;
  const content = parseSceneContent(scene);
  const byCh = new Map(content?.outputs?.map((o) => [o.ch, o]) ?? []);
  editorRows.value = [...zones.value]
    .filter((z) => z.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.channel - b.channel)
    .map((z) => {
      const c = byCh.get(z.channel);
      return {
        ch: z.channel,
        name: z.name,
        inputs: c?.inputs ? [...c.inputs] : [],
        volume: typeof c?.volume === 'number' ? c.volume : 80,
        muted: c?.muted ?? false,
      };
    });
  editorVisible.value = true;
}

function toggleCell(row: EditorRow, ch: number, checked: boolean): void {
  const has = row.inputs.includes(ch);
  if (checked && !has) row.inputs.push(ch);
  else if (!checked && has) row.inputs = row.inputs.filter((c) => c !== ch);
}

function buildContent(): SceneContent {
  return {
    outputs: editorRows.value.map((r) => ({
      ch: r.ch,
      inputs: [...r.inputs].sort((a, b) => a - b),
      volume: r.volume,
      muted: r.muted,
    })),
  };
}

async function saveContent(): Promise<void> {
  if (!editingScene.value) return;
  savingContent.value = true;
  try {
    await audioConfigService.updateScene(editingScene.value.id, { content: buildContent() });
    ElMessage.success('场景路由已保存');
    await refresh();
    editorVisible.value = false;
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`);
  } finally {
    savingContent.value = false;
  }
}

async function applyNow(): Promise<void> {
  if (!editingScene.value) return;
  applying.value = true;
  try {
    // 先存当前编辑内容, 再下发, 保证听到的就是屏幕上配的
    await audioConfigService.updateScene(editingScene.value.id, { content: buildContent() });
    await audioConfigService.applyScene(editingScene.value.presetNum);
    ElMessage.success('已下发到矩阵 — 现场接好喇叭即可试听');
  } catch (e) {
    ElMessage.error(`下发失败: ${(e as Error).message}`);
  } finally {
    applying.value = false;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="audio-config">
    <header class="page-head">
      <div>
        <h2><Speaker :size="20" :stroke-width="2" /> 音响配置</h2>
        <p class="sub">
          自定义 EKX-808 的 8 路输出 / 8 路输入名字 + 12 个一键场景. 场景的实际内容
          (哪路输入→哪路输出 + 音量 + 静音) 也在这里配, 切场景时后端逐条下发到矩阵,
          不用厂家 PC Editor. 通道号 (OUT/IN 1-8) / 预设号 (U01-12) 是硬件固定, 不可改.
        </p>
      </div>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </header>

    <!-- 输出通道 -->
    <section class="block">
      <h3 class="block-title"><Speaker :size="16" :stroke-width="2" /> 输出通道 (8 路 · 接喇叭/功放)</h3>
      <el-table :data="zones" size="default" class="cfg-table">
        <el-table-column label="通道" width="90">
          <template #default="{ row }"><span class="chan-tag out">OUT {{ row.channel + 1 }}</span></template>
        </el-table-column>
        <el-table-column label="显示名称" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="64" placeholder="如: 一层大厅" />
          </template>
        </el-table-column>
        <el-table-column label="楼层" width="120">
          <template #default="{ row }">
            <el-input v-model="row.floor" maxlength="16" placeholder="如 1F (可空)" />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="primary" size="small" :loading="savingId === `z${row.id}`" @click="saveZone(row)">
              <Save :size="13" :stroke-width="2" style="margin-right:4px" /> 保存
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 输入源 -->
    <section class="block">
      <h3 class="block-title"><Mic :size="16" :stroke-width="2" /> 输入源 (8 路 · 接音源/话筒/播放器)</h3>
      <el-table :data="inputs" size="default" class="cfg-table">
        <el-table-column label="通道" width="90">
          <template #default="{ row }"><span class="chan-tag in">IN {{ row.channel + 1 }}</span></template>
        </el-table-column>
        <el-table-column label="显示名称" min-width="180">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="64" placeholder="如: 背景音乐 / 主话筒 / GK9000播放器" />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="primary" size="small" :loading="savingId === `i${row.id}`" @click="saveInput(row)">
              <Save :size="13" :stroke-width="2" style="margin-right:4px" /> 保存
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 一键场景 -->
    <section class="block">
      <h3 class="block-title"><Sparkles :size="16" :stroke-width="2" /> 一键场景 (12 个)</h3>
      <p class="block-sub">
        改名/提示后点保存; 点「编辑路由」配这个场景把哪路输入送到哪路输出 + 各路音量.
        没配路由的场景, 切换时回退到调设备内置预设 U0N.
      </p>
      <el-table :data="scenes" size="default" class="cfg-table">
        <el-table-column label="预设" width="80">
          <template #default="{ row }"><span class="chan-tag">U{{ String(row.presetNum).padStart(2,'0') }}</span></template>
        </el-table-column>
        <el-table-column label="场景名称" min-width="150">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="64" placeholder="如: 早班接待" />
          </template>
        </el-table-column>
        <el-table-column label="提示说明" min-width="140">
          <template #default="{ row }">
            <el-input v-model="row.hint" maxlength="128" placeholder="如: 8-10 点全场低音量 (可空)" />
          </template>
        </el-table-column>
        <el-table-column label="路由" width="120">
          <template #default="{ row }">
            <span v-if="sceneRouteCount(row) > 0" class="route-badge on">已配 {{ sceneRouteCount(row) }} 路</span>
            <span v-else class="route-badge off">未配</span>
          </template>
        </el-table-column>
        <el-table-column label="启用" width="70">
          <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
        </el-table-column>
        <el-table-column label="操作" width="190">
          <template #default="{ row }">
            <el-button size="small" @click="openEditor(row)">
              <Grid3x3 :size="13" :stroke-width="2" style="margin-right:4px" /> 编辑路由
            </el-button>
            <el-button type="primary" size="small" :loading="savingId === `s${row.id}`" @click="saveScene(row)">
              <Save :size="13" :stroke-width="2" />
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 矩阵路由编辑器 -->
    <el-dialog
      v-model="editorVisible"
      :title="`编辑场景路由 — ${editingScene?.name ?? ''}`"
      width="880px"
      top="6vh"
      class="matrix-dialog"
    >
      <p class="editor-hint">
        每行是一路输出, 勾选它从哪些输入取声音 (可多选 = 混音), 拖滑条调音量, 右侧可单独静音.
        「保存」只存到系统; 「下发试听」会立刻把矩阵摆成这样 (现场接好喇叭就能听).
      </p>
      <div class="matrix-wrap">
        <table class="matrix">
          <thead>
            <tr>
              <th class="out-col">输出 \ 输入</th>
              <th v-for="inp in enabledInputs" :key="inp.channel" class="in-col">{{ inp.name }}</th>
              <th class="vol-col">音量</th>
              <th class="mute-col">静音</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in editorRows" :key="row.ch">
              <td class="out-name">{{ row.name }}</td>
              <td v-for="inp in enabledInputs" :key="inp.channel" class="cell">
                <el-checkbox
                  :model-value="row.inputs.includes(inp.channel)"
                  @change="(v: boolean) => toggleCell(row, inp.channel, v)"
                />
              </td>
              <td class="vol-cell">
                <el-slider v-model="row.volume" :min="0" :max="100" size="small" :disabled="row.muted" />
                <span class="vol-num">{{ row.volume }}</span>
              </td>
              <td class="mute-cell"><el-switch v-model="row.muted" /></td>
            </tr>
            <tr v-if="editorRows.length === 0">
              <td :colspan="enabledInputs.length + 3" class="empty">没有启用的输出通道, 先去上面启用</td>
            </tr>
          </tbody>
        </table>
      </div>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button :loading="applying" @click="applyNow">
          <Send :size="14" :stroke-width="2" style="margin-right:5px" /> 下发试听
        </el-button>
        <el-button type="primary" :loading="savingContent" @click="saveContent">
          <Save :size="14" :stroke-width="2" style="margin-right:5px" /> 保存
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.audio-config { padding: 16px 24px; color: var(--v2-text-1); }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 20px; }
.page-head h2 { margin: 0; font-size: 20px; display: inline-flex; align-items: center; gap: 8px; }
.sub { color: var(--v2-text-2); margin: 6px 0 0; font-size: 13px; max-width: 820px; line-height: 1.6; }
.block { margin-bottom: 28px; }
.block-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600; margin: 0 0 6px;
  color: var(--v2-text-1);
}
.block-sub { font-size: 12px; color: var(--v2-text-3); margin: 0 0 12px; }
.cfg-table { background: transparent; }
.chan-tag {
  display: inline-block; padding: 2px 10px; border-radius: 6px;
  font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 12px; font-weight: 600;
  background: rgba(0, 229, 255, 0.15); color: #67E8F9;
}
.chan-tag.out { background: rgba(0, 229, 255, 0.15); color: #67E8F9; }
.chan-tag.in { background: rgba(167, 139, 250, 0.18); color: #C4B5FD; }
.route-badge {
  display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 12px; font-weight: 600;
}
.route-badge.on { background: rgba(52, 211, 153, 0.16); color: #6EE7B7; }
.route-badge.off { background: rgba(148, 163, 184, 0.16); color: #94A3B8; }

/* 矩阵编辑器 */
.editor-hint { font-size: 13px; color: var(--v2-text-2); line-height: 1.6; margin: 0 0 14px; }
.matrix-wrap { overflow-x: auto; }
.matrix { border-collapse: collapse; width: 100%; min-width: 560px; }
.matrix th, .matrix td {
  border: 1px solid var(--v2-border-soft);
  padding: 8px 10px; text-align: center; font-size: 13px;
}
.matrix thead th {
  background: rgba(255, 255, 255, 0.04); color: var(--v2-text-1);
  font-weight: 600; position: sticky; top: 0;
}
.matrix .out-col { text-align: left; min-width: 110px; }
.matrix .in-col { min-width: 64px; }
.matrix .vol-col { min-width: 160px; }
.matrix .out-name { text-align: left; font-weight: 600; color: var(--v2-primary-hover); }
.matrix .cell { width: 64px; }
.matrix .vol-cell { display: flex; align-items: center; gap: 10px; }
.matrix .vol-cell :deep(.el-slider) { flex: 1; }
.matrix .vol-num {
  width: 30px; text-align: right; font-variant-numeric: tabular-nums;
  font-size: 12px; color: var(--v2-text-2);
}
.matrix .empty { color: var(--v2-text-3); padding: 18px; }
</style>
