<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, RefreshCw, Trash2, Video, Settings, Play } from 'lucide-vue-next';
import { api } from '@/services/http';
import AiRegionEditor from './AiRegionEditor.vue';

/**
 * 视频绑定管理 — NVR录像机 + 摄像头通道 + 大屏显示布局
 *
 * 业主需求: 摄像头换了IP/通道以前要改代码重新部署, 太傻.
 * 这页把NVR设备和摄像头通道列成表, IP/端口/用户名密码/通道号直接改,
 * 点保存立即生效, 运营大屏自动从 /api/video-binding/display 加载配置.
 */

const loading = ref(false);
const activeTab = ref<'nvrs' | 'channels' | 'layout'>('nvrs');

// NVR设备
interface NvrDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  rtspPort: number;
  username: string;
  hasPassword: boolean;
  brand: string;
  enabled: boolean;
  createdAt: string;
}

const nvrs = ref<NvrDevice[]>([]);
const nvrDialogVisible = ref(false);
type NvrForm = Partial<NvrDevice> & { password?: string };
const nvrForm = ref<NvrForm>({});
const nvrEditing = ref(false);
const testingNvrId = ref<string | null>(null);

// 归一化坐标点（0~1）
interface NormPoint { x: number; y: number; }

// 摄像头通道
interface CameraChannel {
  id: string;
  nvrId: string;
  hikChannel: string;
  name: string;
  alias: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  // AI 检测范围（后端 migrate 补默认，可能缺省）
  aiEnabled?: boolean;
  countLine?: NormPoint[] | null;
  roiPolygon?: NormPoint[];
}

const channels = ref<CameraChannel[]>([]);
const channelDialogVisible = ref(false);
const channelForm = ref<Partial<CameraChannel>>({});
const channelEditing = ref(false);

// AI：全局框开关 + 检测范围编辑器 + 下发状态
const aiBoxEnabled = ref(true);
const aiPushing = ref(false);
const editorVisible = ref(false);
const editorTarget = ref<CameraChannel | null>(null);

// 显示布局
const layoutColumns = ref(3);
const layoutChannelIds = ref<string[]>([]);
const availableChannels = computed(() => channels.value.filter(c => c.enabled));

// 加载数据
async function loadData() {
  loading.value = true;
  try {
    const res: any = await api.get('/video-binding');
    const data = res?.data?.data || res?.data || res;
    nvrs.value = data.nvrs || [];
    channels.value = (data.channels || []).sort((a: CameraChannel, b: CameraChannel) => a.sortOrder - b.sortOrder);
    layoutColumns.value = data.displayLayout?.columns || 3;
    layoutChannelIds.value = data.displayLayout?.channelIds || [];
    aiBoxEnabled.value = data.aiBoxEnabled !== false;
  } catch (e: any) {
    ElMessage.error('加载视频绑定配置失败: ' + (e.message || e));
  } finally {
    loading.value = false;
  }
}

// NVR CRUD
function openNvrDialog(nvr?: NvrDevice) {
  if (nvr) {
    nvrForm.value = { ...nvr, password: '' };
    nvrEditing.value = true;
  } else {
    nvrForm.value = {
      name: '',
      ip: '',
      port: 80,
      rtspPort: 554,
      username: 'admin',
      password: '',
      brand: 'hikvision',
      enabled: true,
    };
    nvrEditing.value = false;
  }
  nvrDialogVisible.value = true;
}

async function saveNvr() {
  if (!nvrForm.value.name || !nvrForm.value.ip) {
    ElMessage.warning('请填写设备名称和IP地址');
    return;
  }
  if (!nvrEditing.value && !nvrForm.value.password) {
    ElMessage.warning('新建NVR设备必须填写密码');
    return;
  }
  try {
    const payload = {
      name: nvrForm.value.name,
      ip: nvrForm.value.ip,
      port: nvrForm.value.port,
      rtspPort: nvrForm.value.rtspPort,
      username: nvrForm.value.username,
      brand: nvrForm.value.brand,
      enabled: nvrForm.value.enabled,
      ...(nvrForm.value.password ? { password: nvrForm.value.password } : {}),
    };
    if (nvrEditing.value && nvrForm.value.id) {
      await api.put(`/video-binding/nvrs/${nvrForm.value.id}`, payload);
      ElMessage.success('NVR设备已更新');
    } else {
      await api.post('/video-binding/nvrs', payload);
      ElMessage.success('NVR设备已创建');
    }
    nvrDialogVisible.value = false;
    await loadData();
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e.message || e));
  }
}

async function deleteNvr(nvr: NvrDevice) {
  try {
    await ElMessageBox.confirm(`确定删除NVR设备"${nvr.name}"吗？关联的摄像头通道也会被删除。`, '确认删除', {
      type: 'warning',
    });
    await api.del(`/video-binding/nvrs/${nvr.id}`);
    ElMessage.success('NVR设备已删除');
    await loadData();
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error('删除失败: ' + (e.message || e));
    }
  }
}

async function testNvrConnection(nvr: NvrDevice) {
  testingNvrId.value = nvr.id;
  try {
    const res: any = await api.post(`/video-binding/nvrs/${nvr.id}/test`);
    if (res?.data?.success) {
      ElMessage.success('连接成功');
    } else {
      ElMessage.error(res?.data?.message || '连接失败');
    }
  } catch (e: any) {
    ElMessage.error('测试失败: ' + (e.message || e));
  } finally {
    testingNvrId.value = null;
  }
}

// Channel CRUD
function openChannelDialog(channel?: CameraChannel) {
  if (channel) {
    channelForm.value = { ...channel };
    channelEditing.value = true;
  } else {
    channelForm.value = {
      nvrId: nvrs.value[0]?.id || '',
      hikChannel: '',
      name: '',
      alias: '',
      enabled: true,
      sortOrder: channels.value.length + 1,
    };
    channelEditing.value = false;
  }
  channelDialogVisible.value = true;
}

async function saveChannel() {
  if (!channelForm.value.nvrId || !channelForm.value.hikChannel || !channelForm.value.name) {
    ElMessage.warning('请选择NVR设备、填写海康通道号和通道名称');
    return;
  }
  try {
    const payload = {
      nvrId: channelForm.value.nvrId,
      hikChannel: channelForm.value.hikChannel,
      name: channelForm.value.name,
      alias: channelForm.value.alias || '',
      enabled: channelForm.value.enabled,
      sortOrder: channelForm.value.sortOrder,
    };
    if (channelEditing.value && channelForm.value.id) {
      await api.put(`/video-binding/channels/${channelForm.value.id}`, payload);
      ElMessage.success('摄像头通道已更新');
    } else {
      await api.post('/video-binding/channels', payload);
      ElMessage.success('摄像头通道已创建');
    }
    channelDialogVisible.value = false;
    await loadData();
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e.message || e));
  }
}

async function deleteChannel(channel: CameraChannel) {
  try {
    await ElMessageBox.confirm(`确定删除摄像头通道"${channel.name}"吗？`, '确认删除', {
      type: 'warning',
    });
    await api.del(`/video-binding/channels/${channel.id}`);
    ElMessage.success('摄像头通道已删除');
    await loadData();
  } catch (e: any) {
    if (e !== 'cancel') {
      ElMessage.error('删除失败: ' + (e.message || e));
    }
  }
}

// 布局管理
function toggleChannelInLayout(channelId: string) {
  const idx = layoutChannelIds.value.indexOf(channelId);
  if (idx === -1) {
    layoutChannelIds.value.push(channelId);
  } else {
    layoutChannelIds.value.splice(idx, 1);
  }
}

async function saveLayout() {
  try {
    await api.put('/video-binding/layout', {
      columns: layoutColumns.value,
      channelIds: layoutChannelIds.value,
    });
    ElMessage.success('显示布局已保存，运营大屏将自动更新');
  } catch (e: any) {
    ElMessage.error('保存布局失败: ' + (e.message || e));
  }
}

// ========== AI 全局框开关 / 检测范围 / 下发 ==========
async function saveAiBox(v: boolean) {
  aiBoxEnabled.value = v;
  try {
    await api.put('/video-binding/ai/box', { enabled: v });
    ElMessage.success(v ? 'AI 检测框已全局开启（LED/投影/手机统一生效）' : 'AI 检测框已全局关闭');
  } catch (e: any) {
    ElMessage.error('全局开关保存失败: ' + (e.message || e));
  }
}

function openAiEditor(ch: CameraChannel) {
  editorTarget.value = ch;
  editorVisible.value = true;
}

async function onAiSaved(payload: { aiEnabled: boolean; countLine: NormPoint[]; roiPolygon: NormPoint[] }) {
  if (!editorTarget.value) return;
  const id = editorTarget.value.id;
  try {
    const res: any = await api.put(`/video-binding/channels/${id}/ai`, payload);
    const body = res?.data ?? res;
    ElMessage.success(body?.message || '检测范围已保存并下发');
    await loadData();
  } catch (e: any) {
    ElMessage.error('检测范围保存失败: ' + (e.message || e));
  }
}

async function pushAiConfig() {
  aiPushing.value = true;
  try {
    const res: any = await api.post('/video-binding/ai/push');
    const body = res?.data ?? res;
    if (body?.success) ElMessage.success('已把当前检测范围重新下发到 AI');
    else ElMessage.warning(body?.message || 'AI 暂不可达，配置已保存');
  } catch (e: any) {
    ElMessage.error('下发失败: ' + (e.message || e));
  } finally {
    aiPushing.value = false;
  }
}

function aiSummary(ch: CameraChannel): string {
  if (ch.aiEnabled === false) return '未分析';
  const n = Array.isArray(ch.roiPolygon) ? ch.roiPolygon.length : 0;
  return n >= 3 ? `区域 ${n} 点` : '全画面';
}

function getNvrName(nvrId: string): string {
  return nvrs.value.find(n => n.id === nvrId)?.name || '未知';
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <div class="video-binding-admin">
    <div class="page-header">
      <h2><Video :size="22" /> 视频绑定管理</h2>
      <p class="desc">配置NVR录像机、摄像头通道及运营大屏显示布局，修改后立即生效，无需重新部署。</p>
    </div>

    <el-tabs v-model="activeTab" class="admin-tabs">
      <!-- NVR设备管理 -->
      <el-tab-pane label="NVR录像机" name="nvrs">
        <div class="toolbar">
          <el-button type="primary" @click="openNvrDialog()">
            <Plus :size="16" /> 添加NVR录像机
          </el-button>
          <el-button @click="loadData()" :loading="loading">
            <RefreshCw :size="16" /> 刷新
          </el-button>
        </div>

        <div class="vb-table-wrap">
        <el-table :data="nvrs" v-loading="loading" border stripe class="vb-table vb-w-nvr" style="width: 100%">
          <el-table-column prop="name" label="设备名称" width="200" />
          <el-table-column prop="ip" label="IP地址" width="140" />
          <el-table-column prop="port" label="HTTP端口" width="100" />
          <el-table-column prop="rtspPort" label="RTSP端口" width="100" />
          <el-table-column prop="username" label="用户名" width="100" />
          <el-table-column prop="brand" label="品牌" width="120">
            <template #default="{ row }">
              <el-tag v-if="row.brand === 'hikvision'" type="primary">海康威视</el-tag>
              <el-tag v-else type="info">{{ row.brand }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="enabled" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '禁用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="220">
            <template #default="{ row }">
              <el-button size="small" @click="testNvrConnection(row)" :loading="testingNvrId === row.id">
                测试连接
              </el-button>
              <el-button size="small" type="primary" @click="openNvrDialog(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="deleteNvr(row)">
                <Trash2 :size="14" />
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>
      </el-tab-pane>

      <!-- 摄像头通道管理 -->
      <el-tab-pane label="摄像头通道" name="channels">
        <div class="toolbar">
          <el-button type="primary" @click="openChannelDialog()">
            <Plus :size="16" /> 添加摄像头通道
          </el-button>
          <el-button @click="loadData()" :loading="loading">
            <RefreshCw :size="16" /> 刷新
          </el-button>
          <span class="ai-box-switch">
            AI 检测框全局显示
            <el-switch :model-value="aiBoxEnabled" @change="saveAiBox" />
          </span>
          <el-button :loading="aiPushing" @click="pushAiConfig">重新下发 AI</el-button>
        </div>

        <div class="vb-table-wrap">
        <el-table :data="channels" v-loading="loading" border stripe class="vb-table vb-w-ch" style="width: 100%">
          <el-table-column prop="alias" label="通道别名" width="140" />
          <el-table-column prop="name" label="通道名称" width="160" />
          <el-table-column label="所属NVR" width="200">
            <template #default="{ row }">{{ getNvrName(row.nvrId) }}</template>
          </el-table-column>
          <el-table-column prop="hikChannel" label="海康通道号" width="120">
            <template #default="{ row }">
              <el-tag size="small">{{ row.hikChannel }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="sortOrder" label="排序" width="80" />
          <el-table-column prop="enabled" label="状态" width="80">
            <template #default="{ row }">
              <el-tag :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '禁用' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="AI 检测范围" width="120">
            <template #default="{ row }">
              <el-tag size="small" :type="row.aiEnabled === false ? 'info' : 'success'">{{ aiSummary(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="280">
            <template #default="{ row }">
              <el-button size="small" @click="openAiEditor(row)">检测范围</el-button>
              <el-button size="small" type="primary" @click="openChannelDialog(row)">编辑</el-button>
              <el-button size="small" type="danger" @click="deleteChannel(row)">
                <Trash2 :size="14" />
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        </div>
      </el-tab-pane>

      <!-- 显示布局配置 -->
      <el-tab-pane label="大屏显示布局" name="layout">
        <div class="layout-config">
          <div class="layout-settings">
            <h3><Settings :size="18" /> 布局设置</h3>
            <div class="setting-row">
              <label>每行显示列数：</label>
              <el-radio-group v-model="layoutColumns">
                <el-radio :value="2">2列</el-radio>
                <el-radio :value="3">3列</el-radio>
                <el-radio :value="4">4列</el-radio>
              </el-radio-group>
            </div>
            <div class="setting-row">
              <label>已选通道数：</label>
              <span class="count">{{ layoutChannelIds.length }} 路</span>
            </div>
            <el-button type="primary" @click="saveLayout()">保存布局</el-button>
          </div>

          <div class="channel-selector">
            <h3><Video :size="18" /> 选择显示的摄像头通道</h3>
            <p class="hint">点击通道卡片添加/移除，已选中的通道会按选择顺序显示在运营大屏上。</p>
            <div class="channel-grid" :style="{ gridTemplateColumns: `repeat(${layoutColumns}, 1fr)` }">
              <div
                v-for="channel in availableChannels"
                :key="channel.id"
                class="channel-card"
                :class="{ selected: layoutChannelIds.includes(channel.id) }"
                @click="toggleChannelInLayout(channel.id)"
              >
                <div class="channel-check">
                  <el-checkbox :model-value="layoutChannelIds.includes(channel.id)" />
                </div>
                <div class="channel-info">
                  <div class="channel-alias">{{ channel.alias }}</div>
                  <div class="channel-name">{{ channel.name }}</div>
                  <div class="channel-nvr">{{ getNvrName(channel.nvrId) }} · {{ channel.hikChannel }}</div>
                </div>
                <div class="channel-order" v-if="layoutChannelIds.includes(channel.id)">
                  {{ layoutChannelIds.indexOf(channel.id) + 1 }}
                </div>
              </div>
            </div>
          </div>

          <div class="layout-preview">
            <h3><Play :size="18" /> 大屏预览（{{ layoutChannelIds.length }}路）</h3>
            <div class="preview-grid" :style="{ gridTemplateColumns: `repeat(${layoutColumns}, 1fr)` }">
              <div v-for="(channelId, idx) in layoutChannelIds" :key="channelId" class="preview-cell">
                <div class="preview-num">{{ idx + 1 }}</div>
                <div class="preview-name">{{ channels.find(c => c.id === channelId)?.alias || channelId }}</div>
              </div>
              <div v-if="layoutChannelIds.length === 0" class="preview-empty">
                暂未选择任何通道，请在上方选择要显示的摄像头
              </div>
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- NVR编辑对话框 -->
    <el-dialog v-model="nvrDialogVisible" :title="nvrEditing ? '编辑NVR录像机' : '添加NVR录像机'" width="500px" class="vb-dialog">
      <el-form :model="nvrForm" label-width="100px">
        <el-form-item label="设备名称" required>
          <el-input v-model="nvrForm.name" placeholder="如：消防控制室Port5录像机" />
        </el-form-item>
        <el-form-item label="IP地址" required>
          <el-input v-model="nvrForm.ip" placeholder="如：192.168.1.5" />
        </el-form-item>
        <el-form-item label="HTTP端口">
          <el-input-number v-model="nvrForm.port" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="RTSP端口">
          <el-input-number v-model="nvrForm.rtspPort" :min="1" :max="65535" />
        </el-form-item>
        <el-form-item label="用户名">
          <el-input v-model="nvrForm.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="nvrForm.password"
            type="password"
            show-password
            :placeholder="nvrEditing && nvrForm.hasPassword ? '已配置，留空保持不变' : '请输入密码'"
          />
          <div v-if="nvrEditing" class="form-tip">出于安全原因不回显现有密码；留空保存时沿用原密码。</div>
        </el-form-item>
        <el-form-item label="品牌">
          <el-select v-model="nvrForm.brand">
            <el-option label="海康威视" value="hikvision" />
            <el-option label="大华" value="dahua" />
            <el-option label="其他" value="other" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="nvrForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="nvrDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveNvr">保存</el-button>
      </template>
    </el-dialog>

    <!-- 通道编辑对话框 -->
    <el-dialog v-model="channelDialogVisible" :title="channelEditing ? '编辑摄像头通道' : '添加摄像头通道'" width="500px" class="vb-dialog">
      <el-form :model="channelForm" label-width="100px">
        <el-form-item label="所属NVR" required>
          <el-select v-model="channelForm.nvrId" placeholder="选择NVR录像机">
            <el-option v-for="nvr in nvrs" :key="nvr.id" :label="nvr.name" :value="nvr.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="海康通道号" required>
          <el-input v-model="channelForm.hikChannel" placeholder="如：3701（通道37主码流）" />
          <div class="form-tip">海康威视通道号格式：XXXX01=主码流，XXXX02=子码流，如通道37主码流为3701</div>
        </el-form-item>
        <el-form-item label="通道名称" required>
          <el-input v-model="channelForm.name" placeholder="如：大门、园区主干道" />
        </el-form-item>
        <el-form-item label="通道别名">
          <el-input v-model="channelForm.alias" placeholder="如：D37大门（用于大屏显示标签）" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="channelForm.sortOrder" :min="1" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="channelForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="channelDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveChannel">保存</el-button>
      </template>
    </el-dialog>

    <!-- AI 检测范围编辑器（计数线 + 多边形 ROI，拖拽为主、数值兜底） -->
    <AiRegionEditor
      v-model="editorVisible"
      :channel-id="editorTarget?.id || ''"
      :title="editorTarget?.alias || editorTarget?.name || ''"
      :ai-enabled="editorTarget?.aiEnabled"
      :count-line="editorTarget?.countLine"
      :roi-polygon="editorTarget?.roiPolygon"
      @save="onAiSaved"
    />
  </div>
</template>

<style scoped>
.video-binding-admin {
  padding: 20px;
  min-width: 0;
}

/* 表格在窄屏交给容器做触摸横滑 (列宽固定、合计超 1000px), 而不是把整页撑出横向滚动 */
.vb-table-wrap {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-x: contain;
  /* 右侧收口的关键: 外框/圆角/裁剪交给“固定不动的滚动容器”, 视口右缘永远有完整
     竖线和圆角; 旧方案把框画在随内容横滚、宽 1200 的 .el-table 上, 滚到最右时
     1px 右边框与圆角正好压在容器裁剪线上被切掉, 表现为右侧开口/直角/缺竖线。 */
  border: 1px solid var(--v2-border-soft, rgba(120, 150, 180, .22));
  border-radius: 12px;
  background: var(--v2-surface-1, rgba(13, 28, 44, .35));
}
/* 内部表不再画随横滚移动的外框, 统一由外层 .vb-table-wrap 收口, 避免双框/错位 */
.vb-table-wrap :deep(.el-table) {
  border: 0 !important;
  border-radius: 0 !important;
}
.vb-table-wrap :deep(.el-table::before),
.vb-table-wrap :deep(.el-table::after) { display: none !important; }
/* 让表按列宽总和撑开, 横滚由外层 wrap 承载(手机触摸可靠), 避免 el-table 内部滚动卡死 */
.vb-table-wrap :deep(.el-table.vb-w-nvr) { min-width: 1060px; }
.vb-table-wrap :deep(.el-table.vb-w-ch) { min-width: 1200px; }

.ai-box-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--v2-text-2);
  margin-left: auto;
}

.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px 0;
  font-size: 20px;
}

.page-header .desc {
  margin: 0;
  color: var(--v2-text-3);
  font-size: 14px;
}

.admin-tabs {
  margin-top: 10px;
}

.toolbar {
  margin-bottom: 16px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.layout-config {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}
@media (min-width: 760px) {
  .layout-config { grid-template-columns: 300px 1fr; gap: 20px; }
}

.layout-settings {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  padding: 20px;
  border-radius: 8px;
}

.layout-settings h3,
.channel-selector h3,
.layout-preview h3 {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 16px 0;
  font-size: 16px;
}

.setting-row {
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.setting-row .count {
  font-weight: 600;
  color: var(--v2-primary);
}

.channel-selector {
  margin-bottom: 20px;
}

.hint {
  color: var(--v2-text-3);
  font-size: 13px;
  margin: 0 0 12px 0;
}

.channel-grid {
  display: grid;
  gap: 12px;
}

.channel-card {
  border: 2px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 10px;
  position: relative;
}

.channel-card:hover {
  border-color: var(--v2-border-strong);
}

.channel-card.selected {
  border-color: var(--v2-primary);
  background: var(--v2-primary-soft);
}

.channel-check {
  flex-shrink: 0;
}

.channel-info {
  flex: 1;
  min-width: 0;
}

.channel-alias {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 2px;
}

.channel-name {
  font-size: 13px;
  color: var(--v2-text-2);
  margin-bottom: 2px;
}

.channel-nvr {
  font-size: 12px;
  color: var(--v2-text-3);
}

.channel-order {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  background: var(--v2-primary);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.layout-preview {
  grid-column: 1 / -1;
}

.preview-grid {
  display: grid;
  gap: 8px;
  background: var(--v2-surf-2);
  border: 1px solid var(--v2-border-soft);
  padding: 12px;
  border-radius: 8px;
  min-height: 200px;
}

.preview-cell {
  aspect-ratio: 16/9;
  background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary-soft);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--v2-primary);
}

.preview-num {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}

.preview-name {
  font-size: 12px;
  color: var(--v2-text-3);
}

.preview-empty {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--v2-text-3);
  min-height: 150px;
}

.form-tip {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-top: 4px;
}

/* ============ 手机端 (≤600px) ============ */
@media (max-width: 600px) {
  .video-binding-admin { padding: 12px 10px; }
  .page-header h2 { font-size: 18px; }
  .page-header .desc { font-size: 13px; }
  .toolbar { gap: 8px; }
  .toolbar :deep(.el-button) { margin-left: 0; }
  .ai-box-switch { margin-left: 0; width: 100%; justify-content: space-between; }
  .layout-settings { padding: 14px; }
  /* 通道卡片 / 预览在手机上强制 1~2 列, 覆盖组件内联的 3~4 列, 避免文字挤爆 */
  .channel-grid { grid-template-columns: 1fr !important; gap: 8px; }
  .preview-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
  .channel-card { padding: 10px; }
}
</style>

<!-- 非 scoped: el-dialog 会 teleport 到 body, scoped 选择器命中不了, 单独用全局类控窄屏宽度 -->
<style>
.vb-dialog { width: 92vw !important; max-width: 500px; }
@media (max-width: 600px) {
  .vb-dialog .el-form-item__label {
    justify-content: flex-start;
  }
}
</style>
