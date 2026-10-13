import { RequestMethod } from '@nestjs/common';
import {
  INTERCEPTORS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { LprWebhookController } from './lpr-webhook.controller';

/**
 * 臻识相机 comet 轮询/注册通道的路由注册回归测试。
 * 背景：曾在同一方法上叠加 @Get + @Post，Nest 方法元数据为单值会被后执行的
 * 装饰器覆盖，导致只注册了 GET、POST /comet 一律 404（相机 multipart 注册进不来）。
 * 这里直接反射控制器元数据，固化"必须用 @All 且挂 FileInterceptor"，无需起 HTTP/DB。
 */
describe('LprWebhookController 路由注册', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = LprWebhookController.prototype as any;

  it('comet 以 ALL 注册（POST multipart 注册与 GET/query 都命中），不是 Get/Post 叠加', () => {
    const method = Reflect.getMetadata(METHOD_METADATA, proto.comet);
    const path = Reflect.getMetadata(PATH_METADATA, proto.comet);
    expect(path).toBe('comet');
    expect(method).toBe(RequestMethod.ALL);
  });

  it('comet 挂了与 heartbeat 相同的 multipart 拦截器（FileInterceptor 为随机名 mixin，按数量/类型对齐）', () => {
    const read = (key: string): unknown[] =>
      (Reflect.getMetadata(INTERCEPTORS_METADATA, proto[key]) as unknown[]) ?? [];
    const cometInt = read('comet');
    const hbInt = read('heartbeat');
    expect(cometInt.length).toBeGreaterThanOrEqual(1);
    expect(cometInt.length).toBe(hbInt.length);
    expect(cometInt.every((i) => typeof i === 'function')).toBe(true);
  });

  it('plate 仍为 POST（识别结果 JSON 推送）', () => {
    expect(Reflect.getMetadata(PATH_METADATA, proto.plate)).toBe('plate');
    expect(Reflect.getMetadata(METHOD_METADATA, proto.plate)).toBe(RequestMethod.POST);
  });
});
