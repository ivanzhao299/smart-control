<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ChevronLeft } from 'lucide-vue-next';
import BrandLogo from '@/components/BrandLogo.vue';
import { useSystemStore } from '@/stores/system';
import { usePermissionStore } from '@/stores/permission';
import { adminNavIconFor } from '@/composables/useIcons';
import type { UserRole } from '@/types/api';

const route = useRoute();
const router = useRouter();
const sys = useSystemStore();
const perm = usePermissionStore();

const items: Array<{ name: string; label: string }> = [
  { name: 'admin-monitor', label: '运维监控' },
  { name: 'admin-alerts', label: '报警中心' },
  { name: 'admin-devices', label: '设备管理' },
  { name: 'admin-scenes', label: '场景管理' },
  { name: 'admin-scheduler', label: '定时任务' },
  { name: 'admin-scene-executions', label: '执行记录' },
  // Sprint-09 测试中心 / Sprint-06 spec 「设备调试」(同一页面, /admin/test-center 与 /admin/debug 等价)
  { name: 'admin-test-center', label: '测试 / 调试' },
  { name: 'admin-uat', label: 'UAT 验收' },
  { name: 'admin-logs', label: '日志中心' },
  { name: 'admin-hardware', label: '硬件清单' },
  { name: 'admin-drivers', label: '驱动模板' },
  { name: 'admin-audit', label: '变更历史' },
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

function go(name: string): void {
  router.push({ name });
}

function gotoPad(): void {
  router.push({ name: 'dashboard' });
}

function onRoleChange(v: UserRole): void {
  perm.setRole(v);
}
</script>

<template>
  <div class="admin">
    <aside class="side">
      <div class="brand">
        <BrandLogo :height="40" />
        <div>
          <div class="title">金湖展贸中心</div>
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
      </div>
    </aside>

    <div class="main">
      <header class="top">
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
.menu-item.is-active {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
}
.menu-item.is-active::before {
  content: '';
  position: absolute;
  left: -2px; top: 50%;
  transform: translateY(-50%);
  width: 3px; height: 22px;
  background: var(--v2-primary);
  border-radius: 0 3px 3px 0;
  box-shadow: 0 0 8px var(--v2-primary);
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
</style>
