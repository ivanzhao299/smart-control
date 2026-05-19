/**
 * Sprint-03 spec 命名别名 — 等同 `MockDaliAdapter`
 * 现有实现以厂家 DALI 协议命名 (mock-dali.adapter.ts), 此文件提供 spec 期望的
 * `mock-lighting.adapter.ts` 路径与 `MockLightingAdapter` 类名, 行为完全一致。
 */
export {
  MockDaliAdapter as MockLightingAdapter,
  type BrightnessState as LightingState,
} from './mock-dali.adapter';
