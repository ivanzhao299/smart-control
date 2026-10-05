import { ElMessage } from 'element-plus';
import { useAdminAuthStore } from '@/stores/admin-auth';
import { usePermissionStore } from '@/stores/permission';
import { useRouter } from 'vue-router';
import { getAdminToken, getClientToken } from '@/services/http';

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

  /**
   * 内容编辑解锁 (欢迎页编辑/投放): 管理员与操作员均可, 只读账户不可。
   * role 以服务端 /client-auth/me 校验为准；未登录引导到前台账号登录页。
   */
  async function ensureContentEditor(what = '此操作'): Promise<boolean> {
    const perm = usePermissionStore();
    await perm.refresh();
    if (perm.canExecute) return true;
    if (getClientToken() || getAdminToken()) {
      ElMessage.warning(`${what}需要操作员或管理员权限`);
      return false;
    }
    ElMessage.info(`${what}需要操作员或管理员账号，请先登录`);
    await router.push({
      name: 'client-login',
      query: { redirect: router.currentRoute.value.fullPath },
    });
    return false;
  }

  return { ensureAdmin, ensureContentEditor };
}
