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
          <span class="sc-pill" :class="sys.info?.mockMode ? 'is-info' : 'is-success'">
            {{ sys.info?.mockMode ? 'MOCK 模式' : '真实模式' }}
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
  /* iPad Safari fix: 用 dvh 兼容动态 viewport, 避免 100vh 被底部 tab bar 截掉 */
  height: 100vh;
  height: 100dvh;
  background: var(--bg-base);
  color: var(--text-primary);
  overflow: hidden;
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
  padding-right: env(safe-area-inset-right);
  box-sizing: border-box;
}
.side {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-soft);
  min-height: 0;
}
.brand {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 18px;
  border-bottom: 1px solid var(--border-soft);
}
.title { font-weight: 600; font-size: 16px; }
.sub { font-size: 11px; color: var(--text-secondary); margin-top: 2px; letter-spacing: 1px; }

.menu { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 12px 10px; overflow-y: auto; }
.menu-item {
  position: relative;
  display: flex; align-items: center; gap: 12px;
  padding: 11px 14px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.5px;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  /* iOS / 触屏点击保险: 关 300ms 延迟 + 关浏览器默认按钮样式 */
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  font-family: inherit;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.menu-item::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 22%;
  bottom: 22%;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: linear-gradient(180deg, #3b82f6, #7c3aed);
  opacity: 0;
  transition: opacity 0.15s ease;
}
.menu-item:hover { background: var(--bg-elevated); color: var(--text-primary); }
.menu-item:active { transform: scale(0.98); }
.menu-item.is-active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.18) 0%, rgba(124, 58, 237, 0.18) 100%);
  border-color: rgba(99, 102, 241, 0.35);
  color: #c7d2fe;
  box-shadow: 0 6px 14px -6px rgba(99, 102, 241, 0.45);
}
.menu-item.is-active::before { opacity: 1; }
.menu-item .ico {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  border-radius: 8px;
  flex-shrink: 0;
  color: currentColor;
}
.menu-item.is-active .ico {
  background: rgba(255, 255, 255, 0.08);
}
.menu-item .lbl { flex: 1; }

.footer { padding: 12px 14px; border-top: 1px solid var(--border-soft); }
.back {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-soft);
  padding: 9px 12px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  font-family: inherit;
  font-weight: 500;
  touch-action: manipulation;
  -webkit-appearance: none;
  appearance: none;
  -webkit-tap-highlight-color: transparent;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.1s ease;
}
.back:hover { border-color: rgba(99, 102, 241, 0.55); color: #c7d2fe; }
.back:active { transform: scale(0.97); }

.main { display: flex; flex-direction: column; overflow: hidden; }
.top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 22px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border-soft);
}
.crumb { font-size: 18px; font-weight: 600; }
.meta { display: flex; align-items: center; gap: 12px; }
.version { font-size: 13px; color: var(--text-secondary); }
.clock { font-size: 14px; color: var(--text-primary); font-variant-numeric: tabular-nums; }

.content { flex: 1; overflow: auto; padding: 20px 22px; }

.page-enter-from, .page-leave-to { opacity: 0; transform: translateY(6px); }
.page-enter-active, .page-leave-active { transition: all 0.2s ease; }
</style>
