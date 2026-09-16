<script setup lang="ts">
import { watch, ref } from 'vue';
import { useCurrentActor } from '@/services/current-actor';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '@/services/http';
import type { MediaItem } from '@/services/media.service';

defineProps<{ items: MediaItem[] }>();
const emit = defineEmits<{ refresh: []; owner: [id: number | undefined] }>();
const { isAdmin } = useCurrentActor();
const users = ref<Array<{ id: number; username: string; enabled: boolean }>>([]);
const keyword = ref('');
const selectedOwner = ref('');
const editing = ref<MediaItem | null>(null);
const name = ref('');
const visibility = ref<'private' | 'shared'>('private');
const owner = ref<number | undefined>();
const saving = ref(false);
const quotaGiB = ref(10);
async function setQuota() {
  if (!selectedOwner.value) return;
  const bytes = Math.round(Number(quotaGiB.value) * 1024 ** 3);
  try {
    await ElMessageBox.confirm(`将所选用户的存储配额设置为 ${quotaGiB.value} GiB？`, '修改配额');
  } catch { return; }
  if (!isAdmin.value) return;
  try { await api.put(`/media/storage/users/${selectedOwner.value}`, { quotaBytes: bytes }); ElMessage.success('配额已更新'); }
  catch { ElMessage.error('配额修改失败：请检查权限、数值及用户已用容量'); }
}
async function searchUsers() {
  try {
    const result = await api.get<{ list: typeof users.value }>(`/users?pageSize=500&keyword=${encodeURIComponent(keyword.value)}`);
    users.value = result.list;
  } catch { ElMessage.error('无法读取用户列表'); }
}
function edit(item: MediaItem) {
  if (item.source === 'system') return;
  editing.value = item; name.value = item.originalName; visibility.value = item.visibility; owner.value = item.ownerUserId ?? undefined;
}
async function save() {
  const item = editing.value;
  if (!item || saving.value) return;
  if (visibility.value === 'shared' && item.visibility !== 'shared') {
    try { await ElMessageBox.confirm('设为公共后，所有已登录用户都可查看及使用此资料。是否继续？', '确认共享', { type: 'warning' }); }
    catch { return; }
  }
  if (owner.value !== undefined && owner.value !== item.ownerUserId) {
    try { await ElMessageBox.confirm('变更归属后，原用户可能无法再查看或播放此资料。是否继续？', '确认转移归属', { type: 'warning' }); }
    catch { return; }
  }
  if (!isAdmin.value) return;
  saving.value = true;
  try {
    await api.put(`/media/${item.id}`, { originalName: name.value.trim(), visibility: visibility.value, ...(owner.value !== undefined && owner.value !== item.ownerUserId ? { ownerUserId: owner.value } : {}) });
    editing.value = null; emit('refresh'); ElMessage.success('资料管理信息已保存');
  } catch { ElMessage.error('保存失败，请检查管理员权限及目标用户状态'); }
  finally { saving.value = false; }
}
watch(isAdmin, async allowed => {
  if (allowed) await searchUsers();
  else { users.value = []; editing.value = null; selectedOwner.value = ''; emit('owner', undefined); }
});
</script>

<template>
  <details v-if="isAdmin" class="media-admin">
    <summary>管理员内容管理</summary>
    <div class="admin-controls">
      <input v-model="keyword" aria-label="搜索用户" placeholder="按用户名搜索" @keyup.enter="searchUsers" />
      <button @click="searchUsers">搜索用户</button>
      <select v-model="selectedOwner" aria-label="筛选资料归属" @change="emit('owner', selectedOwner ? Number(selectedOwner) : undefined)">
        <option value="">全部用户</option>
        <option v-for="user in users" :key="user.id" :value="String(user.id)">{{ user.username }}{{ user.enabled ? '' : '（已停用）' }}</option>
      </select>
    </div>
    <div v-if="selectedOwner" class="admin-controls">
      <label>新配额（GiB）<input v-model.number="quotaGiB" type="number" min="0" step="0.1" /></label>
      <button @click="setQuota">设置所选用户配额</button>
    </div>
    <p>下表管理当前筛选范围内已加载的资料。用户搜索每次最多显示 500 个结果。</p>
    <div class="admin-table">
      <table>
        <thead><tr><th>资料</th><th>归属</th><th>范围</th><th>操作</th></tr></thead>
        <tbody><tr v-for="item in items" :key="item.id">
          <td>{{ item.originalName }}{{ item.source === 'system' ? '（内置）' : '' }}</td><td>{{ users.find(u => u.id === item.ownerUserId)?.username || (item.ownerUserId ? `用户 #${item.ownerUserId}` : '系统／历史资料') }}</td>
          <td>{{ item.visibility === 'shared' ? '公共' : '私人' }}</td><td><button :disabled="item.source === 'system'" :title="item.source === 'system' ? '内置资料由版本发布统一管理' : '编辑资料'" @click="edit(item)">{{ item.source === 'system' ? '受保护' : '编辑' }}</button></td>
        </tr></tbody>
      </table>
    </div>
    <el-dialog :model-value="!!editing" title="管理资料" width="min(92vw, 480px)" @close="editing = null">
      <form class="admin-form" @submit.prevent="save">
        <label>名称<input v-model="name" required maxlength="200" /></label>
        <label>访问范围<select v-model="visibility"><option value="private">私人</option><option value="shared">公共</option></select></label>
        <label>归属用户<select v-model="owner"><option :value="undefined">保留当前归属</option><option v-for="user in users" :key="user.id" :value="user.id" :disabled="!user.enabled">{{ user.username }}</option></select></label>
        <p>变更归属可能使原用户失去访问权限；不会移动或删除文件。</p>
        <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button>
      </form>
    </el-dialog>
  </details>
</template>

<style scoped>
.media-admin { margin: 12px 0; padding: 12px; border: 1px solid var(--v2-border, #777); border-radius: 8px; }
.admin-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.admin-table { overflow-x: auto; } table { width: 100%; border-collapse: collapse; } td, th { padding: 8px; text-align: left; border-bottom: 1px solid #7775; }
.admin-form, .admin-form label { display: grid; gap: 10px; } input, select { max-width: 100%; padding: 6px; }
</style>
