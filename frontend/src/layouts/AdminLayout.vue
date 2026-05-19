<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSystemStore } from '@/stores/system';
import { usePermissionStore } from '@/stores/permission';
import type { UserRole } from '@/types/api';

const route = useRoute();
const router = useRouter();
const sys = useSystemStore();
const perm = usePermissionStore();

const items: Array<{ name: string; label: string; icon: string }> = [
  { name: 'admin-devices', label: '设备管理', icon: '🛠' },
  { name: 'admin-scenes', label: '场景管理', icon: '🎬' },
  { name: 'admin-scheduler', label: '定时任务', icon: '⏰' },
  { name: 'admin-scene-executions', label: '执行记录', icon: '📊' },
  { name: 'admin-logs', label: '日志中心', icon: '📑' },
  { name: 'admin-users', label: '用户管理', icon: '👥' },
  { name: 'admin-settings', label: '系统设置', icon: '⚙️' },
];

const timeLabel = computed(() => {
  const d = new Date(sys.now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

const currentName = computed(() => {
  const cur = route.name?.toString() ?? '';
  if (cur.startsWith('admin-scene-actions')) return 'admin-scenes';
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
        <div class="logo">⚙</div>
        <div>
          <div class="title">中控后台</div>
          <div class="sub">Smart Control Admin</div>
        </div>
      </div>
      <nav class="menu">
        <button
          v-for="it in items"
          :key="it.name"
          class="menu-item"
          :class="{ 'is-active': currentName === it.name }"
          @click="go(it.name)"
        >
          <span class="ico">{{ it.icon }}</span>
          <span class="lbl">{{ it.label }}</span>
        </button>
      </nav>
      <div class="footer">
        <button class="back" @click="gotoPad">← 返回平板首页</button>
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
  height: 100vh;
  background: var(--bg-base);
  color: var(--text-primary);
  overflow: hidden;
}
.side {
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border-soft);
}
.brand {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 18px;
  border-bottom: 1px solid var(--border-soft);
}
.logo {
  width: 38px; height: 38px;
  display: flex; align-items: center; justify-content: center;
  background: var(--color-primary); color: #fff; border-radius: 10px;
  font-size: 20px;
}
.title { font-weight: 600; font-size: 16px; }
.sub { font-size: 11px; color: var(--text-secondary); margin-top: 2px; letter-spacing: 1px; }

.menu { flex: 1; display: flex; flex-direction: column; gap: 4px; padding: 10px 8px; }
.menu-item {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 14px;
  border-radius: 8px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}
.menu-item:hover { background: var(--bg-elevated); color: var(--text-primary); }
.menu-item.is-active {
  background: var(--color-primary);
  color: #fff;
  box-shadow: var(--shadow-button);
}
.menu-item .ico { font-size: 18px; }

.footer { padding: 12px 14px; border-top: 1px solid var(--border-soft); }
.back {
  width: 100%; background: var(--bg-elevated); color: var(--text-primary);
  border: 1px solid var(--border-soft); padding: 8px 12px; border-radius: 8px;
  cursor: pointer; font-size: 13px;
}
.back:hover { border-color: var(--color-primary); }

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
