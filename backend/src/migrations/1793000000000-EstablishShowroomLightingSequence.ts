import { MigrationInterface, QueryRunner } from 'typeorm';

const LIGHTING_POWER_CODES = [
  'ewelink-02b88e41', // 展厅灯带
  'ewelink-02b8942a', // 展厅筒灯射灯
  '1f-showroom', // 沙盘展位
  'ewelink-02cbf4eb', // 金特夫展厅
  'ewelink-02cbf4ef', // 无纺布展厅
  'ewelink-02cbf50b', // 西展厅
] as const;

const SCENE_TARGETS: Record<string, number> = {
  opening: 80,
  reception: 70,
  roadshow: 40,
};

/**
 * 将展厅一键场景收敛到现场真实链路：
 *   1. 六路照明电源按业务顺序逐路打开；
 *   2. 两台 DALI 网关的全部启用分组统一渐亮；
 *   3. 第一版不由场景控制空调；
 *   4. 闭馆先让 DALI 全关，再按反向顺序断照明电源。
 *
 * 电源回路用稳定 code，不写入生产自增 id；DALI 组由 lighting-broadcast
 * 在执行时读取 light_group，因此不会把网关分组和电源回路错误地绑定成一一对应。
 */
export class EstablishShowroomLightingSequence1793000000000 implements MigrationInterface {
  name = 'EstablishShowroomLightingSequence1793000000000';

  async up(q: QueryRunner): Promise<void> {
    for (const [sceneCode, brightness] of Object.entries(SCENE_TARGETS)) {
      await this.rewriteOpeningScene(q, sceneCode, brightness);
    }
    await this.rewriteClosingScene(q);
  }

  async down(): Promise<void> {
    throw new Error('SHOWROOM_LIGHTING_SEQUENCE_ROLLBACK_REQUIRES_ARCHIVE');
  }

  private async rewriteOpeningScene(q: QueryRunner, sceneCode: string, brightness: number): Promise<void> {
    const scene = await this.sceneId(q, sceneCode);
    if (!scene) return;
    const [{ count }] = (await q.query(
      `SELECT COUNT(*) AS count FROM scene_actions
       WHERE scene_id = ? AND device_type = 'power-circuit' AND command = 'turnOn'`,
      [scene.id],
    )) as Array<{ count: number }>;
    if (Number(count) > 0) return;

    await this.disableLegacyActions(q, scene.id);
    await this.shiftRemainingActions(q, scene.id);
    await this.insertPowerOnActions(q, scene.id);
    await this.insertBroadcastAction(q, scene.id, brightness, 70);
  }

  private async rewriteClosingScene(q: QueryRunner): Promise<void> {
    const scene = await this.sceneId(q, 'closing');
    if (!scene) return;
    const [{ count }] = (await q.query(
      `SELECT COUNT(*) AS count FROM scene_actions
       WHERE scene_id = ? AND device_type = 'power-circuit' AND command = 'turnOff'`,
      [scene.id],
    )) as Array<{ count: number }>;
    if (Number(count) > 0) return;

    await this.disableLegacyActions(q, scene.id);
    await this.shiftRemainingActions(q, scene.id);
    await this.insertBroadcastAction(q, scene.id, 0, 10, 3);
    for (let i = LIGHTING_POWER_CODES.length - 1; i >= 0; i -= 1) {
      await this.insertAction(q, scene.id, 'power-circuit', LIGHTING_POWER_CODES[i], 'turnOff', {}, 20 + (LIGHTING_POWER_CODES.length - 1 - i) * 10);
    }
  }

  private async sceneId(q: QueryRunner, code: string): Promise<{ id: number } | null> {
    const rows = (await q.query('SELECT id FROM scenes WHERE code = ?', [code])) as Array<{ id: number }>;
    return rows.length === 1 ? rows[0] : null;
  }

  private async disableLegacyActions(q: QueryRunner, sceneId: number): Promise<void> {
    await q.query(
      `UPDATE scene_actions SET enabled = 0, updated_at = CURRENT_TIMESTAMP
       WHERE scene_id = ? AND device_type IN ('lighting', 'hvac', 'hvac-zone')`,
      [sceneId],
    );
  }

  private async shiftRemainingActions(q: QueryRunner, sceneId: number): Promise<void> {
    await q.query(
      `UPDATE scene_actions SET sort_order = sort_order + 100, updated_at = CURRENT_TIMESTAMP
       WHERE scene_id = ? AND enabled = 1`,
      [sceneId],
    );
  }

  private async insertPowerOnActions(q: QueryRunner, sceneId: number): Promise<void> {
    for (let i = 0; i < LIGHTING_POWER_CODES.length; i += 1) {
      await this.insertAction(q, sceneId, 'power-circuit', LIGHTING_POWER_CODES[i], 'turnOn', {}, 10 + i * 10);
    }
  }

  private async insertBroadcastAction(
    q: QueryRunner,
    sceneId: number,
    brightness: number,
    sortOrder: number,
    fadeSec = 2,
  ): Promise<void> {
    await this.insertAction(
      q,
      sceneId,
      'lighting-broadcast',
      'all-dali-groups',
      'setBrightness',
      { value: brightness, fadeSec },
      sortOrder,
    );
  }

  private async insertAction(
    q: QueryRunner,
    sceneId: number,
    deviceType: string,
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
    sortOrder: number,
  ): Promise<void> {
    await q.query(
      `INSERT INTO scene_actions
       (scene_id, device_type, device_id, command, params, delay_ms, sort_order,
        enabled, config_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [sceneId, deviceType, deviceId, command, JSON.stringify(params), sortOrder],
    );
  }
}
