<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { Globe, Wifi, CheckCircle2, XCircle, X, Trash2, History } from 'lucide-vue-next';
import { useClientAuthStore } from '@/stores/client-auth';
import { getServerHistory, addServerHistory, removeServerHistory } from '@/services/server-history';

/**
 * 服务器地址设置弹窗 — PWA 断网自救入口.
 *
 * 两个打开途径:
 *   1. MainLayout 检测到 API 连续失败 → 自动弹出
 *   2. 侧导航底部 "网络" 按钮 → 手动打开
 *
 * 功能: 输入/测试新地址; 历史列表 (连过的都记着) 点击即测, 可删除;
 * 测试通过 → 保存并整页刷新 (WS/轮询全部按新地址重建).
 * 测试失败也允许 "仍然保存" (服务器暂时没开机但地址确定没错的场景).
 */

const props = defineProps<{ modelValue: boolean; reason?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>();

const auth = useClientAuthStore();
const serverInput = ref('');
const history = ref<string[]>([]);

interface TestResult { state: 'idle' | 'testing' | 'ok' | 'fail'; message?: string }
const test = ref<TestResult>({ state: 'idle' });
const saving = ref(false);

watch(() => props.modelValue, (open) => {
  if (open) {
    serverInput.value = originFromBaseURL(auth.baseURL);
    history.value = getServerHistory();
    test.value = { state: 'idle' };
  }
});

/** baseURL 形如 "http://x.x.x.x:3200/api" → 显示给业主的裸 origin */
function originFromBaseURL(base: string): string {
  return base.replace(/\/api(\/.*)?$/, '');
}

const currentOrigin = computed(() => originFromBaseURL(auth.baseURL));

function close(): void {
  emit('update:modelValue', false);
}

async function doTest(target?: string): Promise<boolean> {
  const input = (target ?? serverInput.value).trim();
  if (!input) {
    test.value = { state: 'fail', message: '请输入服务器地址' };
    return false;
  }
  if (target) serverInput.value = target;
  test.value = { state: 'testing' };
  auth.setBaseURL(input);
  const result = await auth.testConnection();
  if (result.ok) {
    test.value = { state: 'ok', message: `连接成功 · ${result.serverTime?.slice(11, 19) ?? ''}` };
    return true;
  }
  test.value = { state: 'fail', message: result.error ?? '无法连接' };
  return false;
}

/** 主按钮: 测试通过 → 存历史 + 刷新页面 (所有连接按新地址重建) */
async function saveAndReload(): Promise<void> {
  saving.value = true;
  try {
    const ok = await doTest();
    if (!ok) return; // 失败时露出 "仍然保存" 次级入口
    addServerHistory(originFromBaseURL(auth.baseURL));
    window.location.reload();
  } finally {
    saving.value = false;
  }
}

/** 测试失败但业主确定地址没错 (服务器还没开机等) — 保存不刷新历史, 直接重载 */
function forceSave(): void {
  auth.setBaseURL(serverInput.value.trim());
  window.location.reload();
}

function useHistory(url: string): void {
  void doTest(url);
}

function deleteHistory(url: string): void {
  removeServerHistory(url);
  history.value = getServerHistory();
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ssd-fade">
      <div v-if="modelValue" class="ssd-overlay" @click.self="close">
        <div class="ssd-card" role="dialog" aria-label="服务器设置">
          <div class="ssd-head">
            <div class="ssd-title">
              <Globe :size="18" :stroke-width="2" />
              服务器设置
            </div>
            <button class="ssd-close" title="关闭" @click="close">
              <X :size="18" :stroke-width="2" />
            </button>
          </div>

          <div v-if="reason" class="ssd-reason">{{ reason }}</div>

          <!-- 地址输入 + 测试 -->
          <div class="ssd-row">
            <input
              v-model="serverInput"
              type="text"
              class="ssd-input"
              placeholder="http://192.168.77.54:3200"
              inputmode="url"
              spellcheck="false"
              autocapitalize="off"
              @keyup.enter="saveAndReload"
            />
            <button
              class="ssd-test-btn"
              :class="`state-${test.state}`"
              :disabled="test.state === 'testing'"
              @click="doTest()"
            >
              <Wifi v-if="test.state === 'idle' || test.state === 'testing'" :size="15" :stroke-width="2" />
              <CheckCircle2 v-else-if="test.state === 'ok'" :size="15" :stroke-width="2" />
              <XCircle v-else :size="15" :stroke-width="2" />
              {{ test.state === 'testing' ? '测试中' : '测试' }}
            </button>
          </div>
          <div v-if="test.message" class="ssd-test-msg" :class="`is-${test.state}`">{{ test.message }}</div>

          <!-- 历史列表 -->
          <div v-if="history.length" class="ssd-history">
            <div class="ssd-history-title">
              <History :size="13" :stroke-width="2" />
              连接过的服务器
            </div>
            <div
              v-for="h in history"
              :key="h"
              class="ssd-history-row"
              :class="{ 'is-current': h === currentOrigin }"
            >
              <button class="ssd-history-url" @click="useHistory(h)">{{ h }}</button>
              <span v-if="h === currentOrigin" class="ssd-current-tag">当前</span>
              <button class="ssd-history-del" title="删除" @click="deleteHistory(h)">
                <Trash2 :size="14" :stroke-width="2" />
              </button>
            </div>
          </div>

          <!-- 操作区 -->
          <button class="ssd-save-btn" :disabled="saving || test.state === 'testing'" @click="saveAndReload">
            {{ saving ? '连接中...' : '连接并保存' }}
          </button>
          <button v-if="test.state === 'fail'" class="ssd-force-btn" @click="forceSave">
            测试失败, 仍然保存此地址
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ssd-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(3px);
}
.ssd-card {
  width: 100%;
  max-width: 440px;
  padding: 20px;
  background: var(--v2-surf-1, #14181f);
  border: 1px solid var(--v2-border-soft, rgba(255, 255, 255, 0.1));
  border-radius: 14px;
  box-shadow: 0 24px 60px -12px rgba(0, 0, 0, 0.6);
}
.ssd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.ssd-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--v2-text-1, #e8ecf3);
}
.ssd-close {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--v2-text-3, #7a8699);
  cursor: pointer;
}
.ssd-close:hover { background: var(--v2-ov-2); color: var(--v2-text-1, #e8ecf3); }

.ssd-reason {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(229, 100, 93, 0.12);
  border: 1px solid rgba(229, 100, 93, 0.3);
  color: #EC8880;
  font-size: 12px;
  line-height: 1.5;
}

.ssd-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}
.ssd-input {
  padding: 11px 12px;
  background: var(--v2-inset-bg);
  border: 1px solid var(--v2-border-soft, rgba(255, 255, 255, 0.1));
  border-radius: 9px;
  color: var(--v2-text-1, #e8ecf3);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  outline: none;
  min-width: 0;
}
.ssd-input:focus {
  border-color: var(--v2-primary, #4C9AFF);
  box-shadow: 0 0 0 3px rgba(76, 154, 255, 0.15);
}
.ssd-test-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 13px;
  border-radius: 9px;
  background: var(--v2-inset-bg);
  border: 1px solid var(--v2-border-soft, rgba(255, 255, 255, 0.1));
  color: var(--v2-text-2, #aab4c3);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.ssd-test-btn:hover:not(:disabled) { border-color: var(--v2-primary, #4C9AFF); color: var(--v2-text-1, #e8ecf3); }
.ssd-test-btn.state-ok { color: #5FCB9B; border-color: rgba(63, 191, 135, 0.4); background: rgba(63, 191, 135, 0.1); }
.ssd-test-btn.state-fail { color: #EC8880; border-color: rgba(229, 100, 93, 0.4); background: rgba(229, 100, 93, 0.1); }
.ssd-test-btn.state-testing { opacity: 0.6; }

.ssd-test-msg { margin-top: 6px; font-size: 11px; padding: 0 2px; }
.ssd-test-msg.is-ok { color: #5FCB9B; }
.ssd-test-msg.is-fail { color: #EC8880; }
.ssd-test-msg.is-testing { color: var(--v2-text-3, #7a8699); }

.ssd-history { margin-top: 14px; }
.ssd-history-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--v2-text-3, #7a8699);
  margin-bottom: 6px;
}
.ssd-history-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
}
.ssd-history-row.is-current .ssd-history-url { color: var(--v2-primary, #4C9AFF); }
.ssd-history-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  padding: 7px 10px;
  border: none;
  border-radius: 7px;
  background: var(--v2-ov-1);
  color: var(--v2-text-2, #aab4c3);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  cursor: pointer;
}
.ssd-history-url:hover { background: rgba(76, 154, 255, 0.1); color: var(--v2-text-1, #e8ecf3); }
.ssd-current-tag {
  flex-shrink: 0;
  font-size: 10px;
  padding: 2px 7px;
  border-radius: 99px;
  background: rgba(76, 154, 255, 0.14);
  color: var(--v2-primary, #4C9AFF);
}
.ssd-history-del {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--v2-text-3, #7a8699);
  cursor: pointer;
}
.ssd-history-del:hover { background: rgba(229, 100, 93, 0.14); color: #EC8880; }

.ssd-save-btn {
  width: 100%;
  margin-top: 16px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: linear-gradient(135deg, var(--v2-primary, #4C9AFF) 0%, var(--v2-primary-dark, #0097b2) 100%);
  color: white;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.15em;
  cursor: pointer;
}
.ssd-save-btn:hover:not(:disabled) { filter: brightness(1.1); }
.ssd-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ssd-force-btn {
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  border-radius: 9px;
  border: 1px dashed rgba(229, 100, 93, 0.4);
  background: transparent;
  color: #EC8880;
  font-size: 12px;
  cursor: pointer;
}
.ssd-force-btn:hover { background: rgba(229, 100, 93, 0.08); }

.ssd-fade-enter-active, .ssd-fade-leave-active { transition: opacity 0.18s ease; }
.ssd-fade-enter-from, .ssd-fade-leave-to { opacity: 0; }
</style>
