export const PARK_OPS_METRICS_CONFIG_KEY = 'park.ops.metrics';
export const PARK_OPS_METRICS_SCHEMA_VERSION = 1;

const MAX_BYTES = 256 * 1024;
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

export interface ParkOpsMetricsDocument {
  version: 1;
  source: string;
  updatedAt: string;
  placeholderKeys: string[];
  metrics: Record<string, number | null>;
  content: Record<string, string | string[]>;
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} 必须是对象`);
  }
  return value as Record<string, unknown>;
}

export function normalizeParkOpsMetrics(input: unknown): ParkOpsMetricsDocument {
  const raw = asRecord(input, '文档');
  if (raw.version !== 1) throw new Error('仅支持 version=1 的运营数据文档');

  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BYTES) {
    throw new Error('运营数据不能超过 256 KB');
  }
  const cloned = JSON.parse(serialized) as Record<string, unknown>;

  const source = cloned.source;
  if (typeof source !== 'string' || !source.trim() || source.length > 200) {
    throw new Error('数据来源必填且不超过 200 字');
  }
  const updatedAt = cloned.updatedAt;
  if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) {
    throw new Error('数据日期无效');
  }

  const placeholderRaw = cloned.placeholderKeys;
  if (!Array.isArray(placeholderRaw) || placeholderRaw.length > 200) {
    throw new Error('占位标记必须是不超过 200 项的列表');
  }
  const placeholderKeys = placeholderRaw.map((key) => {
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      throw new Error('占位标记含非法字段名');
    }
    return key;
  });

  const metricsRaw = asRecord(cloned.metrics, 'metrics');
  const metricKeys = Object.keys(metricsRaw);
  if (metricKeys.length > 200) throw new Error('指标数量不能超过 200');
  const metrics: Record<string, number | null> = {};
  for (const key of metricKeys) {
    if (!KEY_RE.test(key)) throw new Error(`非法指标名: ${key}`);
    const value = metricsRaw[key];
    if (value === null) {
      metrics[key] = null;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) {
      throw new Error(`指标 ${key} 必须是 0–1e9 的非负数字或留空`);
    }
    metrics[key] = value;
  }

  const contentRaw = asRecord(cloned.content, 'content');
  const contentKeys = Object.keys(contentRaw);
  if (contentKeys.length > 100) throw new Error('文案数量不能超过 100');
  const content: Record<string, string | string[]> = {};
  for (const key of contentKeys) {
    if (!KEY_RE.test(key)) throw new Error(`非法文案名: ${key}`);
    const value = contentRaw[key];
    if (typeof value === 'string') {
      if (value.length > 2000) throw new Error(`文案 ${key} 不能超过 2000 字`);
      content[key] = value;
    } else if (
      Array.isArray(value) &&
      value.length <= 100 &&
      value.every((item) => typeof item === 'string' && item.length <= 200)
    ) {
      content[key] = value as string[];
    } else {
      throw new Error(`文案 ${key} 必须是文字或文字列表`);
    }
  }

  return {
    version: 1,
    source: source.trim(),
    updatedAt,
    placeholderKeys,
    metrics,
    content,
  };
}
