<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Speaker, Sparkles, Save } from 'lucide-vue-next';
import {
  audioConfigService,
  type AudioOutputZone,
  type AudioScene,
} from '@/services/audio-config.service';

/**
 * 音响配置 — 业主自定义输出通道名 + 一键场景名.
 * 输出通道 8 路 (OUT1-OUT8, channel 0-7 硬件固定) + 场景 12 个 (U01-U12 固定),
 * 业主只改名字/楼层/色/提示/启用, 不改 channel/presetNum (那是硬件对应关系).
 */

const zones = ref<AudioOutputZone[]>([]);
const scenes = ref<AudioScene[]>([]);
const loading = ref(false);
const savingId = ref<string | null>(null);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    [zones.value, scenes.value] = await Promise.all([
      audioConfigService.listZones(true),
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

onMounted(refresh);
</script>

<template>
  <section class="audio-config">
    <header class="page-head">
      <div>
        <h2><Speaker :size="20" :stroke-width="2" /> 音响配置</h2>
        <p class="sub">
          自定义 EKX-808 的 8 路输出通道名字 + 12 个一键场景名字. 改完前台音响页立即生效,
          不用改代码. 通道号 (OUT1-8) / 预设号 (U01-12) 是硬件固定对应关系, 不可改.
        </p>
      </div>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </header>

    <!-- 输出通道 -->
    <section class="block">
      <h3 class="block-title"><Speaker :size="16" :stroke-width="2" /> 输出通道 (8 路)</h3>
      <el-table :data="zones" size="default" class="cfg-table">
        <el-table-column label="通道" width="90">
          <template #default="{ row }"><span class="chan-tag">OUT {{ row.channel + 1 }}</span></template>
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
        <el-table-column label="颜色" width="120">
          <template #default="{ row }">
            <el-input v-model="row.color" maxlength="16" placeholder="#00E5FF (可空)" />
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

    <!-- 一键场景 -->
    <section class="block">
      <h3 class="block-title"><Sparkles :size="16" :stroke-width="2" /> 一键场景 (12 个预设)</h3>
      <p class="block-sub">
        场景内容 (路由/音量/EQ) 由集成商在厂家 PC Editor 软件里录入到 U01-U12.
        这里只改前台显示的名字 + 提示.
      </p>
      <el-table :data="scenes" size="default" class="cfg-table">
        <el-table-column label="预设" width="90">
          <template #default="{ row }"><span class="chan-tag">U{{ String(row.presetNum).padStart(2,'0') }}</span></template>
        </el-table-column>
        <el-table-column label="场景名称" min-width="160">
          <template #default="{ row }">
            <el-input v-model="row.name" maxlength="64" placeholder="如: 早班接待" />
          </template>
        </el-table-column>
        <el-table-column label="提示说明" min-width="220">
          <template #default="{ row }">
            <el-input v-model="row.hint" maxlength="128" placeholder="如: 8-10 点全场低音量 (可空)" />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80">
          <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
        </el-table-column>
        <el-table-column label="操作" width="100">
          <template #default="{ row }">
            <el-button type="primary" size="small" :loading="savingId === `s${row.id}`" @click="saveScene(row)">
              <Save :size="13" :stroke-width="2" style="margin-right:4px" /> 保存
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>
  </section>
</template>

<style scoped>
.audio-config { padding: 16px 24px; color: var(--v2-text-1); }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 20px; }
.page-head h2 { margin: 0; font-size: 20px; display: inline-flex; align-items: center; gap: 8px; }
.sub { color: var(--v2-text-2); margin: 6px 0 0; font-size: 13px; max-width: 760px; line-height: 1.6; }
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
</style>
