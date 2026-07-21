import { SetMetadata } from '@nestjs/common';

/**
 * @Public() —— 标记某个路由 (或整个 controller) 免全局鉴权。
 *
 * 全局 GlobalAuthGuard 会先读这个元数据, 命中就直接放行。
 * 用来放行: 登录入口 / 健康检查 / 品牌与 manifest / kiosk 大屏拉流 /
 *          无人值守机器回调 (bgm-player advance、site-heartbeat、loopback 重启)。
 *
 * 模式对齐 common/guards/rate-limit.guard.ts 的 SetMetadata + Reflector 用法。
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
