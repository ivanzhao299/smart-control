<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { lprService, LPR_GROUPS, type LprDevice, type LprPassRecord, type LprWhitelist } from '@/services/lpr.service';

const tab = ref<'devices' | 'whitelist' | 'records'>('devices');
const loadingDevices = ref(false);
const loadingWl = ref(false);
const loadingRecords = ref(false);
const devices = ref<LprDevice[]>([]);
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
const emptyForm = () => ({ serialno: '', deviceName: '', model: '', ip: '', location: '', passDirection: '' as DevDir, gateIo: 0, enabled: true });
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
  try { devices.value = await lprService.devices(); }
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

async function saveDevice(d: LprDevice): Promise<void> {
  savingDevice.value.add(d.id); savingDevice.value = new Set(savingDevice.value);
  try {
    await lprService.updateDevice(d.id, {
      deviceName: d.deviceName,
      location: d.location,
      gateIo: Number(d.gateIo) || 0,
      passDirection: d.passDirection || null,
    });
    ElMessage.success(`已保存 ${d.deviceName}`);
    await loadDevices();
  } catch (e) { ElMessage.error((e as Error).message || '保存失败'); }
  finally { savingDevice.value.delete(d.id); savingDevice.value = new Set(savingDevice.value); }
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
          <span class="muted">相机上报心跳后会自动登记；也可在此提前按序列号预登记，现场一上线即正确显示。</span>
        </div>
        <AppSkeleton v-if="loadingDevices && devices.length === 0" variant="table" :rows="5" />
        <el-table v-else :data="devices" v-loading="loadingDevices" stripe class="lpr-table">
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
          <el-table-column label="开闸 IO" width="110" align="center">
            <template #default="{ row }"><el-input-number v-model="row.gateIo" :min="0" :max="3" size="small" controls-position="right" style="width: 84px" /></template>
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
          <el-table-column label="操作" width="90" align="center" fixed="right">
            <template #default="{ row }">
              <el-button size="small" type="primary" :loading="savingDevice.has(row.id)" @click="saveDevice(row)">保存</el-button>
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
  </section>
</template>

<style scoped>
.lpr-admin { padding: var(--v2-sp-4); max-width: 1280px; margin: 0 auto; box-sizing: border-box; }
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
</style>
