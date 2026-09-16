import { ElMessage } from 'element-plus';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { useRouter } from 'vue-router';

/**
 * 前台改文字统一管控 (2026-07-30 业主: "除管理员以外不能改")。
 *
 * 前台保留编辑入口 (业主习惯就地改), 但点开时要求管理员身份:
 * 已登录后台 (8h 签名令牌) 直接放行；否则转到统一的个人管理员登录页。
 * 后端相应写接口都挂了 AdminGuard, 这里只是把 401 前置成友好流程。
 */
export function useAdminUnlock() {
  const store = useAdminAuthStore();
  const router = useRouter();

  async function ensureAdmin(what = '此操作'): Promise<boolean> {
    if (await store.ensureChecked(true)) return true;
    ElMessage.info(`${what}仅管理员可用，请使用个人管理员账号登录`);
    await router.push({ name: 'admin-login', query: { redirect: router.currentRoute.value.fullPath } });
    return false;
  }

  return { ensureAdmin };
}
