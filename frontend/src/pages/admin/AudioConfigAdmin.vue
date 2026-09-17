<script setup lang="ts">
import { onMounted } from 'vue';
import { Speaker, Sparkles, Save, Mic, Grid3x3, Send } from 'lucide-vue-next';
import { useAudioConfigEditor } from '@/features/useAudioConfigEditor';
const { zones, inputs, scenes, loading, needsReload, savingId, busy, enabledInputs, editorVisible, editingScene, editorRows, applying, savingContent,
  refresh, saveZone, saveInput, saveScene, sceneRouteCount, openEditor, toggleCell, saveContent, applyNow } = useAudioConfigEditor();
onMounted(() => refresh(false));
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
      <el-button @click="refresh()" :disabled="busy" :loading="loading">刷新</el-button>
    </header>
    <el-alert v-if="needsReload" title="尚未取得可保存的最新版本；草稿不会自动覆盖服务器，请先重新载入。" type="warning" :closable="false" show-icon />

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
            <el-button type="primary" size="small" :disabled="busy || needsReload" :loading="savingId === `z${row.id}`" @click="saveZone(row)">
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
            <el-button type="primary" size="small" :disabled="busy || needsReload" :loading="savingId === `i${row.id}`" @click="saveInput(row)">
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
            <el-button size="small" :disabled="busy || needsReload" @click="openEditor(row)">
              <Grid3x3 :size="13" :stroke-width="2" style="margin-right:4px" /> 编辑路由
            </el-button>
            <el-button type="primary" size="small" :disabled="busy || needsReload" :loading="savingId === `s${row.id}`" @click="saveScene(row)">
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
        <el-button :disabled="busy || needsReload" :loading="applying" @click="applyNow">
          <Send :size="14" :stroke-width="2" style="margin-right:5px" /> 下发试听
        </el-button>
        <el-button type="primary" :disabled="busy || needsReload" :loading="savingContent" @click="saveContent">
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
  background: rgba(76, 154, 255, 0.15); color: #67E8F9;
}
.chan-tag.out { background: rgba(76, 154, 255, 0.15); color: #67E8F9; }
.chan-tag.in { background: rgba(167, 139, 250, 0.18); color: #C4B5FD; }
.route-badge {
  display: inline-block; padding: 2px 9px; border-radius: 10px; font-size: 12px; font-weight: 600;
}
.route-badge.on { background: rgba(63, 191, 135, 0.16); color: #5FCB9B; }
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
  background: var(--v2-ov-1); color: var(--v2-text-1);
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
