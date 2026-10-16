<script setup lang="ts">
/**
 * 中央空调 — 22 台内机, 1920×1080 一屏不滚动.
 *
 * 交互模型: **选择 与 控制 分离**.
 *   22 台内机 × (开关 + 温度 + 模式 + 风速) 如果每张卡都塞满控件, 一屏必然放不下,
 *   而且 88 个控件同屏也没人找得到。所以卡片只负责"看状态 + 选中", 底部一条控制条
 *   作用于当前选中集合:
 *     选 1 台   → 单机控制 (现场单机测试就是这么用: 选一台, 开, 看哪个房间凉)
 *     选一个组 → 分区控制
 *     选一楼    → 楼层控制
 *     全选      → 集中控制
 *   四种粒度共用同一条控制条和同一个后端接口 (POST /hvac/batch/*), 不需要为每种
 *   粒度各做一套 UI 和一套接口。
 *
 * 编组模式: 选中若干台 → "归到此组" → 选组。跟单机测试是同一个选择习惯,
 * 不用学第二套操作。组名/内机名都能就地改, 全部落库, 不用改代码。
 */
import { ref, type Component } from 'vue';
import { useActivePolling } from '@/composables/useActivePolling';
import { useHvacCatalogActions } from '@/composables/useHvacCatalogActions';
import { useHvacControls } from '@/composables/useHvacControls';
import { useHvacIndoorOrder } from '@/composables/useHvacIndoorOrder';
import { useHvacRuntimeState } from '@/composables/useHvacRuntimeState';
import { useHvacSelection } from '@/composables/useHvacSelection';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Snowflake, Flame, Wind, Sparkles, Droplet,
  Power, Minus, Plus, Thermometer, Pencil, Check, FolderPlus, Trash2, Layers,
  AlertTriangle, RefreshCw,
} from 'lucide-vue-next';
import { type HvacFan, type HvacMode, type HvacZone } from '@/services/hvac.service';
import {
  type HvacFloorFilter,
  type HvacZoneCard,
  type IndoorRow,
} from '@/features/hvac-view-model';

const router = useRouter();
function goBack(): void { void router.push({ name: 'dashboard' }); }

const indoors = ref<IndoorRow[]>([]);
const zones = ref<HvacZone[]>([]);
const floorTab = ref<HvacFloorFilter>('all');
/** 手机端快选条默认折叠成一行横滚 (14 个分组铺 6 行占掉 1/4 屏), 点「展开」才铺开 */
const quickExpanded = ref(false);
const selected = ref<Set<number>>(new Set());
const groupMode = ref(false);

const modes: Array<{ value: HvacMode; label: string; icon: Component }> = [
  { value: 'cool', label: '制冷', icon: Snowflake },
  { value: 'heat', label: '制热', icon: Flame },
  { value: 'fan',  label: '送风', icon: Wind },
  { value: 'auto', label: '自动', icon: Sparkles },
  { value: 'dry',  label: '除湿', icon: Droplet },
];
const fans: Array<{ value: HvacFan; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low',  label: '低' },
  { value: 'mid',  label: '中' },
  { value: 'high', label: '高' },
];

// ============ 内机拖动排序 (业主: "空调内机的位置可以拖动") ============
// 用原生 HTML5 drag & drop, 跟灯光分区拖动一致, 不引第三方库。顺序**存后端**
// (sortOrder): 现场主控机+平板+手机, 只存前端每台顺序都不一样。只在非编组模式
// 拖 (编组模式是"选中移入组", 拖动会跟选中打架); 改名中的那台不给拖。
const {
  dragIndoorIdx,
  dragOverIndoorIdx,
  onIndoorDragStart,
  onIndoorDragOver,
  onIndoorDrop,
  onIndoorDragEnd,
} = useHvacIndoorOrder(indoors);

const {
  visibleIndoors,
  visibleZones,
  ungroupedCount,
  groupedSections,
  zoneCards,
  zoneNameOf,
  selectedRows,
  selectedIdxs,
  overview,
  selectedMode: selMode,
  selectedFan: selFan,
  selectedPower: selOn,
  selectedTemperature: selTemp,
  toggleOne,
  selectAll,
  selectNone,
  invertSelection,
  selectZone,
  isZoneSelected,
  allSelected,
  zoneKey: zkey,
} = useHvacSelection({ indoors, zones, floor: floorTab, selected });

// ============ 分区视图 (2026-07-29 业主: "分组逻辑要像灯光页一样直接组控") ============
// 灯光页的范式: 分区就是一张卡, 卡上直接开关/调参数 —— 不需要"先点快选选中、
// 再到浮层操作"那两步。空调分区卡: 开关 (组内有开着的 → 视为开, 点击全组关;
// 全关 → 点击全组开)、温度步进、模式一排, 全部直接下发到组内全部内机 (走既有
// batch 接口, 后端错峰保护外机)。成员分配仍在「编组」模式里管 (对齐灯光页
// "控制归控制、成员分配归编组"的分工)。默认进「分区」视图; 单台精控切「内机」。
const viewTab = ref<'zones' | 'units'>('zones');

const {
  loading,
  lastPollAt,
  pollFailed,
  loadAll,
  markWrite,
  scheduleTruthRefresh,
  startPolling,
  stopPolling,
} = useHvacRuntimeState({
  indoors,
  zones,
  selected,
  isBusy: () => busy.value,
});
const {
  busy,
  dispatching,
  zoneBusy,
  turnOn,
  turnOff,
  setMode,
  setFan,
  setTemperature,
  zonePower,
  zoneSetTemperature,
  zoneSetMode,
  floorPower,
  stopControls,
} = useHvacControls({
  indoors,
  selectedRows: () => selectedRows.value,
  visibleIndoors: () => visibleIndoors.value,
  floor: () => floorTab.value,
  markWrite,
  scheduleTruthRefresh,
});
function adjustTemp(delta: number): void {
  const next = Math.max(16, Math.min(30, selTemp.value + delta));
  if (next === selTemp.value) return;
  void setTemperature(next);
}

function zoneAdjustTemp(card: HvacZoneCard, delta: number): void {
  const next = Math.max(16, Math.min(30, card.temp + delta));
  if (next === card.temp) return;
  void zoneSetTemperature(card, next);
}

const {
  catalogBusy,
  editingIndoor,
  editingZone,
  editingText,
  bindNameInput,
  startRenameIndoor,
  commitRenameIndoor,
  startRenameZone,
  commitRenameZone,
  assignTo,
  createZone,
  removeZone,
  stopCatalogActions,
} = useHvacCatalogActions({
  indoors,
  zones,
  selectedIdxs: () => selectedIdxs.value,
  floor: () => floorTab.value,
  reload: loadAll,
});

useActivePolling(startPolling, () => {
  stopControls();
  stopCatalogActions();
  stopPolling();
});

const modeIcon = (m: HvacMode): Component => modes.find((x) => x.value === m)?.icon ?? Sparkles;
const modeLabel = (m: HvacMode): string => modes.find((x) => x.value === m)?.label ?? m;
const fanLabel = (f: HvacFan): string => fans.find((x) => x.value === f)?.label ?? f;
</script>

<template>
  <section class="hv-page" :class="{ 'bar-open': groupMode || selected.size > 0 }">
    <!-- ===== 顶栏 ===== -->
    <header class="hv-head">
      <button class="v2-back-btn" @click="goBack" title="返回首页">
        <ArrowLeft :size="18" />
      </button>
      <div class="hv-title"><Snowflake :size="18" :stroke-width="1.8" /> 中央空调</div>

      <div class="v2-tabs">
        <button class="v2-tab" :class="{ active: floorTab === '1F' }" @click="floorTab = '1F'">一楼</button>
        <button class="v2-tab" :class="{ active: floorTab === '2F' }" @click="floorTab = '2F'">二楼</button>
        <button class="v2-tab" :class="{ active: floorTab === 'all' }" @click="floorTab = 'all'">全部</button>
      </div>

      <div class="hv-stats">
        <span><b>{{ overview.onCount }}</b>/{{ overview.knownCount }} 运行</span>
        <span v-if="overview.avgRoomT !== null" title="实测室温均值">
          <Thermometer :size="13" /> {{ overview.avgRoomT }}°C
        </span>
        <span><Layers :size="13" /> {{ overview.zoneCount }} 组</span>
        <span v-if="overview.faultCount" class="warn"><AlertTriangle :size="13" /> {{ overview.faultCount }} 故障</span>
        <span v-if="overview.unknownCount" class="dim" title="本轮未读到状态的内机">
          {{ overview.unknownCount }} 台未知
        </span>
        <span class="poll" :class="{ bad: pollFailed }" :title="pollFailed ? '状态读取失败' : '最近一次读取时间'">
          <RefreshCw :size="12" />
          {{ pollFailed ? '读取失败' : (lastPollAt ? lastPollAt.toLocaleTimeString('zh-CN', { hour12: false }) : '读取中') }}
        </span>
      </div>

      <div class="hv-head-actions">
        <!-- 分区/内机视图切换 (2026-07-29 业主: 分区要像灯光页一样直接组控) -->
        <div v-if="!groupMode" class="v2-tabs">
          <button class="v2-tab" :class="{ active: viewTab === 'zones' }" @click="viewTab = 'zones'">分区</button>
          <button class="v2-tab" :class="{ active: viewTab === 'units' }" @click="viewTab = 'units'">内机</button>
        </div>
        <button class="hv-btn ghost" :class="{ active: groupMode }" @click="groupMode = !groupMode">
          <Layers :size="15" /> {{ groupMode ? '完成编组' : '编组' }}
        </button>
        <button class="hv-btn primary" :disabled="busy" @click="floorPower(true)">全开</button>
        <button class="hv-btn danger" :disabled="busy" @click="floorPower(false)">全关</button>
      </div>
    </header>

    <!-- ===== 快选条 ===== (分区视图不需要"先选后操作", 只在内机/编组视图出现) -->
    <!-- 楼层 chips 已去掉 (和顶部楼层 tab 重复 — 想选整层: 切楼层 tab 后点"全部 N") -->
    <div v-if="groupMode || viewTab === 'units'" class="hv-quick" :class="{ expanded: quickExpanded }">
      <span class="hv-quick-label">快选</span>
      <button class="hv-chip" :class="{ on: allSelected }" @click="selectAll">
        全部 {{ visibleIndoors.length }}
      </button>
      <button class="hv-chip" title="选中的变未选, 未选的变选中" @click="invertSelection">反选</button>
      <span class="hv-quick-sep" />
      <template v-for="z in visibleZones" :key="z.code">
        <input
          v-if="editingZone === z.code" :ref="bindNameInput" v-model="editingText"
          class="hv-chip-input" maxlength="32"
          @keyup.enter="commitRenameZone(z)" @keyup.esc="editingZone = null" @blur="commitRenameZone(z)"
        />
        <button
          v-else class="hv-chip zone" :class="{ on: isZoneSelected(z.code) }"
          @click="selectZone(z.code)"
        >
          {{ z.name }}
          <em>{{ visibleIndoors.filter((i) => i.zoneCode === z.code).length }}</em>
          <template v-if="groupMode">
            <span class="chip-act" :class="{ disabled: catalogBusy }" title="改组名" @click.stop="startRenameZone(z)"><Pencil :size="11" /></span>
            <span class="chip-act danger" :class="{ disabled: catalogBusy }" title="删除组" @click.stop="removeZone(z)"><Trash2 :size="11" /></span>
          </template>
        </button>
      </template>
      <button v-if="ungroupedCount" class="hv-chip warn" :class="{ on: isZoneSelected(null) }" @click="selectZone(null)">
        未分组 <em>{{ ungroupedCount }}</em>
      </button>
      <button v-if="groupMode" class="hv-chip add" :disabled="catalogBusy" @click="createZone"><FolderPlus :size="13" /> 新建组</button>
      <button v-if="selected.size" class="hv-chip clear" @click="selectNone">清空选择</button>
      <button class="hv-chip quick-toggle" @click="quickExpanded = !quickExpanded">
        {{ quickExpanded ? '收起 ▲' : '展开 ▼' }}
      </button>
    </div>

    <!-- ===== 内机网格 =====
         控制模式: 平铺 22 台, 1920 下 6 列一屏不滚动.
         编组模式: 按组分段 —— 结构直接摆在眼前, 移动内机立刻看到它换了位置。
         卡片本体用同一个 <template>, 两个模式共用一份, 不写两遍 (写两遍必然改一处漏一处)。 -->
    <template v-if="!groupMode">
      <!-- ===== 分区视图 (2026-07-29): 分区卡直接组控, 交互对齐灯光页 ===== -->
      <div v-if="viewTab === 'zones'" class="hz-grid" :class="{ loading }">
        <div v-if="zoneCards.length === 0" class="hz-empty">
          还没有分区 — 点右上「编组」新建分组并把内机分进去, 分区卡就会出现在这里
        </div>
        <div
          v-for="c in zoneCards" :key="zkey(c.code)"
          class="hz-card"
          :class="{ on: c.onCount > 0, none: c.code === null, busy: zoneBusy === zkey(c.code) }"
        >
          <div class="hz-top">
            <div class="hz-meta">
              <div class="hz-name">{{ c.name }}</div>
              <!-- 下发中提示放在副标题行**原位替换** — 绝不新增一行把卡撑高 (2026-07-29 业主) -->
              <div class="hz-sub" :class="{ busy: zoneBusy === zkey(c.code) }">
                <template v-if="zoneBusy === zkey(c.code)">逐台错峰下发中…</template>
                <template v-else-if="c.members.length">
                  {{ c.onCount }}/{{ c.members.length }} 台运行<template v-if="c.avgRoomT !== null"> · 室温 {{ c.avgRoomT }}°C</template>
                </template>
                <template v-else>空组 — 在「编组」里把内机分进来</template>
              </div>
            </div>
            <!-- 全组开关: 明确的文字按钮 (2026-07-29 业主: 原 toggle 像个白点看不出是开关)。
                 按钮文字 = 点击后的动作: 全关着显示"开启", 有开着的显示"关闭" -->
            <button
              v-if="c.members.length"
              class="hz-power" :class="c.onCount > 0 ? 'to-off' : 'to-on'"
              :disabled="busy"
              :title="c.onCount > 0 ? '关闭全组' : '开启全组'"
              @click="zonePower(c)"
            >
              <Power :size="15" :stroke-width="2.2" />
              {{ c.onCount > 0 ? '关闭' : '开启' }}
            </button>
          </div>
          <div v-if="c.members.length" class="hz-ctrl">
            <div class="hz-temp">
              <button class="hz-tbtn" :disabled="busy" @click="zoneAdjustTemp(c, -1)"><Minus :size="16" /></button>
              <span class="hz-tval v2-inter">{{ c.temp }}<i>°C</i></span>
              <button class="hz-tbtn" :disabled="busy" @click="zoneAdjustTemp(c, 1)"><Plus :size="16" /></button>
            </div>
            <div class="hz-modes">
              <button
                v-for="m in modes" :key="m.value"
                class="hz-mode" :class="['hzm-' + m.value, { on: c.mode === m.value }]"
                :disabled="busy" :title="m.label"
                @click="zoneSetMode(c, m.value)"
              ><component :is="m.icon" :size="14" /></button>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="hv-grid" :class="{ loading }">
        <template v-for="row in visibleIndoors" :key="row.idx">
      <button
        class="hv-cell"
        :class="[{
          sel: selected.has(row.idx),
          running: row.state.known && row.state.on,
          unknown: !row.state.known,
          fault: row.state.known && row.state.faultCode > 0,
          'drag-over': dragOverIndoorIdx === row.idx,
          dragging: dragIndoorIdx === row.idx,
        }, row.state.known && row.state.on ? 'run-' + row.state.mode : '']"
        :draggable="editingIndoor !== row.idx"
        @dragstart="onIndoorDragStart(row, $event)"
        @dragover="onIndoorDragOver(row, $event)"
        @drop.prevent="onIndoorDrop(row)"
        @dragend="onIndoorDragEnd"
        @click="toggleOne(row.idx)"
      >
        <div class="cell-head">
          <!-- 2026-07-17 业主: "内机卡片去掉勾选框, 使用体验不好, 只要选中后高亮提示就可以了"。
               勾选框在触摸屏上是个 18px 的小方块, 手指点不准, 还占掉卡头一格;
               整张卡本来就是按钮, 选中态改用整卡高亮 (亮边 + 主色底 + 左侧竖条),
               比一个小勾更早被眼睛捕捉到。 -->
          <span class="cell-tag">{{ row.floor }}-{{ row.idx }}</span>
          <span v-if="row.state.known && row.state.faultCode > 0" class="cell-fault" :title="'故障码 ' + row.state.faultCode">
            <AlertTriangle :size="14" /> {{ row.state.faultCode }}
          </span>
          <span
            class="cell-dot"
            :class="{ on: row.state.known && row.state.on, unknown: !row.state.known }"
            :title="!row.state.known ? '未读到状态' : (row.state.on ? '运行中' : '已关机')"
          >{{ !row.state.known ? '未知' : (row.state.on ? '运行' : '关') }}</span>
        </div>

        <div class="cell-name">
          <input
            v-if="editingIndoor === row.idx" :ref="bindNameInput" v-model="editingText"
            class="cell-name-input" maxlength="32"
            @click.stop @keyup.enter="commitRenameIndoor(row)"
            @keyup.esc="editingIndoor = null" @blur="commitRenameIndoor(row)"
          />
          <template v-else>
            <span class="cell-name-text" :title="row.name">{{ row.name }}</span>
            <span class="cell-edit" :class="{ disabled: catalogBusy }" title="改名" @click.stop="startRenameIndoor(row)">
              <Pencil :size="15" />
            </span>
          </template>
        </div>

        <!-- 手机专用一行元信息 (2026-07-25 重构): 桌面隐藏。室温 · 设定+模式(开机) · 分区,
             一行放全超出省略 — 高度从此确定, 不再有"末行被吃" -->
        <div class="cell-mline">
          <span v-if="!row.state.known">未读到状态</span>
          <template v-else>
            <!-- 2026-07-26 业主: "内机卡温度状态都没有了" — 室温/设定改为**始终显示**
                 (关机也显示, 室温没读到显示 –), 不再按开关机/有无读数时隐时现 -->
            <span class="mline-room">室温{{ row.state.roomTemp ?? '–' }}°</span>
            <span v-if="row.state.on" :class="'m-' + row.state.mode">设定{{ row.state.temperature }}° {{ modeLabel(row.state.mode) }}</span>
            <span v-else class="mline-off">设定{{ row.state.temperature }}° 关</span>
            <span class="mline-zone">{{ zoneNameOf(row.zoneCode) }}</span>
          </template>
        </div>

        <!-- 中段占满剩余高度, 温度居中放大 —— 卡片再大也不留空洞 -->
        <div class="cell-body">
          <span v-if="!row.state.known" class="cell-unknown">未读到状态</span>
          <template v-else-if="row.state.on">
            <span class="cell-temp" :class="'m-' + row.state.mode">{{ row.state.temperature }}<i>°C</i></span>
            <span v-if="row.state.roomTemp !== undefined" class="cell-room" title="实测室温">
              室温 {{ row.state.roomTemp }}°
            </span>
          </template>
          <template v-else>
            <span class="cell-off">关机</span>
            <span v-if="row.state.roomTemp !== undefined" class="cell-room">室温 {{ row.state.roomTemp }}°</span>
          </template>
        </div>

        <div class="cell-foot">
          <span v-if="!row.state.known" class="cell-mode dim">—</span>
          <span v-else class="cell-mode" :class="row.state.on ? 'm-' + row.state.mode : 'dim'">
            <component :is="modeIcon(row.state.mode)" :size="15" /> {{ modeLabel(row.state.mode) }}
            <i class="cell-fan">· {{ fanLabel(row.state.fan) }}</i>
          </span>
          <span class="cell-zone" :title="zoneNameOf(row.zoneCode)">{{ zoneNameOf(row.zoneCode) }}</span>
        </div>
      </button>
        </template>
      </div>
    </template>

    <div v-else class="hv-sections" :class="{ loading }">
      <section v-for="sec in groupedSections" :key="sec.code ?? '__none__'" class="hv-sec">
        <header class="sec-head">
          <span class="sec-name" :class="{ none: sec.code === null }">{{ sec.name }}</span>
          <span class="sec-count">{{ sec.rows.length }} 台</span>
          <!-- 动作就在这一段的标题上 —— 想把内机放进这个组, 点的就是这个组本身,
               不用去底部一排同名按钮里找 -->
          <button
            v-if="sec.code !== null"
            class="hv-btn tiny primary" :disabled="catalogBusy || !selected.size"
            :title="selected.size ? `把选中的 ${selected.size} 台移到「${sec.name}」` : '先选中内机'"
            @click="assignTo(sec.code)"
          >移入{{ selected.size ? ` ${selected.size}` : '' }}</button>
          <button
            v-if="sec.code !== null" class="sec-ico" title="改名" :disabled="catalogBusy"
            @click="sec.zone && startRenameZone(sec.zone)"
          ><Pencil :size="14" /></button>
          <button
            v-if="sec.code !== null" class="sec-ico danger" title="删除该组" :disabled="catalogBusy"
            @click="sec.zone && removeZone(sec.zone)"
          ><Trash2 :size="14" /></button>
          <button
            v-if="sec.code === null && sec.rows.length" class="hv-btn tiny ghost"
            @click="selectZone(null)"
          >全选未分组</button>
        </header>
        <div v-if="sec.rows.length" class="sec-grid">
          <template v-for="row in sec.rows" :key="row.idx">
      <button
        class="hv-cell"
        :class="[{
          sel: selected.has(row.idx),
          running: row.state.known && row.state.on,
          unknown: !row.state.known,
          fault: row.state.known && row.state.faultCode > 0,
        }, row.state.known && row.state.on ? 'run-' + row.state.mode : '']"
        @click="toggleOne(row.idx)"
      >
        <div class="cell-head">
          <!-- 2026-07-17 业主: "内机卡片去掉勾选框, 使用体验不好, 只要选中后高亮提示就可以了"。
               勾选框在触摸屏上是个 18px 的小方块, 手指点不准, 还占掉卡头一格;
               整张卡本来就是按钮, 选中态改用整卡高亮 (亮边 + 主色底 + 左侧竖条),
               比一个小勾更早被眼睛捕捉到。 -->
          <span class="cell-tag">{{ row.floor }}-{{ row.idx }}</span>
          <span v-if="row.state.known && row.state.faultCode > 0" class="cell-fault" :title="'故障码 ' + row.state.faultCode">
            <AlertTriangle :size="14" /> {{ row.state.faultCode }}
          </span>
          <span
            class="cell-dot"
            :class="{ on: row.state.known && row.state.on, unknown: !row.state.known }"
            :title="!row.state.known ? '未读到状态' : (row.state.on ? '运行中' : '已关机')"
          >{{ !row.state.known ? '未知' : (row.state.on ? '运行' : '关') }}</span>
        </div>

        <div class="cell-name">
          <input
            v-if="editingIndoor === row.idx" :ref="bindNameInput" v-model="editingText"
            class="cell-name-input" maxlength="32"
            @click.stop @keyup.enter="commitRenameIndoor(row)"
            @keyup.esc="editingIndoor = null" @blur="commitRenameIndoor(row)"
          />
          <template v-else>
            <span class="cell-name-text" :title="row.name">{{ row.name }}</span>
            <span class="cell-edit" :class="{ disabled: catalogBusy }" title="改名" @click.stop="startRenameIndoor(row)">
              <Pencil :size="15" />
            </span>
          </template>
        </div>

        <!-- 手机专用一行元信息 (2026-07-25 重构): 桌面隐藏。室温 · 设定+模式(开机) · 分区,
             一行放全超出省略 — 高度从此确定, 不再有"末行被吃" -->
        <div class="cell-mline">
          <span v-if="!row.state.known">未读到状态</span>
          <template v-else>
            <!-- 2026-07-26 业主: "内机卡温度状态都没有了" — 室温/设定改为**始终显示**
                 (关机也显示, 室温没读到显示 –), 不再按开关机/有无读数时隐时现 -->
            <span class="mline-room">室温{{ row.state.roomTemp ?? '–' }}°</span>
            <span v-if="row.state.on" :class="'m-' + row.state.mode">设定{{ row.state.temperature }}° {{ modeLabel(row.state.mode) }}</span>
            <span v-else class="mline-off">设定{{ row.state.temperature }}° 关</span>
            <span class="mline-zone">{{ zoneNameOf(row.zoneCode) }}</span>
          </template>
        </div>

        <!-- 中段占满剩余高度, 温度居中放大 —— 卡片再大也不留空洞 -->
        <div class="cell-body">
          <span v-if="!row.state.known" class="cell-unknown">未读到状态</span>
          <template v-else-if="row.state.on">
            <span class="cell-temp" :class="'m-' + row.state.mode">{{ row.state.temperature }}<i>°C</i></span>
            <span v-if="row.state.roomTemp !== undefined" class="cell-room" title="实测室温">
              室温 {{ row.state.roomTemp }}°
            </span>
          </template>
          <template v-else>
            <span class="cell-off">关机</span>
            <span v-if="row.state.roomTemp !== undefined" class="cell-room">室温 {{ row.state.roomTemp }}°</span>
          </template>
        </div>

        <div class="cell-foot">
          <span v-if="!row.state.known" class="cell-mode dim">—</span>
          <span v-else class="cell-mode" :class="row.state.on ? 'm-' + row.state.mode : 'dim'">
            <component :is="modeIcon(row.state.mode)" :size="15" /> {{ modeLabel(row.state.mode) }}
            <i class="cell-fan">· {{ fanLabel(row.state.fan) }}</i>
          </span>
          <span class="cell-zone" :title="zoneNameOf(row.zoneCode)">{{ zoneNameOf(row.zoneCode) }}</span>
        </div>
      </button>
          </template>
        </div>
        <div v-else class="sec-empty">还没有内机 — 选中上面的内机后点「移入」</div>
      </section>
    </div>

    <!-- ===== 控制条 (作用于选中集合) ===== -->
    <!-- 2026-07-25 业主整改: 操作条改为固定浮层 — 选中才弹出, 位置固定不动,
         出现/消失不再挤压网格 (页面常驻预留高度); 空态提示删除。 -->
    <footer v-if="groupMode || selected.size" class="hv-bar">
      <div class="bar-sel">
        已选 <b>{{ selected.size }}</b> 台
        <span class="bar-names">{{ selectedRows.map((r) => r.name).join('、') }}</span>
      </div>

      <template v-if="groupMode">
        <!-- 2026-07-17: 这里原本是一排 14 个"归到 XX"按钮 —— 跟顶部快选条同名却不同义,
             而且挤成一堵墙点不准。现在"移入"就在每个组自己的标题上, 点哪个组进哪个组,
             不用在按钮墙里找名字。这里只留"移出分组"这个反向动作。 -->
        <div class="bar-group">
          <span class="bar-hint">选中后点分组标题「移入」</span>
          <button class="hv-btn tiny warn" :disabled="catalogBusy || !selected.size" @click="assignTo(null)">
            移出分组{{ selected.size ? ` (${selected.size})` : '' }}
          </button>
          <button class="hv-btn tiny" :disabled="catalogBusy" @click="createZone"><FolderPlus :size="13" /> 新建组</button>
        </div>
      </template>

      <!-- 2026-07-25 生产级整改: 没选中就没有作用对象 — 控制条整体不渲染,
           手机屏立省 1/4; 只留一行提示。选中后浮出, "已选 N 台"就在旁边, 打到谁一目了然。 -->
      <template v-else-if="selected.size">
        <div class="bar-ctrl">
          <span v-if="dispatching" class="bar-dispatching">逐台下发中…</span>
          <button class="hv-btn primary" :disabled="busy" @click="turnOn">
            <Power :size="15" /> 开
          </button>
          <button class="hv-btn danger" :disabled="busy" @click="turnOff">
            <Power :size="15" /> 关
          </button>

          <div class="bar-temp">
            <button class="temp-btn" :disabled="busy" @click="adjustTemp(-1)"><Minus :size="16" /></button>
            <span class="temp-val">{{ selTemp }}<i>°C</i></span>
            <button class="temp-btn" :disabled="busy" @click="adjustTemp(1)"><Plus :size="16" /></button>
          </div>

          <div class="bar-seg">
            <button
              v-for="m in modes" :key="m.value"
              class="seg" :class="{ on: selMode === m.value }"
              :disabled="busy" @click="setMode(m.value)"
            >
              <component :is="m.icon" :size="14" /> {{ m.label }}
            </button>
          </div>

          <div class="bar-seg">
            <button
              v-for="f in fans" :key="f.value"
              class="seg" :class="{ on: selFan === f.value }"
              :disabled="busy" @click="setFan(f.value)"
            >{{ f.label }}</button>
          </div>

          <span v-if="selected.size && selOn !== null" class="bar-state">
            <Check :size="13" /> {{ selOn ? '运行中' : '已关机' }}
          </span>
        </div>
      </template>
    </footer>
  </section>
</template>

<style scoped>
/* 返回按钮 —— 本页一直漏了这条样式。
   模板用了 .v2-back-btn, 但样式是各页面 scoped 自己写的(灯光/电源/状态页都有),
   唯独这页没写, 于是 <button> 退回浏览器默认样式: 深色界面里一块**白底黑字**,
   刺眼且与全站不一致。补上标准定义。 */
.v2-back-btn {
  width: 36px; height: 36px;
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center;
  cursor: pointer;
  color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }

/* 整页按 1920×1080 排: 顶栏 + 快选 + 网格 + 控制条 = 100vh, 网格自己吃掉剩余空间.
   min-height:0 是关键 —— 没有它 grid 子项撑破 flex 容器, 整页就会出滚动条. */
.hv-page {
  display: flex;
  flex-direction: column;
  /* 2026-07-26 业主: 原 100vh 比容器(.v2-main)高, 溢出才产生滚动+橡皮筋。
     改 100% 精确贴合容器 -> 顶栏固定、只内容区滚, 与灯光/播放器页统一。 */
  height: 100%;
  min-height: 0;
  overflow: hidden;
  /* 没有操作浮层时不要常驻吞掉 108px 内容高度；浮层空间由其对应的滚动容器按需预留。 */
  padding: 10px 14px;
  gap: 8px;
  box-sizing: border-box;
}

/* ---- 顶栏 ---- */
.hv-head { display: flex; align-items: center; gap: 14px; flex: 0 0 auto; flex-wrap: wrap;
  /* 2026-07-26 业主: "顶部还没锁定, 还可以上下滑动" — 双保险: 即使父容器
     (.v2-main) 因高度链断裂发生滚动, sticky 也把顶栏钉在最上, 永不滚出 */
  position: sticky; top: 0; z-index: 5;
  background: var(--v2-bg-0);
  padding-bottom: 4px; }
.hv-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 20px; font-weight: 700; color: var(--v2-text-1, #e8eef7); white-space: nowrap;
}

/* 楼层切换 —— 分段控件 (原来没定义, 吃的是浏览器默认按钮 = "80 年代按钮") */
.v2-tabs {
  display: inline-flex; gap: 4px; padding: 4px; flex: 0 0 auto;
  background: var(--v2-surf-2, #1A1D22);
  border: 1px solid var(--v2-border-soft, #23262C);
  border-radius: 12px;
}
.v2-tab {
  padding: 9px 22px; border-radius: 9px; border: none; cursor: pointer;
  font-size: 16px; font-weight: 500; line-height: 1;
  background: transparent; color: var(--v2-text-3, #9BA1A9);
  transition: background .15s, color .15s;
}
.v2-tab:hover { color: var(--v2-text-1); background: var(--v2-ov-2); }
.v2-tab.active {
  background: var(--v2-primary-fill); color: var(--v2-on-primary); font-weight: 700;
  box-shadow: 0 2px 10px #4da3ff55;
}
.hv-stats {
  display: flex; align-items: center; gap: 14px; margin-left: auto;
  font-size: 12px; color: var(--v2-text-3, #9BA1A9);
}
.hv-stats span { display: inline-flex; align-items: center; gap: 4px; }
.hv-stats b { color: var(--v2-primary, #4C9AFF); font-size: 14px; }
.hv-stats .warn { color: var(--v2-warning); }
.hv-stats .dim { color: var(--v2-text-3); }
.hv-stats .poll { color: var(--v2-text-3); font-variant-numeric: tabular-nums; }
.hv-stats .poll.bad { color: var(--v2-danger); }
.hv-head-actions { display: flex; gap: 8px; flex-wrap: wrap; min-width: 0; }

/* ---- 分区视图 (2026-07-29 业主: 分区卡直接组控, 对齐灯光页) ---- */
.hz-grid {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  align-content: start; box-sizing: border-box; scroll-padding-bottom: 16px;
}
.hz-empty { grid-column: 1 / -1; text-align: center; color: var(--v2-text-3); padding: 44px 16px; font-size: 14px; line-height: 1.7; }
.hz-card {
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft, #23262C);
  border-radius: 13px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 12px;
}
.hz-card.on {
  border-color: color-mix(in srgb, var(--v2-primary) 45%, transparent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--v2-primary) 9%, var(--v2-surf-1)), var(--v2-surf-1));
}
.hz-card.none { border-style: dashed; }
.hz-card.busy { opacity: 0.8; }
.hz-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.hz-name { font-size: 16px; font-weight: 600; color: var(--v2-text-1); }
.hz-sub { margin-top: 3px; font-size: 12px; color: var(--v2-text-3); }
.hz-ctrl { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.hz-temp { display: flex; align-items: center; gap: 8px; }
.hz-tbtn {
  width: 38px; height: 38px; border-radius: 9px; cursor: pointer;
  display: grid; place-items: center;
  background: var(--v2-surf-2, #1A1D22); color: var(--v2-text-1);
  border: 1px solid var(--v2-border-soft, #23262C);
}
.hz-tbtn:disabled { opacity: 0.4; cursor: default; }
.hz-tval { font-size: 22px; font-weight: 600; color: var(--v2-text-1); min-width: 56px; text-align: center; }
.hz-tval i { font-style: normal; font-size: 12px; color: var(--v2-text-3); margin-left: 2px; }
.hz-modes { display: flex; gap: 6px; }
.hz-mode {
  width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  display: grid; place-items: center;
  background: var(--v2-surf-2, #1A1D22); color: var(--v2-text-2);
  border: 1px solid var(--v2-border-soft, #23262C);
}
.hz-mode:disabled { opacity: 0.4; cursor: default; }
/* 模式色与内机卡一致: 制冷蓝/制热橙/送风青/自动蓝紫/除湿紫 */
.hz-mode.on.hzm-cool { color: #38d6ff; border-color: color-mix(in srgb, #38d6ff 55%, transparent); background: color-mix(in srgb, #38d6ff 14%, var(--v2-surf-2)); }
.hz-mode.on.hzm-heat { color: #ff8a4d; border-color: color-mix(in srgb, #ff8a4d 55%, transparent); background: color-mix(in srgb, #ff8a4d 14%, var(--v2-surf-2)); }
.hz-mode.on.hzm-fan  { color: #4ce0be; border-color: color-mix(in srgb, #4ce0be 55%, transparent); background: color-mix(in srgb, #4ce0be 14%, var(--v2-surf-2)); }
.hz-mode.on.hzm-auto { color: #7db6ff; border-color: color-mix(in srgb, #7db6ff 55%, transparent); background: color-mix(in srgb, #7db6ff 14%, var(--v2-surf-2)); }
.hz-mode.on.hzm-dry  { color: #9d8bff; border-color: color-mix(in srgb, #9d8bff 55%, transparent); background: color-mix(in srgb, #9d8bff 14%, var(--v2-surf-2)); }
.hz-sub.busy { color: var(--v2-primary); }
/* 全组开关按钮: 文字+图标, 一眼是开关; 触摸目标 ≥36px (UI 铁律) */
.hz-power {
  display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto;
  min-height: 38px; padding: 8px 16px; border-radius: 10px; cursor: pointer;
  font-size: 14px; font-weight: 600;
}
.hz-power.to-on {
  background: var(--v2-primary-fill); color: var(--v2-on-primary, #fff);
  border: 1px solid var(--v2-primary-fill);
}
.hz-power.to-off {
  background: rgba(229, 100, 93, 0.12); color: var(--v2-danger, #E5645D);
  border: 1px solid rgba(229, 100, 93, 0.4);
}
.hz-power:disabled { opacity: 0.45; cursor: not-allowed; }
@media (max-width: 1600px) { .hz-grid { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 1100px) { .hz-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px)  { .hz-grid { grid-template-columns: 1fr; gap: 8px; } .hz-card { padding: 12px 14px; } }

/* ---- 快选条 ---- */
.hv-quick {
  display: flex; align-items: center; gap: 6px; flex: 0 0 auto;
  flex-wrap: wrap; padding: 6px 8px;
  background: var(--v2-surf-1, #14161A); border-radius: 8px;
}
.hv-quick-label { font-size: 11px; color: var(--v2-text-3, #9BA1A9); margin-right: 2px; white-space: nowrap; flex: 0 0 auto; }
.hv-quick-sep { width: 1px; height: 16px; background: var(--v2-border-soft, #23262C); margin: 0 4px; }
.hv-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 9px; border-radius: 999px; cursor: pointer;
  font-size: 12px; line-height: 1;
  background: var(--v2-surf-2, #1A1D22); color: var(--v2-text-1, #e8eef7);
  border: 1px solid var(--v2-border-soft, #23262C);
}
.hv-chip:hover { border-color: var(--v2-primary, #4C9AFF); }
.hv-chip.on { background: var(--v2-primary-fill); border-color: var(--v2-primary-fill); color: var(--v2-on-primary); font-weight: 600; }
.hv-chip em { font-style: normal; opacity: .6; font-size: 11px; }
.hv-chip.warn { border-color: #b8860055; color: #e8b339; }
.hv-chip.warn.on { background: #e8b339; color: #2a1d00; }
.hv-chip.add { border-style: dashed; color: var(--v2-primary, #4C9AFF); }
.hv-chip.clear { margin-left: auto; color: var(--v2-text-3, #9BA1A9); }
/* 展开/收起 chip 只在手机端出现 (桌面 1920 快选一行放得下, 不需要折叠) */
.hv-chip.quick-toggle { display: none; }
.hv-chip-input {
  width: 110px; padding: 4px 9px; font-size: 12px; line-height: 1;
  color: var(--v2-text-1); background: var(--v2-inset-bg);
  border: 1px solid var(--v2-primary); border-radius: 999px; outline: none;
}
.chip-act {
  display: inline-flex; padding: 2px; border-radius: 4px; opacity: .65;
}
.chip-act:hover { opacity: 1; background: #ffffff22; }
.chip-act.danger:hover { background: #ff4d4f44; color: #ff7875; }
.chip-act.disabled { opacity: .25; pointer-events: none; }

/* ---- 内机网格: 6 列铺满剩余高度, 22 台 = 4 行 ---- */
.hv-grid {
  flex: 1 1 auto; min-height: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  /* 行高按"全部"tab 的设计行数固定 (6 列 x 22 台 = 4 行), 而不是 1fr 均分:
     切到一楼/二楼后内机少、行数少, 1fr 会把卡片撑成巨大 (业主 2026-07-25:
     "一二楼的卡片大小可以和全部相同")。固定基准后楼层 tab 下卡片大小不变,
     下方留白; % 相对网格容器高, 各屏自适应。24px = 3 个 gap。 */
  /* 2026-07-27 业主: "卡片高度不够容纳文本, 内容被切掉"。行高从"定死"改成
     minmax(设计基准, auto) —— 正常情况维持设计尺寸不变, 文本多一行 (长分区名换行/
     室温+设定始终显示) 时该行自动长高, 内容永不被裁; 超出容器就靠下面的滚动。 */
  grid-auto-rows: minmax(calc((100% - 24px) / 4), auto);
  gap: 8px;
  overflow-y: auto;   /* 兜底: 万一以后加内机超出设计行数, 微滚而不是裁切 */
  box-sizing: border-box;
  scroll-padding-bottom: 16px;
}
.hv-grid.loading { opacity: .5; pointer-events: none; }

.hv-cell {
  display: flex; flex-direction: column;
  padding: 12px 16px; text-align: left; cursor: pointer;
  min-height: 0; overflow: hidden;
  background: var(--v2-surf-1, #14161A);
  border: 2px solid var(--v2-border-soft, #23262C);
  border-radius: 14px;
  transition: border-color .12s, background .12s, box-shadow .12s;
}
.hv-cell:hover { border-color: var(--v2-border-strong); }
/* 拖动排序 (业主要的"内机位置可拖动"): 抓手光标 + 拖动中半透 + 落点虚线框 */
.hv-cell[draggable="true"] { cursor: grab; }
.hv-cell.dragging { opacity: 0.45; cursor: grabbing; }
.hv-cell.drag-over { border-color: var(--v2-primary, #4C9AFF); box-shadow: 0 0 0 2px var(--v2-primary, #4C9AFF) inset; }
/* 运行卡片: 有色底 + 左侧彩条, 关机卡片纯深灰 —— 开关机一眼可辨。
   2026-07-25: 彩条/底色跟随**模式**着色 (制冷蓝/制热橙/送风青/除湿紫) ——
   全场哪台在制冷哪台在制热, 扫一眼就分得出, 不用逐张读字。 */
.hv-cell.running {
  background: linear-gradient(160deg, color-mix(in srgb, #38a9e0 16%, var(--v2-surf-1)), var(--v2-surf-1));
  border-color: color-mix(in srgb, #38a9e0 35%, var(--v2-border-soft));
  box-shadow: inset 3px 0 0 #38a9e0;
}
.hv-cell.run-heat { background: linear-gradient(160deg, color-mix(in srgb, #ff8a4d 15%, var(--v2-surf-1)), var(--v2-surf-1)); border-color: color-mix(in srgb, #ff8a4d 35%, var(--v2-border-soft)); box-shadow: inset 3px 0 0 #ff8a4d; }
.hv-cell.run-fan  { background: linear-gradient(160deg, color-mix(in srgb, #4ce0be 15%, var(--v2-surf-1)), var(--v2-surf-1)); border-color: color-mix(in srgb, #4ce0be 35%, var(--v2-border-soft)); box-shadow: inset 3px 0 0 #4ce0be; }
.hv-cell.run-dry  { background: linear-gradient(160deg, color-mix(in srgb, #9d8bff 15%, var(--v2-surf-1)), var(--v2-surf-1)); border-color: color-mix(in srgb, #9d8bff 35%, var(--v2-border-soft)); box-shadow: inset 3px 0 0 #9d8bff; }
/* run-cool / run-auto 沿用默认蓝 */
/* 未知: 斜纹底 + 虚线框 —— 一眼跟"关机"区分开, 不靠颜色深浅 */
.hv-cell.unknown {
  border-style: dashed;
  border-color: #3c4a5e;
  background: repeating-linear-gradient(45deg, var(--v2-surf-1), var(--v2-surf-1) 7px, var(--v2-ov-1) 7px, var(--v2-ov-1) 14px);
}
.hv-cell.fault { border-color: #a9541f; }
/* 选中态: 粗蓝边 + 蓝底 + 外发光, 三重冗余 —— 现场大屏斜着看也一眼分得清选没选 */
/* 选中态 —— 勾选框拿掉后, 这里必须一眼就能认出来 (业主: "选择和取消选择状态要
   交待清楚, 别搞的稀里糊涂看不清楚")。三重信号叠加, 隔两米也看得见:
     1) 整圈亮边 + 外发光   2) 主色渐变底   3) 左侧一条实心竖条
   只靠边框深浅是不够的 —— 展厅光线亮, 平板反光, 细边看不出来。 */
.hv-cell.sel {
  border-color: var(--v2-primary, #4C9AFF);
  background: linear-gradient(160deg, color-mix(in srgb, var(--v2-primary) 26%, var(--v2-surf-1)), color-mix(in srgb, var(--v2-primary) 10%, var(--v2-surf-1)));
  box-shadow: 0 0 0 2px var(--v2-primary, #4C9AFF), 0 0 22px #4da3ff55, 0 6px 18px #0a1a2e88;
}
/* 左侧竖条: 卡片密排时, 边框会跟邻居的边框糊在一起, 这条竖条不会 */
.hv-cell.sel::before {
  content: ''; position: absolute; left: 0; top: 10px; bottom: 10px; width: 4px;
  border-radius: 0 3px 3px 0; background: var(--v2-primary, #4C9AFF);
}
.hv-cell { position: relative; }

/* ---- 头部: 复选框 + 编号 + 运行徽标 ---- */
.cell-head { display: flex; align-items: center; gap: 8px; }
.cell-tag { font-size: 14px; font-weight: 600; color: var(--v2-text-3, #9BA1A9); letter-spacing: .3px; }
.cell-fault {
  display: inline-flex; align-items: center; gap: 3px; margin-left: auto;
  font-size: 13px; font-weight: 600; color: #ff9a52;
}
/* 运行状态做成文字徽标, 不是小圆点 —— 远处也读得出"运行/关/未知" */
.cell-dot {
  margin-left: auto; padding: 3px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 600; line-height: 1;
  background: var(--v2-ov-2); color: var(--v2-text-2); flex: 0 0 auto;
}
.cell-dot.on { background: color-mix(in srgb, var(--v2-success) 22%, var(--v2-surf-1)); color: color-mix(in srgb, var(--v2-success) 70%, var(--v2-text-1)); }
.cell-dot.unknown { background: transparent; border: 1px dashed var(--v2-border-strong); color: var(--v2-text-3); }
.cell-fault + .cell-dot { margin-left: 6px; }

/* ---- 名字 (可改) ---- */
.cell-name { display: flex; align-items: center; gap: 6px; margin-top: 8px; min-height: 28px; }
.cell-name-text {
  font-size: 21px; font-weight: 600; color: var(--v2-text-1, #e8eef7); line-height: 1.1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cell-edit { opacity: 0; padding: 3px; border-radius: 5px; color: var(--v2-text-3, #9BA1A9); flex: 0 0 auto; }
.hv-cell:hover .cell-edit { opacity: .7; }
.cell-edit:hover { opacity: 1 !important; background: #ffffff22; }
.cell-edit.disabled { opacity: .2 !important; pointer-events: none; }
.cell-name-input {
  width: 100%; font-size: 21px; font-weight: 600; padding: 2px 6px;
  color: var(--v2-text-1); background: var(--v2-inset-bg); 
  border: 2px solid var(--v2-primary); border-radius: 6px; outline: none;
}

/* ---- 中段: 撑满剩余高度, 温度居中放大, 卡片再大也不空 ---- */
.cell-body {
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; justify-content: center; gap: 4px;
}
.cell-temp { font-size: 46px; font-weight: 400; color: var(--v2-text-1); line-height: 1; letter-spacing: -1px; }
.cell-temp i { font-size: 20px; font-style: normal; opacity: .6; margin-left: 2px; }
.cell-room { font-size: 15px; color: var(--v2-text-2); }
/* 关机灰、运行彩 —— 灰/彩对比让开关机一眼可辨 */
.cell-off { font-size: 30px; font-weight: 300; color: var(--v2-text-3); line-height: 1; }
.cell-unknown { font-size: 20px; color: var(--v2-text-3); font-style: italic; }

/* 温度 / 模式标签按空调模式配色 */
/* 模式色与 text-1 混合: 深色主题≈原亮色, 浅色主题自动压深 (2026-07-25 浅色适配) */
.cell-temp.m-cool, .cell-mode.m-cool { color: color-mix(in srgb, #38d6ff 62%, var(--v2-text-1)); }
.cell-temp.m-heat, .cell-mode.m-heat { color: color-mix(in srgb, #ff8a4d 62%, var(--v2-text-1)); }
.cell-temp.m-fan,  .cell-mode.m-fan  { color: color-mix(in srgb, #4ce0be 62%, var(--v2-text-1)); }
.cell-temp.m-auto, .cell-mode.m-auto { color: color-mix(in srgb, #7db6ff 62%, var(--v2-text-1)); }
.cell-temp.m-dry,  .cell-mode.m-dry  { color: color-mix(in srgb, #9d8bff 62%, var(--v2-text-1)); }
.cell-temp.m-cool { text-shadow: 0 0 20px #38d6ff44; }
.cell-temp.m-heat { text-shadow: 0 0 20px #ff8a4d44; }

/* ---- 底部: 模式/风速 + 分区 ---- */
.cell-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; }
.cell-mode {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 15px; font-weight: 500; color: var(--v2-text-2); white-space: nowrap;
}
.cell-mode.dim { color: var(--v2-text-3); }
.cell-fan { font-style: normal; opacity: .7; }
.cell-zone {
  font-size: 14px; color: var(--v2-text-3, #9BA1A9);
  max-width: 55%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

/* ---- 控制条 ---- */
/* 控制条: 触摸屏用, 按钮做大做够点得着 (目标高度 ~48px) */
.hv-bar {
  /* 固定浮层 (2026-07-25): 出现/消失不改变网格高度, "弹出后固定不动" */
  position: fixed;
  left: 14px; right: 14px;
  bottom: max(12px, env(safe-area-inset-bottom));
  z-index: 300;
  display: flex; align-items: center; gap: 12px;
  flex-wrap: wrap;
  padding: 10px 16px;
  background: color-mix(in srgb, var(--v2-surf-1) 92%, transparent);
  backdrop-filter: blur(10px);
  border: 1px solid var(--v2-border-strong, #32363E);
  border-radius: 14px;
  box-shadow: var(--v2-elev-3, 0 24px 56px -16px rgba(0,0,0,.7));
}
.bar-sel {
  display: flex; align-items: baseline; gap: 6px;
  font-size: 13px; color: var(--v2-text-3, #9BA1A9);
  flex: 0 0 auto;
}
.bar-sel b { font-size: 20px; color: var(--v2-primary, #4C9AFF); }
.bar-names {
  font-size: 12px; color: #6d7f98;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* 2026-07-17 业主: "空调控制页面下端没有风量大小调节"。
   风量一直是有的 —— 它被**裁掉了**: 这里原本写死 flex-wrap:nowrap, 而 .hv-page 是
   overflow:hidden, 于是屏幕一窄, 排在最后的风量组就被挤出可视区直接消失。
   768 平板上实测: 风量组 left=1143 right=1363, 而视口只有 768 宽 —— 差了 400 多像素,
   控制条整体溢出 428px。允许换行, 宁可多占一行也不能让控件人间蒸发。 */
.bar-ctrl, .bar-group { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.bar-hint { font-size: 14px; color: var(--v2-text-3, #9BA1A9); }
.bar-state {
  display: inline-flex; align-items: center; gap: 5px;
  margin-left: auto; font-size: 14px; color: #35d07f;
}
/* 开/关机错峰逐台下发中 (22 台约 10s) — 明示进行中, 别让人以为卡死狂点 */
.bar-dispatching {
  position: absolute; top: -22px; left: 16px;   /* 浮在条上方, 出现时按钮不移位 */
  font-size: 12px; color: var(--v2-warning); animation: hvPulse 1.2s ease-in-out infinite;
}
@keyframes hvPulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

.bar-temp {
  display: flex; align-items: center; gap: 10px;
  padding: 5px 10px; border-radius: 12px;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C);
}
.temp-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 44px; height: 44px; border-radius: 10px; cursor: pointer;
  background: var(--v2-surf-2); color: var(--v2-text-1); border: 1px solid var(--v2-border-soft);
}
.temp-btn:hover:not(:disabled) { background: var(--v2-primary, #4C9AFF); color: #04101d; }
.temp-btn:active:not(:disabled) { transform: scale(.94); }
.temp-btn:disabled { opacity: .35; cursor: not-allowed; }
.temp-val { font-size: 28px; font-weight: 400; min-width: 80px; text-align: center; color: var(--v2-text-1, #e8eef7); }
.temp-val i { font-size: 15px; font-style: normal; opacity: .55; }

.bar-seg {
  display: flex; gap: 3px; padding: 3px; border-radius: 12px;
  background: var(--v2-surf-2, #1A1D22); border: 1px solid var(--v2-border-soft, #23262C);
}
.seg {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 11px 16px; border-radius: 9px; cursor: pointer; border: none;
  font-size: 15px; font-weight: 500; background: transparent; color: var(--v2-text-3, #9BA1A9);
  white-space: nowrap;
}
.seg:hover:not(:disabled) { color: var(--v2-text-1, #e8eef7); background: #23262C; }
.seg.on { background: var(--v2-primary-fill); color: var(--v2-on-primary); font-weight: 700; }
.seg:active:not(:disabled) { transform: scale(.96); }
.seg:disabled { opacity: .35; cursor: not-allowed; }

/* ---- 按钮 ---- */
.hv-btn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px; border-radius: 10px; cursor: pointer;
  font-size: 15px; font-weight: 500; white-space: nowrap;
  background: var(--v2-surf-2, #1A1D22);
  border: 1px solid var(--v2-border-soft, #23262C);
  color: var(--v2-text-1, #e8eef7);
}
.hv-btn:hover:not(:disabled) { border-color: var(--v2-primary, #4C9AFF); }
.hv-btn:active:not(:disabled) { transform: scale(.97); }
.hv-btn:disabled { opacity: .35; cursor: not-allowed; }
.hv-btn.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; }
.hv-btn.danger { background: color-mix(in srgb, var(--v2-danger) 16%, var(--v2-surf-1)); border-color: color-mix(in srgb, var(--v2-danger) 45%, var(--v2-border-soft)); color: var(--v2-danger); }
.hv-btn.warn { border-color: #b8860055; color: #e8b339; }
.hv-btn.ghost.active { background: var(--v2-primary-fill); border-color: var(--v2-primary-fill); color: var(--v2-on-primary); }
.hv-btn.tiny { padding: 8px 14px; font-size: 14px; }

/* 控制条里的主/次动作按钮 (开/关) 是主操作, 再放大一档, 点得爽 */
.bar-ctrl .hv-btn.primary,
.bar-ctrl .hv-btn.danger {
  padding: 12px 26px; font-size: 17px; font-weight: 700; border-radius: 12px;
}

/* 操作浮层只在出现时占滚动尾部，最后一张卡可以完整滚到浮层上方。 */
.hv-page.bar-open .hv-grid,
.hv-page.bar-open .hv-sections {
  padding-bottom: 116px;
  scroll-padding-bottom: 116px;
}

/* 1600 及以下: 6 列会挤, 降到 5 列 (22 台 = 5 行, 行高 ~170px). 温度收到 40px
   刚好在 5 行时不裁切, 而 10 台 (2 行) 时卡片高、40px 居中依然大气. */
@media (max-width: 1600px) {
  /* 5 列 x 22 = 5 行基准 (4 gap = 32px) */
  .hv-grid { grid-template-columns: repeat(5, 1fr); grid-auto-rows: minmax(calc((100% - 32px) / 5), auto); }
  .bar-names { display: none; }
  .cell-temp { font-size: 40px; }
  .cell-temp i { font-size: 18px; }
  .cell-off { font-size: 27px; }
}
/* 更窄: 4 列 → 22 台 6 行, 行更矮, 再收一档字, 保证不滚动 */
@media (max-width: 1280px) {
  /* 4 列 x 22 = 6 行基准 (5 gap = 40px) */
  .hv-grid { grid-template-columns: repeat(4, 1fr); grid-auto-rows: minmax(calc((100% - 40px) / 6), auto); }
  .hv-cell { padding: 10px 12px; }
  .cell-name-text { font-size: 18px; }
  .cell-temp { font-size: 32px; }
  .cell-off { font-size: 22px; }
  .cell-mode, .cell-zone, .cell-room { font-size: 13px; }
}

/* 平板 (业主实际拿在手里的那块) — 2026-07-17 之前这一档**完全没做**, 断点只到 1280,
   于是 768 上整页横向溢出 595px、控制条溢出 428px, 风量组被推到 x=1143 (视口才 768) 后
   被 overflow:hidden 裁掉 —— 业主看到的就是"没有风量调节"。
   这一档的原则跟 1920 相反: **不再强求一屏不滚动**。22 台内机 × 可读的字号, 768 宽
   物理上放不下; 硬塞的结果就是 cell-body 被压到 13px、温度和"关机"叠在一起(实测)。
   宁可让网格自己滚, 也不能让内容糊成一团或凭空消失。 */
@media (max-width: 900px) {
  /* 100dvh 比 .v2-main 实际可用高度 (去掉顶栏/底栏) 高, 撑破父容器 → 整页
     可滚、顶部跟着滚走 (2026-07-26 业主实测)。改 100% 精确贴合父容器。 */
  .hv-page { height: 100%; padding: 8px; gap: 8px; }
  /* 2026-07-25 生产级整改: 卡片紧凑化 — 原来一张卡 200px+ 高, 22 台滚 5 屏;
     压缩 padding/字号后同屏 8 张, 全场状态两屏扫完。 */
  .hv-grid {
    grid-template-columns: repeat(2, 1fr);
    /* 行高基准 84 (2026-07-25 三行重构): 头(18) + 名(20) + 元信息行(16) + padding/gap;
       2026-07-27 改 minmax(84, auto): 长分区名换行等内容超高时该行长高, 不再裁字 */
    grid-auto-rows: minmax(84px, auto);
    gap: 6px;
    overflow-y: auto;                      /* 放不下就滚这里, 而不是被裁掉 */
    -webkit-overflow-scrolling: touch;
  }
  .hz-grid,
  .hv-grid,
  .hv-sections { padding-bottom: 8px; }
  .hv-cell { padding: 8px 10px; border-radius: 11px; }
  .hv-cell.sel::before { top: 6px; bottom: 6px; }
  .hv-head { gap: 8px; }
  .hv-stats { display: none; }             /* 顶栏统计让位, 控制权优先 */
  .cell-name { margin-top: 2px; min-height: 22px; }
  .cell-name-text { font-size: 15px; }
  /* 三行重构: body/foot 手机全隐藏, 信息合并进 .cell-mline 一行 */
  .cell-body, .cell-foot { display: none; }
  .cell-mline {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--v2-text-2);
    white-space: nowrap; overflow: hidden;
    margin-top: 2px;
  }
  .cell-mline .mline-zone { color: var(--v2-text-3); overflow: hidden; text-overflow: ellipsis; }
  .cell-mline .mline-room { color: var(--v2-text-1); font-weight: 600; }
  .cell-mline .mline-off { color: var(--v2-text-3); }
  .cell-mline .m-cool { color: color-mix(in srgb, #38d6ff 62%, var(--v2-text-1)); }
  .cell-mline .m-heat { color: color-mix(in srgb, #ff8a4d 62%, var(--v2-text-1)); }
  .cell-mline .m-fan  { color: color-mix(in srgb, #4ce0be 62%, var(--v2-text-1)); }
  .cell-mline .m-auto { color: color-mix(in srgb, #7db6ff 62%, var(--v2-text-1)); }
  .cell-mline .m-dry  { color: color-mix(in srgb, #9d8bff 62%, var(--v2-text-1)); }
  .cell-dot { padding: 2px 8px; font-size: 11px; }
  .cell-tag { font-size: 12px; }
  /* 快选条: 默认折叠成一行横向滚动 (14 个分组铺 6 行占掉 1/4 屏), 点「展开」才铺开 */
  .hv-quick:not(.expanded) {
    flex-wrap: nowrap; overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .hv-quick:not(.expanded)::-webkit-scrollbar { display: none; }
  .hv-quick .hv-chip { flex: 0 0 auto; }
  .hv-chip.quick-toggle {
    display: inline-flex;
    position: sticky; right: 0;             /* 横滚时始终看得见入口 */
    background: var(--v2-surf-1, #14161A);
    color: var(--v2-primary, #4C9AFF);
  }
  .hv-chip.clear { margin-left: 0; }
  /* 操作浮层 (2026-07-25): 紧凑两行 — 行1: 已选+开关+温度; 行2: 模式+风速横滑 */
  /* 2026-07-28 业主: "最后一行卡片被切"。浮层在 390px 宽会换行长到 ~200px 高,
     远超原来页面级 128px 静态预留 → 滚到底最后一行仍被压住。改法: 预留挪进
     滚动容器内部且只在浮层出现时生效 —— 内部 padding 只延长滚动尾巴, 不挤压
     卡片行高; 浮层收起时预留归零, 不再有 128px 常驻死空间。 */
  .hv-page { padding-bottom: 12px; }
  .hv-page.bar-open .hv-grid,
  .hv-page.bar-open .hv-sections {
    padding-bottom: 248px;
    scroll-padding-bottom: 248px;
  }
  .hv-bar { left: 8px; right: 8px; gap: 8px; padding: 9px 10px; }
  .bar-names { display: none; }
  .bar-ctrl { gap: 8px; width: 100%; }
  .bar-seg {
    flex: 0 0 auto;
    overflow-x: auto; -webkit-overflow-scrolling: touch;
    scrollbar-width: none; flex-wrap: nowrap;
    max-width: 100%;
  }
  .bar-seg::-webkit-scrollbar { display: none; }
  .seg { padding: 8px 11px; font-size: 13px; flex: 0 0 auto; }
  .temp-btn { width: 38px; height: 38px; }
  .temp-val { font-size: 22px; min-width: 60px; }
  .bar-ctrl .hv-btn.primary, .bar-ctrl .hv-btn.danger { padding: 9px 18px; font-size: 15px; }
  .bar-state { display: none; }
}

/* 手机顶栏固定三段：标题、楼层、操作。按钮不再靠 flex 猜测换行，避免图标被挤出屏幕。 */
@media (max-width: 600px) {
  .hv-head {
    display: grid;
    grid-template-columns: 36px minmax(0, 1fr);
    align-items: center;
    width: 100%;
  }
  .hv-head > .v2-back-btn { grid-column: 1; }
  .hv-head > .hv-title { grid-column: 2; min-width: 0; }
  .hv-head > .v2-tabs {
    grid-column: 1 / -1;
    display: flex;
    width: 100%;
    box-sizing: border-box;
  }
  .hv-head > .v2-tabs .v2-tab { flex: 1 1 0; padding: 9px 10px; }
  .hv-head-actions {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) repeat(3, auto);
    width: 100%;
    gap: 6px;
  }
  .hv-head-actions > .v2-tabs {
    min-width: 0;
    display: flex;
  }
  .hv-head-actions > .v2-tabs .v2-tab { flex: 1 1 0; padding: 8px 10px; }
  .hv-head-actions .hv-btn { padding: 8px 10px; justify-content: center; }
}

/* ===== 编组模式: 按组分段 =====
   结构摆在眼前, 移动内机立刻看到它出现在目标组里 —— 动作和结果在同一个地方发生,
   这才是"闭环"。旧版是平铺网格 + 底部 14 个同名小按钮, 做完看不到结果。 */
.hv-sections {
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto;                 /* 组多了滚这里, 不撑破页面 */
  display: flex; flex-direction: column; gap: 10px;
  padding-right: 4px;
  box-sizing: border-box;
  scroll-padding-bottom: 16px;
}
.hv-sections.loading { opacity: .5; pointer-events: none; }
.hv-sec {
  background: color-mix(in srgb, var(--v2-surf-1) 82%, transparent);
  border: 1px solid var(--v2-border-soft, #23262C);
  border-radius: 12px;
  padding: 10px 12px;
}
.sec-head {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin-bottom: 8px;
}
.sec-name { font-size: 17px; font-weight: 700; color: var(--v2-text-1, #e8f0fb); }
.sec-name.none { color: #e0a14a; }          /* 未分组用警示色, 一眼看到还剩几台没归 */
.sec-count {
  font-size: 13px; color: var(--v2-text-3, #9BA1A9);
  background: var(--v2-surf-2); border-radius: 20px; padding: 2px 9px;
}
.sec-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; border-radius: 8px;   /* 触摸目标别再做成 14px 的小图标 */
  background: transparent; border: 1px solid var(--v2-border-soft, #23262C);
  color: var(--v2-text-3, #9BA1A9); cursor: pointer;
}
.sec-ico:hover { color: var(--v2-text-1, #e8f0fb); border-color: #46566e; }
.sec-ico.danger:hover { color: #ff6b6b; border-color: #ff6b6b66; }
.sec-ico:disabled { opacity: .35; cursor: not-allowed; }
.sec-grid {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;
  grid-auto-rows: minmax(120px, auto);
}
.sec-empty {
  padding: 14px; text-align: center; font-size: 13px;
  color: var(--v2-text-3, #9BA1A9);
  border: 1px dashed var(--v2-border-soft, #23262C); border-radius: 10px;
}
@media (max-width: 1280px) { .sec-grid { grid-template-columns: repeat(4, 1fr); } }
@media (max-width: 900px)  { .sec-grid { grid-template-columns: repeat(2, 1fr); } }

/* 卡片正文永不塌陷 —— 1920 下也一样。
   实测 768: 卡片 161×119, 但 .cell-body 只剩 13px 高, 温度/「关机」直接叠在名字上。
   min-height 给个地板, 内容再多也不会互相压。 */
.cell-body { min-height: 34px; }
/* 手机专用一行元信息 — 桌面不渲染视觉 (布局仍以 body/foot 为准) */
.cell-mline { display: none; }
</style>
