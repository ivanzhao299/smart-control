<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  lprService,
  LPR_GROUPS,
  type LprDevice,
  type LprDeviceAdmin,
  type LprPassRecord,
  type LprPlatformConfig,
  type LprWhitelist,
} from '@/services/lpr.service';
import { QuestionFilled } from '@element-plus/icons-vue';

const tab = ref<'devices' | 'whitelist' | 'records'>('devices');
const loadingDevices = ref(false);
const loadingWl = ref(false);
const loadingRecords = ref(false);
const devices = ref<LprDeviceAdmin[]>([]);
const whitelist = ref<LprWhitelist[]>([]);
const records = ref<LprPassRecord[]>([]);
const recordTotal = ref(0);
const savingDevice = ref<Set<number>>(new Set());

// 白名单新增表单
const nfPlate = ref('');
const nfGroup = ref('staff');
const nfRemark = ref('');
const nfOverdue = ref('');
const savingNew = ref(false);

// 添加 / 预登记相机
const devDialog = ref(false);
const bulkMode = ref<'single' | 'bulk'>('single');
const adding = ref(false);
type DevDir = '' | 'in' | 'out';
const emptyForm = () => ({ serialno: '', deviceName: '', model: '', ip: '', location: '', passDirection: '' as DevDir, gateIo: 0, closeGateIo: null as number | null, enabled: true });
const devForm = ref(emptyForm());
const bulkText = ref('');
const BULK_HINT = '每行一台，逗号分隔：序列号,名称,安装位置,型号,IP,方向(in/out),开闸IO(0-3)';

function openAdd(): void {
  devForm.value = emptyForm();
  bulkText.value = '';
  bulkMode.value = 'single';
  devDialog.value = true;
}

async function addDevice(): Promise<void> {
  const f = devForm.value;
  const serialno = f.serialno.trim();
  if (!serialno) { ElMessage.warning('请填写相机序列号'); return; }
  if (!f.deviceName.trim()) { ElMessage.warning('请填写设备名称'); return; }
  adding.value = true;
  try {
    await lprService.createDevice({
      serialno,
      deviceName: f.deviceName.trim(),
      model: f.model.trim() || null,
      ip: f.ip.trim() || null,
      location: f.location.trim() || null,
      gateIo: Number(f.gateIo) || 0,
      closeGateIo: f.closeGateIo === null ? null : Number(f.closeGateIo),
      passDirection: f.passDirection || null,
      enabled: f.enabled,
    });
    ElMessage.success('已添加相机');
    devDialog.value = false;
    await loadDevices();
  } catch (e) { ElMessage.error((e as Error).message || '添加失败'); }
  finally { adding.value = false; }
}

async function bulkAdd(): Promise<void> {
  const rows = bulkText.value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!rows.length) { ElMessage.warning('请先粘贴相机台账'); return; }
  adding.value = true;
  let ok = 0;
  const fail: string[] = [];
  for (const line of rows) {
    const c = line.split(/[,，\t]/).map((x) => x.trim());
    const [serialno, deviceName, location, model, ip, dir, io] = c;
    if (!serialno) { fail.push(`${line}（缺序列号）`); continue; }
    try {
      await lprService.createDevice({
        serialno,
        deviceName: deviceName || `相机 ${serialno.slice(-4)}`,
        location: location || null,
        model: model || null,
        ip: ip || null,
        gateIo: Number(io) || 0,
        passDirection: dir === 'in' || dir === 'out' ? dir : null,
        enabled: true,
      });
      ok += 1;
    } catch (e) { fail.push(`${serialno}：${(e as Error).message || '失败'}`); }
  }
  adding.value = false;
  if (ok > 0) {
    ElMessage.success(`成功录入 ${ok} 台相机`);
    devDialog.value = false;
    await loadDevices();
  }
  if (fail.length) {
    ElMessageBox.alert(fail.join('\n'), `${ok} 台成功，${fail.length} 台失败`, { type: 'warning' });
  }
}

// 平台接入配置（相机 web 后台应配置成的标准参数；只更新系统记录，不远程改相机）
const platformDialog = ref(false);
const savingPlatform = ref(false);
const platform = ref<LprPlatformConfig | null>(null);
async function openPlatform(): Promise<void> {
  platformDialog.value = true;
  try {
    platform.value = await lprService.platformConfig();
  } catch (e) { ElMessage.error((e as Error).message || '加载平台配置失败'); }
}
async function savePlatform(): Promise<void> {
  if (!platform.value) return;
  savingPlatform.value = true;
  try {
    platform.value = await lprService.savePlatformConfig({
      host: platform.value.host,
      httpPort: platform.value.httpPort,
      httpsPort: platform.value.httpsPort,
      cometPath: platform.value.cometPath,
      platePath: platform.value.platePath,
      gioPath: platform.value.gioPath,
      serialPath: platform.value.serialPath,
      gateStatusPath: platform.value.gateStatusPath,
      note: platform.value.note,
    });
    ElMessage.success('已保存平台接入配置（仅更新系统记录与接入指引）');
  } catch (e) { ElMessage.error((e as Error).message || '保存失败'); }
  finally { savingPlatform.value = false; }
}

// 记录筛选
const qPlate = ref('');
const qDate = ref('');
const RECORD_STEP = 50;

const DIR_OPTIONS = [
  { value: '', label: '不区分' },
  { value: 'in', label: '入口（进）' },
  { value: 'out', label: '出口（出）' },
];
function groupLabel(g: string): string { return LPR_GROUPS.find((x) => x.value === g)?.label ?? g; }
function snap(url: string | null): string { return lprService.snapUrl(url); }
function gateLabel(d: LprDevice): string { return d.online ? (d.gateStatusLabel ?? '未知') : '离线'; }
function gateTagType(d: LprDevice): 'success' | 'warning' | 'primary' | 'info' {
  if (!d.online) return 'info';
  if (d.gateStatus === 1) return 'warning';
  if (d.gateStatus === 2) return 'primary';
  return 'success';
}
function releaseTagType(r: string): 'success' | 'primary' | 'danger' | 'info' {
  if (r === 'auto') return 'success';
  if (r === 'manual') return 'primary';
  if (r === 'deny') return 'danger';
  return 'info';
}
function releaseLabel(r: string): string {
  return ({ auto: '自动放行', manual: '手动开闸', deny: '拒绝', none: '未放行' } as Record<string, string>)[r] ?? r;
}
function fmt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadDevices(): Promise<void> {
  loadingDevices.value = true;
  try { devices.value = await lprService.adminDevices(); }
  catch (e) { ElMessage.error((e as Error).message || '加载相机失败'); }
  finally { loadingDevices.value = false; }
}
async function loadWhitelist(): Promise<void> {
  loadingWl.value = true;
  try { whitelist.value = await lprService.whitelist(); }
  catch (e) { ElMessage.error((e as Error).message || '加载白名单失败'); }
  finally { loadingWl.value = false; }
}
async function loadRecords(append = false): Promise<void> {
  loadingRecords.value = true;
  try {
    const res = await lprService.records({
      plate: qPlate.value.trim() || undefined,
      date: qDate.value || undefined,
      limit: RECORD_STEP,
      offset: append ? records.value.length : 0,
    });
    records.value = append ? [...records.value, ...res.list] : res.list;
    recordTotal.value = res.total;
  } catch (e) { ElMessage.error((e as Error).message || '查询失败'); }
  finally { loadingRecords.value = false; }
}

async function saveDevice(d: LprDeviceAdmin): Promise<void> {
  savingDevice.value.add(d.id); savingDevice.value = new Set(savingDevice.value);
  try {
    await lprService.updateDevice(d.id, {
      deviceName: d.deviceName,
      location: d.location,
      gateIo: Number(d.gateIo) || 0,
      closeGateIo: d.closeGateIo === null || d.closeGateIo === undefined ? null : Number(d.closeGateIo),
      passDirection: d.passDirection || null,
      webUser: d.webUser?.trim() || null,
      webPassword: d.webPassword?.trim() || null,
      webUrl: d.webUrl?.trim() || null,
    });
    ElMessage.success(`已保存 ${d.deviceName}`);
    await loadDevices();
  } catch (e) { ElMessage.error((e as Error).message || '保存失败'); }
  finally { savingDevice.value.delete(d.id); savingDevice.value = new Set(savingDevice.value); }
}

/** 删除相机/通道（仅删设备，保留过车/状态历史；在线相机删除后会自动重新登记，故仅用于废弃/测试设备） */
async function deleteDevice(d: LprDeviceAdmin): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除【${d.deviceName}】（${d.serialno}）？\n仅删除该相机通道，过车与道闸状态历史保留。若该相机仍在线，会自动重新登记。`,
      '删除相机',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    );
  } catch { return; }
  try {
    await lprService.deleteDevice(d.id);
    ElMessage.success('已删除相机');
    await loadDevices();
  } catch (e) { ElMessage.error((e as Error).message || '删除失败'); }
}

async function addWhitelist(): Promise<void> {
  const plate = nfPlate.value.trim().toUpperCase().replace(/\s+/g, '');
  if (!plate) { ElMessage.warning('请输入车牌号'); return; }
  savingNew.value = true;
  try {
    await lprService.saveWhitelist({
      plate,
      groupName: nfGroup.value,
      isBlack: nfGroup.value === 'black',
      remark: nfRemark.value.trim() || null,
      overdueTime: nfOverdue.value ? new Date(nfOverdue.value).toISOString() : undefined,
    });
    ElMessage.success('已添加');
    nfPlate.value = ''; nfRemark.value = ''; nfOverdue.value = '';
    await loadWhitelist();
  } catch (e) { ElMessage.error((e as Error).message || '添加失败'); }
  finally { savingNew.value = false; }
}
async function removeWhitelist(w: LprWhitelist): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除白名单车牌 ${w.plate}？`, '删除', { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' });
  } catch { return; }
  try {
    await lprService.removeWhitelist(w.id);
    ElMessage.success('已删除');
    await loadWhitelist();
  } catch (e) { ElMessage.error((e as Error).message || '删除失败'); }
}

function onTab(t: string): void {
  if (t === 'whitelist' && whitelist.value.length === 0) void loadWhitelist();
  if (t === 'records' && records.value.length === 0) void loadRecords(false);
}

onMounted(loadDevices);
</script>

<template>
  <section class="lpr-admin">
    <header class="page-head">
      <h2>车牌道闸</h2>
      <el-button @click="tab === 'devices' ? loadDevices() : tab === 'whitelist' ? loadWhitelist() : loadRecords(false)" :loading="loadingDevices || loadingWl || loadingRecords">刷新</el-button>
    </header>
    <p class="sub">
      臻识车牌识别一体机（HTTP 推送 + comet 长轮询）。此处维护相机通道、道闸开闸 IO、通行方向与白名单；相机上报心跳后自动登记。白名单车牌在有效期内自动抬杆，黑名单一律不放行。
    </p>

    <el-tabs v-model="tab" @tab-change="onTab">
      <!-- 通道设备 -->
      <el-tab-pane label="相机通道" name="devices">
        <div class="dev-toolbar">
          <el-button type="primary" @click="openAdd">添加相机（按序列号预登记）</el-button>
          <el-button @click="openPlatform">平台接入配置</el-button>
          <span class="muted">相机上报心跳后会自动登记；也可在此提前按序列号预登记，现场一上线即正确显示。展开每行可查看相机 web 后台地址与登录账号。</span>
        </div>
        <AppSkeleton v-if="loadingDevices && devices.length === 0" variant="table" :rows="5" />
        <el-table v-else :data="devices" v-loading="loadingDevices" stripe class="lpr-table" row-key="id">
          <el-table-column type="expand">
            <template #default="{ row }">
              <div class="web-admin">
                <div class="web-row">
                  <span class="web-label">web 后台地址</span>
                  <el-input v-model="row.webUrl" size="small" placeholder="留空则按 IP/型号自动生成" style="width: 320px" />
                  <el-link v-if="row.webUrl" :href="row.webUrl" target="_blank" rel="noopener" type="primary" :underline="false" class="web-link">打开相机后台</el-link>
                  <span class="muted">仅园区内网可访问</span>
                </div>
                <div class="web-row">
                  <span class="web-label">账号</span>
                  <el-input v-model="row.webUser" size="small" placeholder="admin" style="width: 160px" />
                  <span class="web-label">密码</span>
                  <el-input v-model="row.webPassword" size="small" placeholder="admin" style="width: 180px" show-password />
                  <el-button size="small" type="primary" :loading="savingDevice.has(row.id)" @click="saveDevice(row)">保存登录信息</el-button>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="设备名称" min-width="150">
            <template #default="{ row }"><el-input v-model="row.deviceName" size="small" /></template>
          </el-table-column>
          <el-table-column label="序列号" min-width="140">
            <template #default="{ row }"><code class="mono">{{ row.serialno }}</code></template>
          </el-table-column>
          <el-table-column label="型号" width="110">
            <template #default="{ row }"><span class="muted">{{ row.model || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="IP" width="130">
            <template #default="{ row }"><code class="mono">{{ row.ip || '—' }}</code></template>
          </el-table-column>
          <el-table-column label="安装位置" min-width="140">
            <template #default="{ row }"><el-input v-model="row.location" size="small" placeholder="如：南门入口" /></template>
          </el-table-column>
          <el-table-column label="开闸 IO" width="100" align="center">
            <template #default="{ row }"><el-input-number v-model="row.gateIo" :min="0" :max="3" size="small" controls-position="right" style="width: 80px" /></template>
          </el-table-column>
          <el-table-column label="关闸 IO" width="120" align="center">
            <template #header><span>关闸 IO<el-icon class="hdr-tip" title="关闸继电器与开闸相邻成对；留空即自动取开闸 IO 的下一路（如开闸 IO0→关闸 IO1），仅特殊接线才需手填"><QuestionFilled /></el-icon></span></template>
            <template #default="{ row }">
              <el-input-number v-model="row.closeGateIo" :min="0" :max="3" :value-on-clear="null" size="small" controls-position="right" placeholder="自动" style="width: 100px" />
            </template>
          </el-table-column>
          <el-table-column label="方向" width="120">
            <template #default="{ row }">
              <el-select v-model="row.passDirection" size="small" style="width: 100px">
                <el-option v-for="o in DIR_OPTIONS" :key="o.value" :label="o.label" :value="o.value || null" />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="在线 / 道闸" width="110" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="gateTagType(row)">{{ gateLabel(row) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150" align="center" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" :loading="savingDevice.has(row.id)" @click="saveDevice(row)">保存</el-button>
              <el-button size="small" type="danger" plain @click="deleteDevice(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 白名单 -->
      <el-tab-pane label="白名单" name="whitelist">
        <div class="wl-add">
          <el-input v-model="nfPlate" placeholder="车牌号，如 鲁Q12345" size="default" class="wl-inp plate" />
          <el-select v-model="nfGroup" size="default" class="wl-inp">
            <el-option v-for="g in LPR_GROUPS" :key="g.value" :label="g.label" :value="g.value" />
          </el-select>
          <el-input v-model="nfRemark" placeholder="备注（单位/姓名）" size="default" class="wl-inp" />
          <el-date-picker v-model="nfOverdue" type="datetime" size="default" class="wl-inp date" placeholder="过期时间（可选）" value-format="YYYY-MM-DDTHH:mm" />
          <el-button type="primary" :loading="savingNew" @click="addWhitelist">添加</el-button>
        </div>
        <AppSkeleton v-if="loadingWl && whitelist.length === 0" variant="table" :rows="5" />
        <el-table v-else :data="whitelist" v-loading="loadingWl" stripe class="lpr-table">
          <el-table-column label="车牌" min-width="130">
            <template #default="{ row }"><strong>{{ row.plate }}</strong></template>
          </el-table-column>
          <el-table-column label="分组" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="row.isBlack ? 'danger' : 'primary'">{{ groupLabel(row.groupName) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="备注" min-width="140">
            <template #default="{ row }"><span class="muted">{{ row.remark || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="有效期" min-width="160">
            <template #default="{ row }">
              <span class="muted">{{ row.overdueTime ? fmt(row.overdueTime) + ' 到期' : '长期有效' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="同步" width="90" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="row.syncState === 'synced' ? 'success' : 'warning'">
                {{ row.syncState === 'synced' ? '已下发' : '待下发' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90" align="center" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="danger" plain @click="removeWhitelist(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 过车记录 -->
      <el-tab-pane label="过车记录" name="records">
        <div class="rec-filter">
          <el-input v-model="qPlate" placeholder="按车牌搜索" clearable class="f-inp" @keyup.enter="loadRecords(false)" />
          <el-date-picker v-model="qDate" type="date" size="default" class="f-inp date" placeholder="日期" value-format="YYYY-MM-DD" />
          <el-button type="primary" @click="loadRecords(false)">查询</el-button>
        </div>
        <AppSkeleton v-if="loadingRecords && records.length === 0" variant="table" :rows="8" />
        <el-table v-else :data="records" v-loading="loadingRecords" stripe class="lpr-table">
          <el-table-column label="抓拍" width="80" align="center">
            <template #default="{ row }">
              <el-image v-if="row.picSmallUrl" :src="snap(row.picSmallUrl)" :preview-src-list="row.picBigUrl ? [snap(row.picBigUrl)] : [snap(row.picSmallUrl)]"
                preview-teleported fit="cover" class="thumb" />
              <span v-else class="muted">无</span>
            </template>
          </el-table-column>
          <el-table-column label="时间" min-width="150">
            <template #default="{ row }"><code class="mono">{{ fmt(row.eventTime) }}</code></template>
          </el-table-column>
          <el-table-column label="车牌" min-width="120">
            <template #default="{ row }">
              <strong>{{ row.license }}</strong>
              <el-tag v-if="row.isOffline" size="small" type="info" class="ml">补传</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="类型 / 颜色" min-width="130">
            <template #default="{ row }"><span class="muted">{{ [row.plateColorLabel, row.plateTypeLabel].filter(Boolean).join(' · ') || '—' }}</span></template>
          </el-table-column>
          <el-table-column label="方向" width="80" align="center">
            <template #default="{ row }">{{ row.passDirection === 'in' ? '进' : row.passDirection === 'out' ? '出' : '—' }}</template>
          </el-table-column>
          <el-table-column label="放行" width="100" align="center">
            <template #default="{ row }"><el-tag size="small" :type="releaseTagType(row.releaseResult)">{{ releaseLabel(row.releaseResult) }}</el-tag></template>
          </el-table-column>
          <el-table-column label="异常" min-width="120">
            <template #default="{ row }">
              <el-tag v-if="row.isFake === 1" size="small" type="danger" class="ml">疑似伪牌</el-tag>
              <el-tag v-if="row.isDanger === 1" size="small" type="danger" class="ml">危险</el-tag>
              <span v-else class="muted">—</span>
            </template>
          </el-table-column>
          <el-table-column label="相机" min-width="130">
            <template #default="{ row }"><code class="mono">{{ row.serialno }}</code></template>
          </el-table-column>
        </el-table>
        <div class="rec-foot">
          <el-button v-if="records.length < recordTotal" @click="loadRecords(true)">加载更多</el-button>
          <span class="muted">共 {{ recordTotal }} 条</span>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 添加 / 预登记相机 -->
    <el-dialog v-model="devDialog" title="添加相机（按序列号预登记）" width="600px" class="lpr-dev-dialog">
      <el-radio-group v-model="bulkMode" size="small" class="dev-mode">
        <el-radio-button label="single">单台</el-radio-button>
        <el-radio-button label="bulk">批量台账</el-radio-button>
      </el-radio-group>

      <div v-if="bulkMode === 'single'" class="dev-form">
        <label class="span2">序列号 <em>*</em>
          <el-input v-model="devForm.serialno" placeholder="相机 serialno，如 84b8b2aa-994565d9" />
        </label>
        <label class="span2">设备名称 <em>*</em>
          <el-input v-model="devForm.deviceName" placeholder="如：北门入口相机" />
        </label>
        <label>安装位置
          <el-input v-model="devForm.location" placeholder="如：北门" />
        </label>
        <label>型号
          <el-input v-model="devForm.model" placeholder="如：C5H / XLT" />
        </label>
        <label>局域网 IP
          <el-input v-model="devForm.ip" placeholder="如：192.168.180.101" />
        </label>
        <label>方向
          <el-select v-model="devForm.passDirection" style="width: 100%">
            <el-option label="入口（进园）" value="in" />
            <el-option label="出口（出园）" value="out" />
            <el-option label="不区分" value="" />
          </el-select>
        </label>
        <label>开闸 IO（第一路为 0）
          <el-input-number v-model="devForm.gateIo" :min="0" :max="3" controls-position="right" style="width: 100%" />
        </label>
        <label>关闸 IO（落杆，留空=自动取开闸+1）
          <el-input-number v-model="devForm.closeGateIo" :min="0" :max="3" :value-on-clear="null" controls-position="right" placeholder="自动 = 开闸 IO + 1" style="width: 100%" />
        </label>
        <label class="en">启用
          <el-switch v-model="devForm.enabled" />
        </label>
      </div>

      <div v-else class="dev-bulk">
        <p class="muted bulk-hint">{{ BULK_HINT }}</p>
        <el-input v-model="bulkText" type="textarea" :rows="11" :placeholder="BULK_HINT" />
      </div>

      <template #footer>
        <el-button @click="devDialog = false">取消</el-button>
        <el-button v-if="bulkMode === 'single'" type="primary" :loading="adding" @click="addDevice">添加</el-button>
        <el-button v-else type="primary" :loading="adding" @click="bulkAdd">批量录入</el-button>
      </template>
    </el-dialog>

    <!-- 平台接入配置 -->
    <el-dialog v-model="platformDialog" title="平台接入配置（相机推送参数）" width="620px">
      <el-alert type="warning" :closable="false" show-icon class="pf-alert"
        title="此地址保存在相机本地，HTTP 协议不支持远程修改已部署相机"
        description="在此修改仅更新系统记录与新相机接入指引，不会自动改相机：换服务器/换 IP（域名不变）只需改 DNS 的 A 记录，相机无需改动；换域名才需现场逐台登录相机 web 后台修改。" />
      <div v-if="platform" class="pf-form">
        <label class="span2">平台主机（域名）
          <el-input v-model="platform.host" placeholder="erp.cnjinhu.com" />
        </label>
        <label>HTTP 端口（XLT）
          <el-input-number v-model="platform.httpPort" :min="1" :max="65535" controls-position="right" style="width: 100%" />
        </label>
        <label>HTTPS 端口（C5H）
          <el-input-number v-model="platform.httpsPort" :min="1" :max="65535" controls-position="right" style="width: 100%" />
        </label>
        <label>心跳 / comet 路径
          <el-input v-model="platform.cometPath" />
        </label>
        <label>车牌识别路径
          <el-input v-model="platform.platePath" />
        </label>
        <label>IO 触发路径
          <el-input v-model="platform.gioPath" />
        </label>
        <label>串口路径
          <el-input v-model="platform.serialPath" />
        </label>
        <label class="span2">道闸状态推送路径（道闸状态改变时相机主动上报）
          <el-input v-model="platform.gateStatusPath" />
        </label>
      </div>
      <template #footer>
        <el-button @click="platformDialog = false">关闭</el-button>
        <el-button type="primary" :loading="savingPlatform" @click="savePlatform">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.lpr-admin { padding: var(--v2-sp-4); max-width: 1280px; margin: 0 auto; box-sizing: border-box; }
.hdr-tip { margin-left: 4px; font-size: 13px; color: var(--v2-text-3); cursor: help; vertical-align: -1px; }
.page-head { display: flex; align-items: center; gap: var(--v2-sp-3); margin-bottom: var(--v2-sp-2); }
.page-head h2 { margin: 0; font-size: 20px; color: var(--v2-text-1); white-space: nowrap; }
.sub { color: var(--v2-text-3); font-size: 13px; line-height: 1.6; margin: 0 0 var(--v2-sp-4); }
.lpr-table { width: 100%; border-radius: var(--v2-r-lg); overflow: hidden; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--v2-text-2); }
.muted { color: var(--v2-text-3); font-size: 13px; }
.ml { margin-left: 6px; }
.wl-add { display: flex; gap: var(--v2-sp-2); flex-wrap: wrap; margin-bottom: var(--v2-sp-3); }
.wl-inp { width: 200px; }
.wl-inp.plate { width: 180px; }
.wl-inp.date { width: 220px; }
.rec-filter { display: flex; gap: var(--v2-sp-2); flex-wrap: wrap; margin-bottom: var(--v2-sp-3); }
.f-inp { width: 200px; }
.f-inp.date { width: 170px; }
.thumb { width: 48px; height: 36px; border-radius: 6px; overflow: hidden; }
.rec-foot { display: flex; align-items: center; gap: var(--v2-sp-3); margin-top: var(--v2-sp-3); }
.dev-toolbar { display: flex; align-items: center; gap: var(--v2-sp-3); flex-wrap: wrap; margin-bottom: var(--v2-sp-3); }
.dev-toolbar .muted { font-size: 12px; }
.dev-mode { margin-bottom: var(--v2-sp-3); }
.dev-form { display: grid; grid-template-columns: 1fr 1fr; gap: var(--v2-sp-3) var(--v2-sp-4); }
.dev-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--v2-text-2); }
.dev-form label.span2 { grid-column: 1 / -1; }
.dev-form label em { color: var(--v2-danger, #f87171); font-style: normal; margin-left: 2px; }
.dev-form label.en { justify-content: flex-end; }
.dev-bulk .bulk-hint { margin: 0 0 8px; line-height: 1.5; }
.web-admin { padding: 8px 16px 12px; display: flex; flex-direction: column; gap: 10px; background: var(--v2-bg-2, rgba(255,255,255,.03)); }
.web-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.web-label { font-size: 12px; color: var(--v2-text-3); min-width: 76px; }
.web-row .muted { font-size: 12px; }
.pf-alert { margin-bottom: 14px; --el-alert-text-color: #7a4b00; }
.pf-alert :deep(.el-alert__title) { color: #7a4b00 !important; font-weight: 600; }
.pf-alert :deep(.el-alert__description) { color: #5c3f0a !important; margin-top: 4px; line-height: 1.5; }
.pf-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
.pf-form label { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--v2-text-2); }
.pf-form label.span2 { grid-column: 1 / -1; }
@media (max-width: 640px) {
  .pf-form { grid-template-columns: 1fr; }
  .web-row .el-input { width: 100% !important; }
  .web-row .el-link { margin-left: 76px; }
}
</style>
