<script setup lang="ts">
// DALI 总线体检 —— 现场排查"地址重复 / 找不到灯 / 控制不了"。
// 分总线看 1-64 短地址实时占用图, 点任意地址闪灯认位置。全是读+闪, 不写地址(不碰寻址)。
// 手机/平板友好: 8 列槽位图对应 DALI 地址排布, 大点击区, 底部操作条。
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { api } from '@/services/http';

interface Slot { short: number; online: boolean; fault: boolean; name: string | null }
interface GatewayDiag {
  code: string;
  slaveId: number;
  ok: boolean;
  error?: string;
  onlineCount: number;
  faultCount: number;
  slots: Slot[];
}

const router = useRouter();
const gateways = ref<GatewayDiag[]>([]);
const loading = ref(false);
const busy = ref(false);
const selected = ref<{ code: string; short: number; name: string | null } | null>(null);

// 每条总线的"预期灯数"—— 纯前端存 localStorage, 不落库。用来提示在线数对不对得上。
const expected = ref<Record<string, number>>({});
const EXP_KEY = 'sc.dali.expected';
function loadExpected(): void {
  try { expected.value = JSON.parse(localStorage.getItem(EXP_KEY) || '{}'); } catch { expected.value = {}; }
}
function onExpectedInput(code: string, e: Event): void {
  const n = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(n) && n > 0) expected.value[code] = n; else delete expected.value[code];
  localStorage.setItem(EXP_KEY, JSON.stringify(expected.value));
}

async function loadDiag(): Promise<void> {
  loading.value = true;
  try {
    const res = await api.get<{ gateways: GatewayDiag[] }>('/dali-lights/diagnose');
    gateways.value = res.gateways ?? [];
  } catch (err) {
    ElMessage.error('体检失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function slotClass(s: Slot): string {
  if (s.fault) return 's-fault';
  if (s.online) return 's-online';
  return 's-empty';
}
function isSel(code: string, short: number): boolean {
  return selected.value?.code === code && selected.value?.short === short;
}
function pick(code: string, s: Slot): void {
  selected.value = isSel(code, s.short) ? null : { code, short: s.short, name: s.name };
}
function emptyCount(gw: GatewayDiag): number {
  return 64 - gw.onlineCount;
}
// 在线数 vs 预期: 正数=少几盏(失联/被占地址), 负数=多(不太可能), 0=对得上
function shortfall(gw: GatewayDiag): number | null {
  const e = expected.value[gw.code];
  if (!Number.isFinite(e) || e <= 0) return null;
  return e - gw.onlineCount;
}

async function flash(): Promise<void> {
  if (!selected.value || busy.value) return;
  busy.value = true;
  try {
    await api.post('/dali-lights/diagnose/identify', { gatewayCode: selected.value.code, short: selected.value.short });
    ElMessage.success(`地址 #${selected.value.short} 正在闪烁 —— 现场看几盏灯在闪`);
  } catch (err) {
    ElMessage.error('闪烁失败: ' + (err as Error).message);
  } finally {
    busy.value = false;
  }
}
async function power(on: boolean): Promise<void> {
  if (!selected.value || busy.value) return;
  busy.value = true;
  try {
    await api.post('/dali-lights/diagnose/control', { gatewayCode: selected.value.code, short: selected.value.short, on });
    ElMessage.success(`地址 #${selected.value.short} 已${on ? '点亮' : '关闭'}`);
  } catch (err) {
    ElMessage.error('下发失败: ' + (err as Error).message);
  } finally {
    busy.value = false;
  }
}

const totalOnline = computed(() => gateways.value.reduce((a, g) => a + g.onlineCount, 0));

onMounted(() => { loadExpected(); loadDiag(); });
</script>

<template>
  <section class="diag-page">
    <header class="diag-head">
      <button class="icon-btn" @click="router.back()" aria-label="返回"><i class="back-arrow">‹</i></button>
      <div class="head-title">
        <div class="t1">总线体检</div>
        <div class="t2">共在线 {{ totalOnline }} 盏 · {{ gateways.length }} 条总线</div>
      </div>
      <button class="scan-btn" :disabled="loading" @click="loadDiag">
        {{ loading ? '读取中…' : '重新体检' }}
      </button>
    </header>

    <p class="tip">
      挨个点<b>在线地址</b> → 闪烁 → 现场看:闪一个地址却有<b>多盏一起闪</b> = 这几盏共用了地址(冲突);
      某总线在线数<b>少于</b>你装的灯数 = 有灯失联或被别人占了地址。全程只读+闪,不动地址。
    </p>

    <div v-if="gateways.length === 0 && !loading" class="empty">没读到网关。检查 Modbus 链路后点"重新体检"。</div>

    <div v-for="gw in gateways" :key="gw.code" class="bus-block">
      <div class="bus-head">
        <div class="bus-name">
          {{ gw.code }} <span class="bus-sub">从机 {{ gw.slaveId }} 号</span>
        </div>
        <div class="bus-stat">
          <span class="pill on">在线 {{ gw.onlineCount }}</span>
          <span v-if="gw.faultCount" class="pill fault">故障 {{ gw.faultCount }}</span>
          <span class="pill dim">空 {{ emptyCount(gw) }}</span>
        </div>
      </div>

      <div v-if="!gw.ok" class="bus-err">⚠ 这条总线读取失败: {{ gw.error }} —— 网关掉线/接线/地址冲突,先查这里</div>

      <div class="expect-row">
        <label>这条总线实际装了</label>
        <input type="number" min="0" inputmode="numeric" class="expect-input"
               :value="expected[gw.code] ?? ''" placeholder="?" @input="onExpectedInput(gw.code, $event)" />
        <label>盏</label>
        <span v-if="shortfall(gw) !== null" class="diff" :class="{ bad: (shortfall(gw) as number) > 0, ok: shortfall(gw) === 0 }">
          <template v-if="(shortfall(gw) as number) > 0">在线少 {{ shortfall(gw) }} 盏 → 失联或地址被占</template>
          <template v-else-if="shortfall(gw) === 0">对得上 ✓</template>
          <template v-else>在线比预期多 {{ -(shortfall(gw) as number) }} 盏</template>
        </span>
      </div>

      <div class="slot-grid">
        <button
          v-for="s in gw.slots"
          :key="s.short"
          class="slot"
          :class="[slotClass(s), { sel: isSel(gw.code, s.short) }]"
          :title="s.name || ('#' + s.short)"
          @click="pick(gw.code, s)"
        >
          <span class="n">{{ s.short }}</span>
          <span v-if="s.name" class="named" />
        </button>
      </div>
    </div>

    <!-- 选中地址的底部操作条 -->
    <div v-if="selected" class="dock">
      <div class="dock-title">
        地址 #{{ selected.short }}
        <span class="dock-sub">{{ selected.name || '未命名' }} · {{ selected.code }}</span>
      </div>
      <div class="dock-ops">
        <button class="op flash" :disabled="busy" @click="flash">闪烁认位置</button>
        <button class="op" :disabled="busy" @click="power(true)">点亮</button>
        <button class="op" :disabled="busy" @click="power(false)">关灯</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diag-page { min-height: 100vh; padding-bottom: 96px; color: var(--v2-text-1); }
.diag-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; position: sticky; top: 0; z-index: 10;
  background: var(--v2-bg-0); border-bottom: 1px solid var(--v2-border-soft);
}
.icon-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); font-size: 22px; line-height: 1; cursor: pointer; flex: none;
}
.back-arrow { font-style: normal; }
.head-title { flex: 1; min-width: 0; }
.head-title .t1 { font-size: 16px; font-weight: 600; }
.head-title .t2 { font-size: 12px; color: var(--v2-text-3); font-variant-numeric: tabular-nums; }
.scan-btn {
  background: var(--v2-primary-soft); border: 1px solid var(--v2-primary); color: var(--v2-primary);
  border-radius: var(--v2-r-sm); padding: 8px 14px; font-size: 14px; font-weight: 600; cursor: pointer; flex: none;
}
.scan-btn:disabled { opacity: .6; }

.tip { color: var(--v2-text-3); font-size: 12.5px; line-height: 1.7; margin: 10px 14px; }
.tip b { color: var(--v2-text-2); }
.empty { color: var(--v2-text-3); text-align: center; padding: 40px 20px; font-size: 14px; }

.bus-block {
  margin: 0 14px 16px; padding: 12px 14px; border-radius: 12px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
}
.bus-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.bus-name { font-size: 15px; font-weight: 600; }
.bus-sub { font-size: 12px; color: var(--v2-text-3); font-weight: 400; }
.bus-stat { display: flex; gap: 6px; }
.pill { font-size: 11.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--v2-border-soft); font-variant-numeric: tabular-nums; }
.pill.on { color: var(--v2-success); border-color: color-mix(in srgb, var(--v2-success) 40%, transparent); }
.pill.fault { color: var(--v2-danger); border-color: color-mix(in srgb, var(--v2-danger) 40%, transparent); }
.pill.dim { color: var(--v2-text-3); }

.bus-err {
  margin-top: 10px; padding: 8px 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.6;
  color: var(--v2-danger); background: color-mix(in srgb, var(--v2-danger) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--v2-danger) 35%, transparent);
}

.expect-row { display: flex; align-items: center; gap: 6px; margin: 12px 0 10px; font-size: 12.5px; color: var(--v2-text-3); flex-wrap: wrap; }
.expect-input {
  width: 56px; padding: 4px 6px; border-radius: 6px; text-align: center; font-variant-numeric: tabular-nums;
  background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.diff { font-size: 12px; }
.diff.bad { color: var(--v2-danger); }
.diff.ok { color: var(--v2-success); }

.slot-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; }
.slot {
  position: relative; aspect-ratio: 1; display: flex; align-items: center; justify-content: center;
  border-radius: 7px; cursor: pointer; font-variant-numeric: tabular-nums;
  border: 1px solid var(--v2-border-soft); background: var(--v2-surf-2); color: var(--v2-text-3);
}
.slot .n { font-size: 12px; }
.slot.s-online { background: color-mix(in srgb, var(--v2-success) 18%, var(--v2-surf-2)); border-color: color-mix(in srgb, var(--v2-success) 45%, transparent); color: var(--v2-text-1); }
.slot.s-fault { background: color-mix(in srgb, var(--v2-danger) 20%, var(--v2-surf-2)); border-color: color-mix(in srgb, var(--v2-danger) 55%, transparent); color: var(--v2-text-1); }
.slot.s-empty { opacity: .5; }
.slot.sel { outline: 2px solid var(--v2-primary); outline-offset: 1px; border-color: var(--v2-primary); }
.slot .named { position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--v2-primary); }

.dock {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  background: var(--v2-surf-2); border-top: 1px solid var(--v2-border-strong);
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
}
.dock-title { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.dock-sub { font-size: 12px; color: var(--v2-text-3); font-weight: 400; }
.dock-ops { display: flex; gap: 8px; }
.op {
  flex: 1; padding: 10px 8px; border-radius: var(--v2-r-sm); font-size: 14px; cursor: pointer;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.op:disabled { opacity: .5; }
.op.flash { background: var(--v2-primary-soft); border-color: var(--v2-primary); color: var(--v2-primary); font-weight: 600; }
</style>
