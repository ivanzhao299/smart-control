import { MigrationInterface, QueryRunner } from 'typeorm';
import type { DriverDescriptor } from '../adapters/driver-descriptor';

/**
 * Immutable snapshot of the built-in driver catalog at this migration boundary.
 * Future descriptor changes require a new migration; do not edit these rows in place.
 */
const BUILTIN_DRIVER_TEMPLATES: DriverDescriptor[] = [
  {
    kind: 'cy-dali64a',
    displayName: '元创智控 CY-DALI64A (DALI 网关)',
    vendor: '元创智控',
    category: 'dali-gateway',
    protocol: 'modbus-rtu-over-tcp',
    capabilities: [
      'turn_on',
      'turn_off',
      'set_brightness',
      'set_color_temp',
      'recall_scene',
      'get_status',
      'set_zone_brightness',
      'health_check',
    ],
    defaultAddressing: {
      slaveId: 1,
      port: 502,
      frameIntervalMs: 200,
      daliStart: 1,
      daliCount: 64,
    },
    paramSchema: {
      ip: {
        type: 'string',
        label: 'RTU↔TCP 转换器 IP',
        required: true,
        placeholder: '192.168.x.x',
      },
      port: { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
      slaveId: { type: 'number', label: 'Modbus 从机号', default: 1, min: 1, max: 247 },
      frameIntervalMs: {
        type: 'number',
        label: '帧间隔 (ms)',
        default: 200,
        min: 50,
        max: 2000,
      },
      defaultFadeSec: {
        type: 'number',
        label: '默认渐变秒数',
        default: 0.7,
        min: 0,
        max: 90,
      },
    },
    remark:
      'DALI 2.0 总线网关, 64 个短地址, 16 个 group, 16 个 scene. 走 Modbus RTU 帧, 通过 USR-TCP232 转 TCP 接入.',
  },
  {
    kind: 'nova-vx',
    displayName: '诺瓦 NovaStar V/VX 系列 (LED 视频控制器)',
    vendor: '诺瓦 NovaStar',
    category: 'led-controller',
    protocol: 'nova-vx-tcp',
    capabilities: [
      'power_on',
      'power_off',
      'switch_input',
      'set_brightness',
      'load_preset',
      'save_preset',
      'ensure_fullscreen_layer',
      'play_media',
      'show_welcome',
      'get_status',
      'health_check',
    ],
    defaultAddressing: { box: '1', port: 5200 },
    paramSchema: {
      ip: {
        type: 'string',
        label: '控制器 IP',
        required: true,
        placeholder: '192.168.x.x',
      },
      port: { type: 'number', label: 'TCP 端口', default: 5200, min: 1, max: 65535 },
      resolutionWidth: { type: 'number', label: '全屏图层宽 (px)', default: 3612 },
      resolutionHeight: { type: 'number', label: '全屏图层高 (px)', default: 1462 },
      presetWelcome: {
        type: 'number',
        label: '欢迎页预设号',
        default: 1,
        min: 1,
        max: 10,
      },
      presetVideo: { type: 'number', label: '视频预设号', default: 2, min: 1, max: 10 },
      defaultBrightnessPct: {
        type: 'number',
        label: '开屏默认亮度 %',
        default: 80,
        min: 0,
        max: 100,
      },
    },
    remark:
      '兼容 V700/V760/V900/V960/V1060/V1260/V2460 + VX400/VX1000/VX1000 Pro/VX600 Pro/VX2000 Pro. TCP 5200, 帧头 0x55 0xAA, 校验和 = sum(body)+0x5555.',
  },
  {
    kind: 'ekx-808',
    displayName: '得胜 TAKSTAR EKX-808 (8×8 数字矩阵 DSP)',
    vendor: '得胜 TAKSTAR',
    category: 'audio-dsp',
    protocol: 'takstar-ekx-tcp',
    capabilities: [
      'set_volume',
      'mute',
      'recall_scene',
      'read_current_scene',
      'set_matrix',
      'aux_switch',
      'read_level',
      'health_check',
    ],
    defaultAddressing: { devAddr: 1, tcpPort: 9761, inputs: 8, outputs: 8 },
    paramSchema: {
      ip: { type: 'string', label: 'DSP IP', required: true, placeholder: '192.168.x.x' },
      tcpPort: { type: 'number', label: 'TCP 端口', default: 9761, min: 1, max: 65535 },
      devAddr: { type: 'number', label: '设备地址', default: 1, min: 1, max: 254 },
    },
    remark: '8 输入 8 输出数字音频矩阵 + DSP, 支持用户预设 U01-U12, AEC/NR/摄像跟踪/自动混音开关.',
  },
  {
    kind: 'zhonghong-mbt',
    displayName: '中弘 ZHONGHONG B 集控网关 (TCP / VRF 空调)',
    vendor: '中弘 ZHONGHONG',
    category: 'hvac-gateway',
    protocol: 'modbus-tcp',
    capabilities: [
      'turn_on',
      'turn_off',
      'set_temperature',
      'set_mode',
      'set_fan_speed',
      'get_status',
      'health_check',
    ],
    defaultAddressing: {
      slaveId: 1,
      port: 502,
      maxIndoor: 64,
      protocol: 'MODBUS-TCP (MBT v3.2)',
    },
    paramSchema: {
      ip: {
        type: 'string',
        label: '网关 IP',
        required: true,
        placeholder: '192.168.x.x',
      },
      port: { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
      slaveId: { type: 'number', label: 'Modbus 从机号', default: 1, min: 1, max: 247 },
      maxIndoor: { type: 'number', label: '最大内机数', default: 64, min: 1, max: 64 },
    },
    remark:
      '一台网关挂 1-64 台 VRF 内机, 走 Modbus TCP. 跟商用奥克斯/大金/美的等品牌 VRF 主机配对.',
  },
  {
    kind: 'takstar-epo802p',
    displayName: '得胜 EPO-802P 8 路电源时序器',
    vendor: '得胜 TAKSTAR',
    category: 'audio-power',
    protocol: 'serial',
    capabilities: ['turn_on', 'turn_off', 'get_status', 'health_check'],
    defaultAddressing: { baud: 19200, devAddr: 0, channels: 8 },
    paramSchema: {
      ip: { type: 'string', label: '串口号', required: true, placeholder: 'COM1' },
      baud: { type: 'number', label: '波特率', default: 19200, min: 1200, max: 115200 },
      devAddr: { type: 'number', label: '机器 ID', default: 0, min: 0, max: 255 },
    },
    remark:
      '8 路时序上电保护功放. GK9000 板载 COM1 直连, 19200 8N1. 全开/全关走 b3 由设备按延时依次动作.',
  },
  {
    kind: 'generic-seq55',
    displayName: '通用 8 路电源时序器 (55/AA 协议)',
    vendor: '通用',
    category: 'power-seq55',
    protocol: 'serial',
    capabilities: ['turn_on', 'turn_off', 'health_check'],
    defaultAddressing: { baud: 9600, devAddr: 1, channels: 8 },
    paramSchema: {
      ip: { type: 'string', label: '串口号', required: true, placeholder: 'COM2' },
      baud: { type: 'number', label: '波特率', default: 9600, min: 1200, max: 115200 },
      devAddr: { type: 'number', label: '机器地址', default: 1, min: 1, max: 255 },
    },
    remark:
      '6 字节 55…AA 协议, 9600 8N1, 与 EPO-802P 不能共串口。面板电源按键须置关才受控; 读状态回帧格式待到货实测。',
  },
  {
    kind: 'epa-breaker',
    displayName: 'ePa 智能断路器 / 远程空开 (485 Modbus)',
    vendor: 'ePa',
    category: 'power-breaker',
    protocol: 'modbus-rtu',
    capabilities: ['turn_on', 'turn_off', 'get_status', 'get_measurements', 'health_check'],
    defaultAddressing: { port: 502, slaveId: 255 },
    paramSchema: {
      ip: {
        type: 'string',
        label: 'RTU↔TCP 转换器 IP',
        required: true,
        placeholder: '192.168.50.21',
      },
      port: { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
      slaveId: { type: 'number', label: 'Modbus 从机号', default: 255, min: 1, max: 255 },
    },
    remark:
      '给大屏做远程物理总闸: 合闸/分闸 + 计量. 485 标准 Modbus-RTU(115200/8N1/CRC16), 经有人 RTU-TCP 转换器接入(别与 DALI 那台共用, 波特率不同). 分合闸写寄存器 0x0101(1合/2分). 2026-07-22 现场联调通过: 转换器 192.168.50.21:502, 从机号 255.',
  },
  {
    kind: 'fusion-player',
    displayName: '投影视频融合器 (播控协议)',
    vendor: 'JBT',
    category: 'projector-fusion',
    protocol: 'tcp-text',
    capabilities: [
      'enum_windows',
      'open_window',
      'close_window',
      'replace_window',
      'move_window',
      'resize_window',
      'play_window',
      'pause_window',
      'enum_modes',
      'run_mode',
      'get_running_plan',
      'stop_plan',
      'set_window_volume',
      'mute_window',
      'get_playlist',
      'set_playlist_current',
      'health_check',
    ],
    defaultAddressing: { port: 63426, canvas: 0 },
    paramSchema: {
      ip: {
        type: 'string',
        label: '融合器 IP',
        required: true,
        placeholder: '192.168.1.168',
      },
      port: { type: 'number', label: 'TCP 端口', default: 63426, min: 1, max: 65535 },
      canvas: {
        type: 'number',
        label: '画布/屏索引 (open/close 前置字段)',
        default: 0,
        min: 0,
        max: 7,
      },
    },
    remark:
      '投影仪 4K 二通道融合处理器 (JBT-SK-HD02). 网口直连 TCP 文本协议《播控中控》, 端口 63426. 开/关/移动/缩放窗口 + 切源 + 音量 + 播放列表. 坐标归一化 0~1. 2026-07-23 现场实机验通核心命令(固件 2.4.25.268 比文档新, open/close 有前置画布字段). run_mode(调预设)待设备里配好模式 + 拿厂家新版文档后补.',
  },
];

/** Move built-in catalog creation out of application startup. */
export class EstablishBuiltinDriverTemplates1789610000000 implements MigrationInterface {
  name = 'EstablishBuiltinDriverTemplates1789610000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const template of BUILTIN_DRIVER_TEMPLATES) {
      await queryRunner.query(
        `INSERT INTO driver_templates
         (kind, "displayName", vendor, category, protocol, "capabilitiesJson",
          "defaultAddressingJson", "paramSchemaJson", remark, builtin, enabled,
          created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (SELECT 1 FROM driver_templates WHERE kind = ?)`,
        [
          template.kind,
          template.displayName,
          template.vendor,
          template.category,
          template.protocol,
          JSON.stringify(template.capabilities ?? []),
          template.defaultAddressing ? JSON.stringify(template.defaultAddressing) : null,
          template.paramSchema ? JSON.stringify(template.paramSchema) : null,
          template.remark ?? null,
          template.kind,
        ],
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const kinds = BUILTIN_DRIVER_TEMPLATES.map((template) => template.kind);
    const placeholders = kinds.map(() => '?').join(', ');
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM driver_templates WHERE kind IN (${placeholders})`,
      kinds,
    )) as Array<{ count: number }>;
    if (Number(count) > 0) {
      throw new Error(
        'BUILTIN_DRIVER_TEMPLATE_ROLLBACK_REQUIRES_ARCHIVE: authoritative catalog exists',
      );
    }
  }
}
