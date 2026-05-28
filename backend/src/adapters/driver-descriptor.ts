/**
 * 驱动自描述结构 — 每个真实 adapter 提供 static describe() 返回一份这个,
 * 启动时 DriverRegistryService 把所有 describe() 结果 upsert 到 driver_template 表.
 *
 * 跟 DriverTemplate entity 的字段一一对应, 只是这里允许结构化对象, 落 DB 前会 JSON.stringify.
 */
export interface DriverDescriptor {
  /** 驱动唯一标识, 同 driver_template.kind. 一旦发布不再改名 (改名会破坏外键关联). */
  kind: string;
  /** 用户看到的名字 */
  displayName: string;
  /** 厂商名 */
  vendor: string;
  /** 设备品类 (跟 hardware_unit.category 对齐) */
  category: string;
  /** 底层协议族 */
  protocol: string;
  /** 能做什么. e.g. ["turn_on","set_brightness","recall_scene"] */
  capabilities: string[];
  /** 默认 addressing 脚手架, 实例化时填进表单作初始值 */
  defaultAddressing?: Record<string, unknown>;
  /** 实例化参数 schema (JSON Schema-like 子集), 给前端动态生成表单 */
  paramSchema?: Record<string, ParamFieldSchema>;
  /** 备注 / 文档链接 */
  remark?: string;
}

export interface ParamFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'enum';
  label: string;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  /** type='enum' 时的可选值 */
  options?: Array<{ value: string; label: string }>;
}
