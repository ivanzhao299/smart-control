import { ElMessage, ElMessageBox } from 'element-plus';
import { useAdminAuthStore } from '@/stores/admin-auth';

/**
 * 前台改文字统一管控 (2026-07-30 业主: "除管理员以外不能改")。
 *
 * 前台保留编辑入口 (业主习惯就地改), 但点开时要求管理员身份:
 * 已登录后台 (8h 签名令牌) 直接放行; 否则弹密码框就地验证。
 * 后端相应写接口都挂了 AdminGuard, 这里只是把 401 前置成友好流程。
 */
export function useAdminUnlock() {
  const store = useAdminAuthStore();

  async function ensureAdmin(what = '此操作'): Promise<boolean> {
    if (await store.ensureChecked(true)) return true;
    try {
      const { value } = await ElMessageBox.prompt(
        `${what}仅管理员可用, 请输入后台管理密码验证身份 (本次登录 8 小时内免重复输入)。`,
        '管理员验证',
        {
          inputType: 'password',
          inputPlaceholder: '后台管理密码',
          confirmButtonText: '验证',
          cancelButtonText: '取消',
        },
      );
      if (!value) return false;
      await store.login(value);
      return true;
    } catch (e) {
      if (e !== 'cancel' && e !== 'close') {
        ElMessage.error(`验证失败: ${(e as Error).message ?? e}`);
      }
      return false;
    }
  }

  return { ensureAdmin };
}
