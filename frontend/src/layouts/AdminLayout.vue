<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft, Menu, X } from 'lucide-vue-next';
import BrandLogo from '@/components/BrandLogo.vue';
import { useSystemStore } from '@/stores/system';
import { usePermissionStore } from '@/stores/permission';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { LogOut } from 'lucide-vue-next';
import { ElMessage, ElMessageBox } from 'element-plus';
import { adminNavIconFor } from '@/composables/useIcons';
import type { UserRole } from '@/types/api';

const route = useRoute();
const router = useRouter();
const sys = useSystemStore();
const perm = usePermissionStore();
const brandingStore = useSystemBrandingStore();
const branding = computed(() => brandingStore.branding);
const authStore = useAdminAuthStore();

// 2026-05-30 生产模式菜单审计: 删 4 项不日常用的, 保留 12 项. 删的菜单不删路由,
// 应急可以直接 URL 访问 (/admin/uat / /admin/drivers / /admin/brands / /admin/audit).
// 删: UAT 验收 (一次性现场交付) / 驱动模板 (开发集成用) / 硬件品牌 (低价值) / 变更历史 (取证用)
const items: Array<{ name: string; label: string }> = [
  { name: 'admin-monitor', label: '运维监控' },
  { name: 'admin-alerts', label: '报警中心' },
  { name: 'admin-devices', label: '设备管理' },
  { name: 'admin-scenes', label: '场景管理' },
  { name: 'admin-scheduler', label: '定时任务' },
  { name: 'admin-scene-executions', label: '执行记录' },
  // Sprint-09 测试中心 / Sprint-06 spec 「设备调试」(同一页面, /admin/test-center 与 /admin/debug 等价)
  // 保留: 现场维护应急时需要 (DALI 直接 poke / Ping / 端口 / rawResponse)
  { name: 'admin-test-center', label: '测试 / 调试' },
  { name: 'admin-logs', label: '日志中心' },
  { name: 'admin-hardware', label: '硬件清单' },
  { name: 'admin-light-zones', label: '灯光分区' },
  { name: 'admin-power-circuits', label: '电源回路' },
  { name: 'admin-audio-config', label: '音响配置' },
  { name: 'admin-app-release', label: 'APP 版本' },
  { name: 'admin-system-branding', label: '系统品牌' },
  { name: 'admin-users', label: '用户管理' },
  { name: 'admin-settings', label: '系统设置' },
];

const timeLabel = computed(() => {
  const d = new Date(sys.now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

const currentName = computed(() => {
  const cur = route.name?.toString() ?? '';
  if (cur.startsWith('admin-scene-actions')) return 'admin-scenes';
  // Sprint-06 spec: /admin/debug 与 /admin/test-center 同一页, 菜单都激活测试中心
  if (cur === 'admin-debug') return 'admin-test-center';
  return cur;
});

/** 手机抽屉开关状态 (≤600px 才生效) */
const sidebarOpen = ref(false);
function toggleSidebar(): void { sidebarOpen.value = !sidebarOpen.value; }
function closeSidebar(): void { sidebarOpen.value = false; }
// 切换路由后自动收起抽屉 (业主在手机上点菜单 → 跳页面 → 抽屉关掉)
watch(() => route.name, () => { sidebarOpen.value = false; });

function go(name: string): void {
  router.push({ name });
  sidebarOpen.value = false;
}

function gotoPad(): void {
  router.push({ name: 'dashboard' });
}

function onRoleChange(v: UserRole): void {
  perm.setRole(v);
}

async function logout(): Promise<void> {
  try {
    await ElMessageBox.confirm('确定退出后台?', '退出登录', {
      confirmButtonText: '退出',
      cancelButtonText: '取消',
      type: 'warning',
    });
    await authStore.logout();
    ElMessage.success('已退出');
    router.replace({ name: 'admin-login' });
  } catch {
    // 用户点了"取消"或关闭, 走 reject, 啥也不干
  }
}
</script>

<template>
  <div class="admin" :class="{ 'sidebar-open': sidebarOpen }">
    <!-- 手机抽屉遮罩 -->
    <div class="sidebar-mask" @click="closeSidebar"></div>
    <aside class="side">
      <div class="brand">
        <BrandLogo :height="40" />
        <div>
          <div class="title">{{ branding.systemName }}</div>
          <div class="sub">后台管理 · Admin</div>
        </div>
      </div>
      <nav class="menu">
        <button
          v-for="it in items"
          :key="it.name"
          type="button"
          class="menu-item"
          :class="{ 'is-active': currentName === it.name }"
          @click="go(it.name)"
        >
          <span class="ico">
            <component :is="adminNavIconFor(it.name)" :size="18" :stroke-width="1.75" />
          </span>
          <span class="lbl">{{ it.label }}</span>
        </button>
      </nav>
      <div class="footer">
        <button type="button" class="back" @click="gotoPad">
          <ChevronLeft :size="16" :stroke-width="2" /> 返回平板首页
        </button>
        <button type="button" class="back logout-btn" @click="logout">
          <LogOut :size="16" :stroke-width="2" /> 退出后台
        </button>
      </div>
    </aside>

    <div class="main">
      <header class="top">
        <button class="hamburger" @click="toggleSidebar" :aria-label="sidebarOpen ? '关闭菜单' : '打开菜单'">
          <X v-if="sidebarOpen" :size="20" :stroke-width="2" />
          <Menu v-else :size="20" :stroke-width="2" />
        </button>
        <div class="crumb">{{ items.find((i) => i.name === currentName)?.label ?? '后台管理' }}</div>
        <div class="meta">
          <span class="version">{{ sys.info?.sprint ?? '—' }} · v{{ sys.info?.version ?? '—' }}</span>
          <span class="v2-pill" :class="sys.info?.mockMode ? '' : 'idle'">
            <span class="v2-dot"></span>{{ sys.info?.mockMode ? 'MOCK 模式' : '真实模式' }}
          </span>
          <el-select :model-value="perm.role" size="small" style="width: 120px;" @update:model-value="onRoleChange">
            <el-option label="admin" value="admin" />
            <el-option label="operator" value="operator" />
            <el-option label="viewer" value="viewer" />
          </el-select>
          <span class="clock">{{ timeLabel }}</span>
        </div>
      </header>
      <main class="content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </main>
    </div>
  </div>
</template>

<style scoped>
.admin {
  display: grid;
  grid-template-columns: 220px 1fr;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  color: var(--v2-text-1);
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  box-sizing: border-box;
  position: relative;
}
/* 手机抽屉遮罩 — 默认不显示, 手机抽屉打开时盖上 */
.sidebar-mask {
  display: none;
}
/* 顶部汉堡按钮 — 桌面隐藏, 手机才显示 */
.hamburger {
  display: none;
  width: 40px;
  height: 40px;
  border: 1px solid var(--v2-border-soft);
  background: var(--v2-surf-1);
  color: var(--v2-text-1);
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: all 0.18s ease;
}
.hamburger:hover {
  background: var(--v2-surf-1-hover);
  border-color: var(--v2-primary);
}
.side {
  display: flex;
  flex-direction: column;
  background: rgba(10, 14, 26, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-right: 1px solid var(--v2-border-soft);
  min-height: 0;
}
.brand {
  display: flex; align-items: center; gap: var(--v2-sp-3);
  padding: 18px 18px;
  border-bottom: 1px solid var(--v2-border-soft);
}
.title {
  font-weight: 600; font-size: 16px;
  color: var(--v2-text-1); letter-spacing: 0.5px;
}
.sub {
  font-size: 11px; color: var(--v2-text-3);
  margin-top: 2px; letter-spacing: 1px;
}

.menu {
  flex: 1; display: flex; flex-direction: column; gap: 2px;
  padding: var(--v2-sp-3) var(--v2-sp-2); overflow-y: auto;
}
.menu-item {
  position: relative;
  display: flex; align-items: center; gap: var(--v2-sp-3);
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: var(--v2-text-2);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.3px;
  border-radius: var(--v2-r-sm);
  cursor: pointer;
  text-align: left;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  font-family: inherit;
  transition: all 0.18s ease;
}
.menu-item:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}
.menu-item:hover .ico {
  filter: drop-shadow(0 0 6px var(--v2-primary));
}
.menu-item.is-active {
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.20) 0%, rgba(0, 229, 255, 0.04) 100%);
  color: var(--v2-primary-hover);
  box-shadow: inset 0 1px 0 rgba(0, 229, 255, 0.4);
}
.menu-item.is-active .ico {
  filter: drop-shadow(0 0 10px var(--v2-primary));
}
.menu-item.is-active::before {
  content: '';
  position: absolute;
  left: -10px; top: 50%;
  transform: translateY(-50%);
  width: 4px; height: 30px;
  background: linear-gradient(180deg, transparent, var(--v2-primary) 30%, var(--v2-primary-hover) 50%, var(--v2-primary) 70%, transparent);
  border-radius: 0 4px 4px 0;
  box-shadow: 0 0 12px var(--v2-primary), 0 0 24px var(--v2-primary-soft);
}
.menu-item .ico {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  flex-shrink: 0;
}
.menu-item .lbl { flex: 1; }

.footer {
  padding: var(--v2-sp-3) var(--v2-sp-3);
  border-top: 1px solid var(--v2-border-soft);
}
.back {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--v2-surf-1);
  color: var(--v2-text-2);
  border: 1px solid var(--v2-border-soft);
  padding: 9px 12px;
  border-radius: var(--v2-r-sm);
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  transition: all 0.18s ease;
}
.back:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}

.main { display: flex; flex-direction: column; overflow: hidden; }
.top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 22px;
  background: rgba(10, 14, 26, 0.6);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--v2-border-soft);
}
.crumb {
  font-size: 16px; font-weight: 600;
  color: var(--v2-text-1); letter-spacing: 0.5px;
}
.meta { display: flex; align-items: center; gap: var(--v2-sp-3); }
.version { font-size: 12px; color: var(--v2-text-3); }
.clock {
  font-family: "Inter", system-ui;
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  color: var(--v2-text-1);
}

.content {
  flex: 1; overflow: auto;
  padding: var(--v2-sp-5);
}

.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(6px); }
.page-enter-active, .page-leave-active { transition: all 0.2s ease; }

/* ============ 平板竖屏 (≤900px): 侧栏缩窄 ============ */
@media (max-width: 900px) and (min-width: 601px) {
  .admin { grid-template-columns: 180px 1fr; }
  .menu-item { padding: 8px 10px; font-size: 13px; }
  .top { padding: 10px 16px; }
  .crumb { font-size: 14px; }
  .meta { gap: var(--v2-sp-2); }
  .version { display: none; }
}

/* ============ 手机 (≤600px): 侧栏变抽屉 ============
 * Sprint H2 2026-05-31: 业主可能用手机进后台
 * 模式: 默认隐藏 → 点汉堡按钮唤出 → 点 mask 或菜单项关闭
 */
@media (max-width: 600px) {
  .admin {
    grid-template-columns: 1fr;
  }
  .hamburger {
    display: inline-flex;
    margin-right: 12px;
  }
  /* 侧栏 → fixed 抽屉, 默认 translateX(-100%) 藏左边 */
  .side {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    max-width: 80vw;
    z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 8px 0 32px -8px rgba(0, 0, 0, 0.7);
    background: rgba(6, 8, 24, 0.92);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    padding-top: env(safe-area-inset-top);
  }
  .admin.sidebar-open .side {
    transform: translateX(0);
  }
  /* 遮罩 — 抽屉打开时盖在 main 区上, 点击关闭 */
  .sidebar-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    backdrop-filter: blur(2px);
    z-index: 99;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.22s ease;
  }
  .admin.sidebar-open .sidebar-mask {
    opacity: 1;
    pointer-events: auto;
  }

  /* 顶 header 紧凑 */
  .top {
    padding: 10px 14px;
    gap: 8px;
  }
  .crumb { font-size: 15px; }
  .meta { gap: var(--v2-sp-2); }
  .version { display: none; }
  .v2-pill { display: none; }
  /* 角色 select 收窄 */
  .meta :deep(.el-select) { width: 84px !important; }
  .clock { font-size: 13px; }

  /* 内容 padding 减小 */
  .content {
    padding: var(--v2-sp-3);
  }
}
</style>
