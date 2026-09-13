export type ParkOpsConfigDocument = Record<string, unknown>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FIT_MODES = new Set(['stretch', 'cover', 'contain']);

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${name} 必须是文字`);
  if (value.length > max) throw new Error(`${name} 不能超过 ${max} 个字符`);
  return value;
}

function numberIn(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} 必须在 ${min}–${max} 之间`);
  }
  return value;
}

function color(value: unknown, name: string): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new Error(`${name} 必须是 #RRGGBB 色值`);
  return value;
}

/** Validate, clone and strip prototypes before a shared dashboard config is persisted. */
export function normalizeParkOpsConfig(input: unknown): ParkOpsConfigDocument {
  let cloned: unknown;
  try {
    const serialized = JSON.stringify(input);
    if (!serialized) throw new Error('配置不能为空');
    if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) throw new Error('配置不能超过 256 KB');
    cloned = JSON.parse(serialized);
  } catch (error) {
    throw new Error((error as Error).message || '配置不是有效 JSON');
  }

  const root = record(cloned, '配置');
  if (root.version !== 1) throw new Error('仅支持 version=1 的园区大屏配置');
  if (!FIT_MODES.has(String(root.fitMode))) throw new Error('fitMode 必须是 stretch、cover 或 contain');

  if (!Array.isArray(root.phases) || root.phases.length < 1 || root.phases.length > 8) {
    throw new Error('分区数量必须在 1–8 之间');
  }
  const phaseIds = new Set<string>();
  root.phases.forEach((item, phaseIndex) => {
    const phase = record(item, `phases[${phaseIndex}]`);
    const id = text(phase.id, `phases[${phaseIndex}].id`, 24);
    if (!id || phaseIds.has(id)) throw new Error('分区 id 不能为空且不能重复');
    phaseIds.add(id);
    text(phase.name, `phases[${phaseIndex}].name`, 32);
    text(phase.zoneName, `phases[${phaseIndex}].zoneName`, 48);
    color(phase.color, `phases[${phaseIndex}].color`);
    numberIn(phase.fontSize, `phases[${phaseIndex}].fontSize`, 8, 48);
    if (phase.labelX !== undefined) numberIn(phase.labelX, `phases[${phaseIndex}].labelX`, 0, 100);
    if (phase.labelY !== undefined) numberIn(phase.labelY, `phases[${phaseIndex}].labelY`, 0, 100);
    if (!Array.isArray(phase.points) || phase.points.length < 3 || phase.points.length > 32) {
      throw new Error(`phases[${phaseIndex}].points 必须有 3–32 个端点`);
    }
    phase.points.forEach((itemPoint, pointIndex) => {
      const point = record(itemPoint, `phases[${phaseIndex}].points[${pointIndex}]`);
      numberIn(point.x, `端点 ${pointIndex + 1} X`, 0, 1000);
      numberIn(point.y, `端点 ${pointIndex + 1} Y`, 0, 690);
    });
  });

  if (!Array.isArray(root.buildings) || root.buildings.length > 200) throw new Error('楼栋数量不能超过 200');
  const buildingIds = new Set<string>();
  root.buildings.forEach((item, buildingIndex) => {
    const building = record(item, `buildings[${buildingIndex}]`);
    const id = text(building.id, `buildings[${buildingIndex}].id`, 36);
    if (!id || buildingIds.has(id)) throw new Error('楼栋 id 不能为空且不能重复');
    buildingIds.add(id);
    if (!phaseIds.has(String(building.phase))) throw new Error(`楼栋 ${id} 引用了不存在的分区`);
    text(building.number, `楼栋 ${id} 编号`, 24);
    text(building.company, `楼栋 ${id} 企业名称`, 80);
    numberIn(building.x, `楼栋 ${id} X`, 0, 100);
    numberIn(building.y, `楼栋 ${id} Y`, 0, 100);
    numberIn(building.fontSize, `楼栋 ${id} 字号`, 8, 48);
    color(building.color, `楼栋 ${id} 颜色`);
  });

  const overrides = record(root.textOverrides ?? {}, 'textOverrides');
  if (Object.keys(overrides).length > 500) throw new Error('自定义文字不能超过 500 项');
  for (const [key, item] of Object.entries(overrides)) {
    if (key.length > 160) throw new Error('文字定位键过长');
    const override = record(item, `textOverrides.${key}`);
    text(override.text, `textOverrides.${key}.text`, 200);
    numberIn(override.fontSize, `textOverrides.${key}.fontSize`, 8, 96);
    color(override.color, `textOverrides.${key}.color`);
  }

  const customTexts = root.customTexts ?? [];
  if (!Array.isArray(customTexts) || customTexts.length > 200) throw new Error('地图自由文字不能超过 200 项');
  const customTextIds = new Set<string>();
  customTexts.forEach((item, textIndex) => {
    const label = record(item, `customTexts[${textIndex}]`);
    const id = text(label.id, `customTexts[${textIndex}].id`, 36);
    if (!id || customTextIds.has(id)) throw new Error('地图自由文字 id 不能为空且不能重复');
    customTextIds.add(id);
    text(label.text, `地图自由文字 ${id}`, 200);
    numberIn(label.x, `地图自由文字 ${id} X`, 0, 100);
    numberIn(label.y, `地图自由文字 ${id} Y`, 0, 100);
    numberIn(label.fontSize, `地图自由文字 ${id} 字号`, 8, 96);
    color(label.color, `地图自由文字 ${id} 颜色`);
  });

  return root;
}
