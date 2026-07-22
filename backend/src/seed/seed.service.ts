import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device, DeviceCategory } from '../entities/device.entity';
import { Scene } from '../entities/scene.entity';
import { SceneAction } from '../entities/scene-action.entity';
import { User } from '../entities/user.entity';
import { UatCategory, UatRecord } from '../entities/uat-record.entity';
import { HardwareCategory, HardwareUnit } from '../entities/hardware-unit.entity';
import { LightZone } from '../entities/light-zone.entity';
import { LightGroup } from '../entities/light-group.entity';
import { hashPassword } from '../common/utils/password.util';

interface UatSeed {
  itemName: string;
  category: UatCategory;
  testStep: string;
  expectedResult: string;
}

const UAT_ITEMS: UatSeed[] = [
  // 场景验收
  { itemName: '场景: 开馆模式', category: 'scene', testStep: '后台或平板点击「开馆模式」', expectedResult: '所有楼层主灯打开, LED 显示欢迎页, 背景音乐播放, 空调正常运行' },
  { itemName: '场景: 接待模式', category: 'scene', testStep: '点击「接待模式」', expectedResult: '主区灯光柔和, LED 切换演示内容, 音响适中, 空调舒适温度' },
  { itemName: '场景: 会议模式', category: 'scene', testStep: '点击「会议模式」', expectedResult: '会议区灯光合适, LED 切换 HDMI 笔记本输入, 音响音量适中' },
  { itemName: '场景: 路演模式', category: 'scene', testStep: '点击「路演模式」', expectedResult: '舞台灯亮, LED 播放预设视频, 音响开启' },
  { itemName: '场景: 清洁模式', category: 'scene', testStep: '点击「清洁模式」', expectedResult: '所有照明开到 100%, LED/音响关闭' },
  { itemName: '场景: 闭馆模式', category: 'scene', testStep: '点击「闭馆模式」', expectedResult: '主灯关闭, 仅安防应急照明, LED/音响关闭, 空调关闭' },
  // 设备验收
  { itemName: '设备: 灯光开关', category: 'device', testStep: '灯光页点击 1F/2F 开/关按钮', expectedResult: '设备实际开关, 后台状态同步刷新' },
  { itemName: '设备: 灯光调光', category: 'device', testStep: '拖动亮度滑条至 30/60/100', expectedResult: 'DALI 指令下发, 实际亮度跟随' },
  { itemName: '设备: LED 开关屏', category: 'device', testStep: 'LED 页点击开屏/关屏', expectedResult: 'LED 实际开关, NUC 输出生效' },
  { itemName: '设备: LED 播放视频', category: 'device', testStep: '选择视频或播放欢迎页', expectedResult: 'LED 切换至对应输入并播放, 无黑屏' },
  { itemName: '设备: 音响音量控制', category: 'device', testStep: '音响页拖动音量滑条 / 切换静音', expectedResult: 'DSP 音量实际变化, 静音生效, 取消静音恢复' },
  { itemName: '设备: 空调温度控制', category: 'device', testStep: '空调页设置 20/24/28 ℃ 并切换制冷/制热', expectedResult: 'Modbus 指令下发, 空调实际温度模式跟随' },
  // 稳定性验收
  { itemName: '稳定性: 断网恢复', category: 'stability', testStep: '拔掉网关网线 30s 后插回', expectedResult: '设备显示 reconnecting → online, 报警自动 resolve' },
  { itemName: '稳定性: 断电恢复', category: 'stability', testStep: '断开网关电源 1 分钟后供电', expectedResult: 'PM2 自动恢复连接, 网关回到 online' },
  { itemName: '稳定性: 设备离线提示', category: 'stability', testStep: '强制某网关离线 (改 IP 错误)', expectedResult: '报警中心创建 critical alert, 平板顶部红色提示' },
  { itemName: '稳定性: 场景执行日志', category: 'stability', testStep: '执行任意场景后查看后台→执行记录', expectedResult: '记录完整, 失败设备明细可见, 成功/失败计数准确' },
];

interface DeviceSeed {
  name: string;
  category: DeviceCategory;
  protocol: string;
  adapter: string;
  floor: string;
  zone: string;
  /** JSON 字符串, 示例 '{"slaveId":1,"group":3}', adapter 解析后用作寻址 */
  address?: string;
}

interface SceneSeed {
  code: string;
  name: string;
  description: string;
}

const SCENES: SceneSeed[] = [
  { code: 'opening', name: '开馆模式', description: '展馆开放期间常规灯光与音响' },
  { code: 'reception', name: '接待模式', description: '重要客户接待场景' },
  { code: 'meeting', name: '会议模式', description: '会议区域灯光与显示设备' },
  { code: 'roadshow', name: '路演模式', description: '展品路演与互动展示' },
  { code: 'cleaning', name: '清洁模式', description: '保洁时段照明' },
  { code: 'closing', name: '闭馆模式', description: '闭馆后基础安防与节能照明' },
];

// 灯光设备 = DALI 组. id 后缀 = DALI 组号 (与 LightingPage 前端 zone.id 对齐)
// 走 CY-DALI64A 网关 (Modbus RTU over TCP). LIGHTING_ADAPTER_KIND=cy-dali64a (默认)
const DEVICES: DeviceSeed[] = [
  // ---- 1F (DALI 组 1-7) ----
  { name: 'light_1f_lobby',      category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'lobby',         address: '{"slaveId":1,"group":1}' },
  { name: 'light_1f_roadshow',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'roadshow',      address: '{"slaveId":1,"group":2}' },
  { name: 'light_1f_corridor',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'corridor',      address: '{"slaveId":1,"group":3}' },
  { name: 'light_1f_accent',     category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'accent',        address: '{"slaveId":1,"group":4}' },
  { name: 'light_1f_exhibit',    category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'f102_exhibit',  address: '{"slaveId":1,"group":5}' },
  { name: 'light_1f_showroom',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'f103_showroom', address: '{"slaveId":1,"group":6}' },
  { name: 'light_1f_trade',      category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'f104_trade',    address: '{"slaveId":1,"group":7}' },
  // ---- 2F (DALI 组 8-12) ----
  { name: 'light_2f_lobby',      category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'lobby_corridor', address: '{"slaveId":2,"group":8}'  },
  { name: 'light_2f_service',    category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'service_center', address: '{"slaveId":2,"group":9}'  },
  { name: 'light_2f_office',     category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'shared_office',  address: '{"slaveId":2,"group":10}' },
  { name: 'light_2f_research',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'research_center',address: '{"slaveId":2,"group":11}' },
  { name: 'light_2f_command',    category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'command_center', address: '{"slaveId":2,"group":12}' },
  { name: 'led_1f_main', category: 'led', protocol: 'tcp', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'led_2f_main', category: 'led', protocol: 'tcp', adapter: 'mock', floor: '2F', zone: 'main' },
  { name: 'audio_1f', category: 'audio', protocol: 'tcp', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'audio_2f', category: 'audio', protocol: 'tcp', adapter: 'mock', floor: '2F', zone: 'main' },
  // ---- 中央空调内机 (奥克斯 ARV-X9 + 2 台中弘 B 集控 TCP 网关) ----
  // 1F 网关: 192.168.50.66:502 (slaveId 1), 挂 10 内机 (n=1..10)
  // 2F 网关: 192.168.50.67:502 (slaveId 1), 挂 12 内机 (n=1..12)
  // 数据来源: 《F1楼-一层二层空调位置明细》2026-05-21
  // address JSON: { gwHost, n, model, kw } — gwHost+n 唯一定位内机, model/kw 仅供前端显示
  // 1F (网关 192.168.50.66, n=1..10)
  { name: 'hvac_1f_exhibit_1',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'enterprise_booth_1', address: '{"gwHost":"192.168.50.66","n":1,"model":"DLR-63F","kw":1.8}' },
  { name: 'hvac_1f_exhibit_2',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'enterprise_booth_2', address: '{"gwHost":"192.168.50.66","n":2,"model":"DLR-63F","kw":1.8}' },
  { name: 'hvac_1f_exhibit_3',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'enterprise_booth_3', address: '{"gwHost":"192.168.50.66","n":3,"model":"DLR-63F","kw":1.8}' },
  { name: 'hvac_1f_livestream',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'livestream',         address: '{"gwHost":"192.168.50.66","n":4,"model":"DLR-71F","kw":2.0}' },
  { name: 'hvac_1f_trade_1',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'foreign_trade_1',    address: '{"gwHost":"192.168.50.66","n":5,"model":"DLR-71F","kw":2.0}' },
  { name: 'hvac_1f_trade_2',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'foreign_trade_2',    address: '{"gwHost":"192.168.50.66","n":6,"model":"DLR-80F","kw":2.0}' },
  { name: 'hvac_1f_park_display',  category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'park_display',       address: '{"gwHost":"192.168.50.66","n":7,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_1f_roadshow_1',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'roadshow_1',         address: '{"gwHost":"192.168.50.66","n":8,"model":"DLR-100F","kw":2.2}' },
  { name: 'hvac_1f_roadshow_2',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'roadshow_2',         address: '{"gwHost":"192.168.50.66","n":9,"model":"DLR-112F","kw":2.2}' },
  { name: 'hvac_1f_showcase',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '1F', zone: 'enterprise_showcase',address: '{"gwHost":"192.168.50.66","n":10,"model":"DLR-125F","kw":2.2}' },
  // 2F (网关 192.168.50.67, n=1..12)
  { name: 'hvac_2f_group_mgmt',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'group_mgmt',         address: '{"gwHost":"192.168.50.67","n":1,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_decision',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'decision_center',    address: '{"gwHost":"192.168.50.67","n":2,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_meeting',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'meeting_room',       address: '{"gwHost":"192.168.50.67","n":3,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_shared_1',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'shared_office_1',    address: '{"gwHost":"192.168.50.67","n":4,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_shared_2',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'shared_office_2',    address: '{"gwHost":"192.168.50.67","n":5,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_service_1',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'service_center_1',   address: '{"gwHost":"192.168.50.67","n":6,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_service_2',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'service_center_2',   address: '{"gwHost":"192.168.50.67","n":7,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_command_1',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'command_center_1',   address: '{"gwHost":"192.168.50.67","n":8,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_command_2',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'command_center_2',   address: '{"gwHost":"192.168.50.67","n":9,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_2f_lobby_1',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'lobby_1',            address: '{"gwHost":"192.168.50.67","n":10,"model":"DLR-100F","kw":2.2}' },
  { name: 'hvac_2f_lobby_2',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'lobby_2',            address: '{"gwHost":"192.168.50.67","n":11,"model":"DLR-100F","kw":2.2}' },
  { name: 'hvac_2f_research',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'zhonghong-mbt', floor: '2F', zone: 'research_center',    address: '{"gwHost":"192.168.50.67","n":12,"model":"DLR-100F","kw":2.2}' },
];

// ============ 场景动作种子 ============
// 6 个标准场景的预设动作清单 — 首次启动自动种入, 现场可随时在后台调整
// 设计原则:
//   - 灯光: deviceType=lighting, deviceId 用 DALI 组号 (1-12, 见 LightingPage.vue)
//   - LED:  deviceType=led, deviceId='led_1f_main' / 'led_2f_main' (设备表 name)
//   - 音响: deviceType=audio, deviceId='audio_1f' / 'audio_2f'
//   - 空调: deviceType=hvac-zone, deviceId=区代号 (见 hvac-zones.ts)
//   - sortOrder: 升序执行; 同 sortOrder 并发执行 (scene engine 分组规则)

interface SceneActionSeed {
  deviceType: string;
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
  delayMs?: number;
}

const SCENE_ACTIONS: Record<string, SceneActionSeed[]> = {
  // ==================== 开馆模式 ====================
  // 全部展示区灯光开 + LED 显示欢迎页 + 背景音乐 + 主要展示区空调
  opening: [
    // -- 灯光 (1F 主区 80%, 2F 公共区 80%, 办公区 70%) --
    { deviceType: 'lighting', deviceId: '1', command: 'setBrightness', params: { value: 80 } },   // 1F 前厅
    { deviceType: 'lighting', deviceId: '2', command: 'setBrightness', params: { value: 70 } },   // 1F 路演 (开馆未路演, 给适中)
    { deviceType: 'lighting', deviceId: '3', command: 'setBrightness', params: { value: 60 } },   // 1F 走廊
    { deviceType: 'lighting', deviceId: '4', command: 'setBrightness', params: { value: 80 } },   // 1F 重点照明
    { deviceType: 'lighting', deviceId: '5', command: 'setBrightness', params: { value: 75 } },   // 1F 企业展位
    { deviceType: 'lighting', deviceId: '6', command: 'setBrightness', params: { value: 75 } },   // 1F 综合展销
    { deviceType: 'lighting', deviceId: '7', command: 'setBrightness', params: { value: 75 } },   // 1F 物贸交易
    { deviceType: 'lighting', deviceId: '8', command: 'setBrightness', params: { value: 80 } },   // 2F 前厅
    { deviceType: 'lighting', deviceId: '9', command: 'setBrightness', params: { value: 80 } },   // 2F 服务中心
    { deviceType: 'lighting', deviceId: '10', command: 'setBrightness', params: { value: 70 } },  // 2F 共享办公
    { deviceType: 'lighting', deviceId: '11', command: 'setBrightness', params: { value: 80 } },  // 2F 研究/接待
    { deviceType: 'lighting', deviceId: '12', command: 'setBrightness', params: { value: 80 } },  // 2F 指挥中心
    // -- LED 显示欢迎页 --
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'showWelcome', delayMs: 500 },
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'showWelcome', delayMs: 500 },
    // -- 音响背景音乐 --
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'unmute' },
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'setVolume', params: { value: 40 } },
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'playBgm', params: { track: 'welcome', channel: 'bgm' } },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'unmute' },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'setVolume', params: { value: 35 } },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'playBgm', params: { track: 'welcome', channel: 'bgm' } },
    // -- 空调: 主要展示区 + 公共区开机, 制冷 24°C --
    { deviceType: 'hvac-zone', deviceId: 'park_display',    command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'park_display',    command: 'setMode',        params: { mode: 'cool' } },
    { deviceType: 'hvac-zone', deviceId: 'park_display',    command: 'setTemperature', params: { value: 24 } },
    { deviceType: 'hvac-zone', deviceId: 'enterprise_booth', command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'enterprise_booth', command: 'setTemperature', params: { value: 24 } },
    { deviceType: 'hvac-zone', deviceId: 'foreign_trade',   command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'foreign_trade',   command: 'setTemperature', params: { value: 24 } },
    { deviceType: 'hvac-zone', deviceId: 'showcase',        command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'showcase',        command: 'setTemperature', params: { value: 24 } },
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',        command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',        command: 'setTemperature', params: { value: 24 } },
    { deviceType: 'hvac-zone', deviceId: 'service_center',  command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'service_center',  command: 'setTemperature', params: { value: 24 } },
  ],

  // ==================== 接待模式 ====================
  // 主接待区灯光柔和 + LED 切企业宣传 + 音响适中 + 接待区空调舒适
  reception: [
    // -- 灯光: 前厅亮, 路演适中, 接待区亮, 办公暗 --
    { deviceType: 'lighting', deviceId: '1', command: 'setBrightness', params: { value: 70 } },
    { deviceType: 'lighting', deviceId: '2', command: 'setBrightness', params: { value: 50 } },
    { deviceType: 'lighting', deviceId: '4', command: 'setBrightness', params: { value: 90 } },   // 重点照明加亮
    { deviceType: 'lighting', deviceId: '8', command: 'setBrightness', params: { value: 80 } },   // 2F 前厅
    { deviceType: 'lighting', deviceId: '11', command: 'setBrightness', params: { value: 85 } },  // 2F 接待
    { deviceType: 'lighting', deviceId: '10', command: 'setBrightness', params: { value: 30 } },  // 2F 办公暗下来
    // -- LED --
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'switchInput', params: { input: 'HDMI1' } },
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'switchInput', params: { input: 'HDMI1' } },
    // -- 音响适中 --
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'setVolume', params: { value: 45 } },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'setVolume', params: { value: 45 } },
    // -- 空调: 接待区 + 决策中心 + 前厅, 24°C --
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',        command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',        command: 'setMode',        params: { mode: 'cool' } },
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',        command: 'setTemperature', params: { value: 24 } },
    { deviceType: 'hvac-zone', deviceId: 'decision_center', command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'decision_center', command: 'setTemperature', params: { value: 23 } },
    { deviceType: 'hvac-zone', deviceId: 'group_mgmt',      command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'group_mgmt',      command: 'setTemperature', params: { value: 23 } },
    { deviceType: 'hvac-zone', deviceId: 'research_center', command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'research_center', command: 'setTemperature', params: { value: 23 } },
  ],

  // ==================== 会议模式 ====================
  // 会议室灯亮 + LED HDMI 输入 + 音响 + 麦克风 + 会议室空调
  meeting: [
    // -- 灯光: 会议室亮, 其他保持原状 --
    { deviceType: 'lighting', deviceId: '11', command: 'setBrightness', params: { value: 80 } },  // 2F 研究/接待 (含会议)
    { deviceType: 'lighting', deviceId: '12', command: 'setBrightness', params: { value: 70 } },  // 2F 指挥中心
    // -- LED 切 HDMI (会议笔记本接入) --
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'switchInput', params: { input: 'HDMI1' } },
    // -- 音响 + MIC --
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'setVolume', params: { value: 50 } },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'enableMic', params: { mic: 'wireless_1' } },
    // -- 空调: 会议室低风 23°C --
    { deviceType: 'hvac-zone', deviceId: 'meeting_room',    command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'meeting_room',    command: 'setMode',     params: { mode: 'cool' } },
    { deviceType: 'hvac-zone', deviceId: 'meeting_room',    command: 'setTemperature', params: { value: 23 } },
    { deviceType: 'hvac-zone', deviceId: 'meeting_room',    command: 'setFanSpeed', params: { speed: 'low' } },
  ],

  // ==================== 路演模式 ====================
  // 路演区灯亮 + LED 播放预设视频 + 音响大音量 + 路演区空调凉爽 (人多发热)
  roadshow: [
    // -- 灯光: 路演区超亮, 直播间亮, 其他普通 --
    { deviceType: 'lighting', deviceId: '2', command: 'setBrightness', params: { value: 90 } },   // 1F 路演主灯
    { deviceType: 'lighting', deviceId: '4', command: 'setBrightness', params: { value: 100 } },  // 重点照明全开
    { deviceType: 'lighting', deviceId: '1', command: 'setBrightness', params: { value: 60 } },   // 1F 前厅适中
    { deviceType: 'lighting', deviceId: '5', command: 'setBrightness', params: { value: 50 } },   // 1F 展位暗下来
    // -- LED 播放预设视频 --
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'playMedia', params: { media: 'roadshow_default' } },
    // -- 音响大音量 --
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'unmute' },
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'setVolume', params: { value: 65 } },
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'enableMic', params: { mic: 'wireless_1' } },
    // -- 空调: 路演 + 直播间 22°C 中风 (人多发热) --
    { deviceType: 'hvac-zone', deviceId: 'roadshow',   command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'roadshow',   command: 'setMode',        params: { mode: 'cool' } },
    { deviceType: 'hvac-zone', deviceId: 'roadshow',   command: 'setTemperature', params: { value: 22 } },
    { deviceType: 'hvac-zone', deviceId: 'roadshow',   command: 'setFanSpeed',    params: { speed: 'mid' } },
    { deviceType: 'hvac-zone', deviceId: 'livestream', command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: 'livestream', command: 'setMode',        params: { mode: 'cool' } },
    { deviceType: 'hvac-zone', deviceId: 'livestream', command: 'setTemperature', params: { value: 22 } },
  ],

  // ==================== 清洁模式 ====================
  // 全部灯 100% (照清楚) + LED/音响关 + 空调大部分关 (省电, 仅前厅保留低温)
  cleaning: [
    // -- 全部灯 100% --
    { deviceType: 'lighting', deviceId: '1',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '2',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '3',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '4',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '5',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '6',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '7',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '8',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '9',  command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '10', command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '11', command: 'setBrightness', params: { value: 100 } },
    { deviceType: 'lighting', deviceId: '12', command: 'setBrightness', params: { value: 100 } },
    // -- LED / 音响关 --
    { deviceType: 'led',   deviceId: 'led_1f_main', command: 'powerOff' },
    { deviceType: 'led',   deviceId: 'led_2f_main', command: 'powerOff' },
    { deviceType: 'audio', deviceId: 'audio_1f',    command: 'stopBgm' },
    { deviceType: 'audio', deviceId: 'audio_2f',    command: 'stopBgm' },
    { deviceType: 'audio', deviceId: 'audio_1f',    command: 'mute' },
    { deviceType: 'audio', deviceId: 'audio_2f',    command: 'mute' },
    // -- 空调: 大部分关 (省电), 前厅保留 26°C --
    { deviceType: 'hvac-zone', deviceId: 'enterprise_booth', command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'livestream',       command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'foreign_trade',    command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'roadshow',         command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'showcase',         command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'meeting_room',     command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'shared_office',    command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'service_center',   command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'command_center',   command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'group_mgmt',       command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'decision_center',  command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'research_center',  command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'park_display',     command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',         command: 'setTemperature', params: { value: 26 } },
  ],

  // ==================== 闭馆模式 ====================
  // 全部灯关 + LED/音响关 + 空调全关
  closing: [
    // -- 灯光全关 --
    { deviceType: 'lighting', deviceId: '1',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '2',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '3',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '4',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '5',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '6',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '7',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '8',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '9',  command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '10', command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '11', command: 'turnOff' },
    { deviceType: 'lighting', deviceId: '12', command: 'turnOff' },
    // -- LED 全关 --
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOff' },
    { deviceType: 'led', deviceId: 'led_2f_main', command: 'powerOff' },
    // -- 音响全关 --
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'stopBgm' },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'stopBgm' },
    { deviceType: 'audio', deviceId: 'audio_1f', command: 'mute' },
    { deviceType: 'audio', deviceId: 'audio_2f', command: 'mute' },
    // -- 空调全关 (14 个区) --
    { deviceType: 'hvac-zone', deviceId: 'enterprise_booth', command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'livestream',       command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'foreign_trade',    command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'park_display',     command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'roadshow',         command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'showcase',         command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'group_mgmt',       command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'decision_center',  command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'meeting_room',     command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'shared_office',    command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'service_center',   command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'command_center',   command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'lobby_2f',         command: 'turnOff' },
    { deviceType: 'hvac-zone', deviceId: 'research_center',  command: 'turnOff' },
  ],
};

@Injectable()
export class SeedService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneAction) private readonly actionRepo: Repository<SceneAction>,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @InjectRepository(UatRecord) private readonly uatRepo: Repository<UatRecord>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(LightZone) private readonly lightZoneRepo: Repository<LightZone>,
    @InjectRepository(LightGroup) private readonly lightGroupRepo: Repository<LightGroup>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    await this.seedAdmin();
    await this.seedScenes();
    await this.seedSceneActions();
    await this.seedDevices();
    await this.seedHardware();
    await this.seedLightZones();
    await this.seedUat();
    this.logger.info('Seed completed', { context: 'SeedService' });
  }

  /**
   * Sprint E (2026-05-31): 灌入灯光分区数据.
   *
   * 历史: 前端 LightingPage.vue 把 12 个 zone 硬编码在文件里, 每个 zone id
   * 当 DALI group 号直传 backend. Sprint E 把 zone 升格成 DB 一等公民, 这里
   * 是初始化数据, 跟旧硬编码保持视觉一致.
   *
   * 新增 (2F GW-DALI-2 group 3/4): 现场实际接的 2 盏调试灯, 之前 hardcode 没
   * 这俩 (group 8-12 的灯其实没接, 只是占位). 把它们加进来, 用户在 LightingPage
   * 2F tab 上能直接看到并控制.
   *
   * 幂等: 按 code 唯一, 已存在跳过 — 业主在后台改过的不被覆盖.
   */
  /**
   * 灯光分区 + DALI 组 (2026-07-16 现场重构).
   *
   * 变了什么:
   *   - 全楼只剩**一层**, 2F 那批分区 (测试灯 A/B、二层前厅…) 全部作废
   *   - 7 个分区 / 11 个组 —— **一个分区可含多个组** (业主: "有的多组灯放在一个分区")
   *   - 所以成员关系从 light_zone 上的单值 (gatewayCode, daliGroup) 搬到
   *     light_group.zoneCode (照 hvac_indoor 的做法), 见 LightGroup 实体注释
   *
   * 组的分布是**实测**的 (2026-07-16 扫两台网关的组亮度寄存器, 全部 254 亮着):
   *   网关2 (拨码2): 组 1, 2, 3
   *   网关1 (拨码1): 组 5, 6, 7, 8, 9, 10, 11
   * 共 10 组。业主说"11 组灯", 差的那组扫不到 —— 可能是组 4 (两台都没读到) 或某组
   * 当时不在线。现场核对: 缺的组补一条 light_group 记录即可, 前端能直接归区。
   * 注意组号在两台网关间会重复, 所以唯一键必须是 (gatewayCode, daliGroup).
   *
   * ⚠️ 组→分区的归属是**占位猜测**, 不是实测: 网关的 Modbus 寄存器表里没有"组成员"
   * 这一项 (查过), 所以读不出哪个组对应哪片区域。业主明确说 "后续可以在测试时再修改"
   * —— 前端可改, 现场点一个组看哪片灯亮, 改过来即可。别把这里的归属当事实。
   *
   * 幂等: 按 code / (网关,组) 唯一, 已存在跳过, 不覆盖业主改过的。
   */
  private async seedLightZones(): Promise<void> {
    interface ZoneSeed { code: string; name: string; sortOrder: number; icon?: string }
    const ZONES: ZoneSeed[] = [
      { code: 'front-hall',  name: '前厅',     sortOrder: 10, icon: 'Lightbulb' },
      { code: 'park-show',   name: '园区展示', sortOrder: 20, icon: 'Lightbulb' },
      { code: 'east-hall',   name: '东展区',   sortOrder: 30, icon: 'Lightbulb' },
      { code: 'south-hall',  name: '南展区',   sortOrder: 40, icon: 'Lightbulb' },
      { code: 'west-hall',   name: '西展区',   sortOrder: 50, icon: 'Lightbulb' },
      { code: 'release-hall',name: '发布厅',   sortOrder: 60, icon: 'Sparkles' },
      { code: 'corridor',    name: '走廊区',   sortOrder: 70, icon: 'Lightbulb' },
    ];

    // 实测在用的组 -> 占位归属 (测试时再改)
    interface GroupSeed { gatewayCode: string; daliGroup: number; zoneCode: string | null; sortOrder: number }
    const GROUPS: GroupSeed[] = [
      { gatewayCode: 'GW-DALI-2', daliGroup: 1,  zoneCode: 'front-hall',   sortOrder: 10 },
      { gatewayCode: 'GW-DALI-2', daliGroup: 2,  zoneCode: 'park-show',    sortOrder: 20 },
      { gatewayCode: 'GW-DALI-2', daliGroup: 3,  zoneCode: 'east-hall',    sortOrder: 30 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 5,  zoneCode: 'south-hall',   sortOrder: 40 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 6,  zoneCode: 'west-hall',    sortOrder: 50 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 7,  zoneCode: 'release-hall', sortOrder: 60 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 8,  zoneCode: 'corridor',     sortOrder: 70 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 9,  zoneCode: 'corridor',     sortOrder: 80 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 10, zoneCode: 'corridor',     sortOrder: 90 },
      { gatewayCode: 'GW-DALI-1', daliGroup: 11, zoneCode: 'corridor',     sortOrder: 100 },
    ];

    // 一次性清掉 2026-07-16 之前那批按两层规划的分区 (含 2F 全部 + 1F 旧命名).
    // 只在它们还带着老 code 时删, 删过就不会再命中, 幂等。
    const OBSOLETE = [
      '1f-front-hall', '1f-roadshow', '1f-corridor', '1f-accent',
      '1f-enterprise', '1f-general', '1f-trade',
      '2f-test-a', '2f-test-b', '2f-front-hall', '2f-enterprise-svc',
      '2f-coworking', '2f-research', '2f-control',
    ];
    for (const code of OBSOLETE) {
      const old = await this.lightZoneRepo.findOne({ where: { code } });
      if (old) {
        await this.lightZoneRepo.remove(old);
        this.logger.info(`Removed obsolete light zone: ${code}`, { context: 'SeedService' });
      }
    }

    let zCreated = 0;
    for (const z of ZONES) {
      if (await this.lightZoneRepo.findOne({ where: { code: z.code } })) continue;
      await this.lightZoneRepo.save(this.lightZoneRepo.create({
        code: z.code,
        name: z.name,
        floor: '1F',           // 全楼只剩一层
        gatewayCode: null,     // 遗留列, 成员看 light_group.zoneCode
        daliGroup: null,
        sortOrder: z.sortOrder,
        icon: z.icon ?? 'Lightbulb',
        description: null,
        enabled: true,
      }));
      zCreated += 1;
    }

    let gCreated = 0;
    for (const g of GROUPS) {
      const exists = await this.lightGroupRepo.findOne({
        where: { gatewayCode: g.gatewayCode, daliGroup: g.daliGroup },
      });
      if (exists) continue;
      await this.lightGroupRepo.save(this.lightGroupRepo.create({
        gatewayCode: g.gatewayCode,
        daliGroup: g.daliGroup,
        zoneCode: g.zoneCode,
        shorts: null,
        sortOrder: g.sortOrder,
        enabled: true,
      }));
      gCreated += 1;
    }
    this.logger.info(
      `Light zones: +${zCreated}/${ZONES.length}, DALI groups: +${gCreated}/${GROUPS.length}`,
      { context: 'SeedService' },
    );
  }

  /**
   * 给 6 个标准场景注入预设动作清单.
   * 幂等: 已有任何 action 的场景跳过 (避免覆盖现场手动调整).
   */
  private async seedSceneActions(): Promise<void> {
    for (const [code, actions] of Object.entries(SCENE_ACTIONS)) {
      const scene = await this.sceneRepo.findOne({ where: { code } });
      if (!scene) {
        this.logger.warn(`seedSceneActions: scene "${code}" not found, skip`, { context: 'SeedService' });
        continue;
      }
      const existing = await this.actionRepo.count({ where: { sceneId: scene.id } });
      if (existing > 0) {
        this.logger.info(`Scene ${code} already has ${existing} actions, skip seed`, { context: 'SeedService' });
        continue;
      }
      for (let i = 0; i < actions.length; i += 1) {
        const a = actions[i];
        const action = this.actionRepo.create({
          sceneId: scene.id,
          deviceType: a.deviceType,
          deviceId: a.deviceId,
          command: a.command,
          params: JSON.stringify(a.params ?? {}),
          delayMs: a.delayMs ?? 0,
          sortOrder: i + 1,
          enabled: true,
        });
        await this.actionRepo.save(action);
      }
      this.logger.info(`Seeded ${actions.length} actions for scene ${code}`, { context: 'SeedService' });
    }
  }

  private async seedUat(): Promise<void> {
    let idx = 0;
    for (const u of UAT_ITEMS) {
      idx += 1;
      const exists = await this.uatRepo.findOne({ where: { itemName: u.itemName } });
      if (exists) continue;
      const r = this.uatRepo.create({
        itemName: u.itemName,
        category: u.category,
        testStep: u.testStep,
        expectedResult: u.expectedResult,
        status: 'pending',
        sortOrder: idx,
      });
      await this.uatRepo.save(r);
      this.logger.info(`Seeded UAT: ${u.itemName}`, { context: 'SeedService' });
    }
  }

  private async seedAdmin(): Promise<void> {
    const username = 'admin';
    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) {
      this.logger.info(`User '${username}' already exists, skip`, { context: 'SeedService' });
      return;
    }
    const user = this.userRepo.create({
      username,
      password: hashPassword('admin123'),
      role: 'admin',
      enabled: true,
    });
    await this.userRepo.save(user);
    this.logger.info(`Seeded user: ${username} (default password: admin123)`, {
      context: 'SeedService',
    });
  }

  private async seedScenes(): Promise<void> {
    for (const s of SCENES) {
      const exists = await this.sceneRepo.findOne({ where: { code: s.code } });
      if (exists) continue;
      const scene = this.sceneRepo.create({
        code: s.code,
        name: s.name,
        description: s.description,
        enabled: true,
      });
      await this.sceneRepo.save(scene);
      this.logger.info(`Seeded scene: ${s.code} (${s.name})`, { context: 'SeedService' });
    }
  }

  private async seedDevices(): Promise<void> {
    for (const d of DEVICES) {
      const exists = await this.deviceRepo.findOne({ where: { name: d.name } });
      if (exists) continue;
      const device = this.deviceRepo.create({
        name: d.name,
        category: d.category,
        protocol: d.protocol,
        adapter: d.adapter,
        ip: null,
        address: d.address ?? null,
        floor: d.floor,
        zone: d.zone,
        enabled: true,
        status: 'offline',
      });
      await this.deviceRepo.save(device);
      this.logger.info(`Seeded device: ${d.name} (${d.category})`, { context: 'SeedService' });
    }
  }

  private async seedHardware(): Promise<void> {
    interface HardwareSeed {
      code: string;
      name: string;
      category: HardwareCategory;
      vendor: string;
      model: string;
      driverKind?: string;
      location?: string;
      floor?: string;
      ip?: string;
      addressing?: string;
      channels?: string;
      remark?: string;
    }

    const HARDWARE: HardwareSeed[] = [
      // ---- 中控核心 ----
      {
        code: 'HOST-GK9000',
        name: '中控主机 (GK9000)',
        category: 'other',
        vendor: '占美 GIADA',
        model: 'GK9000',
        floor: '1F',
        location: '1F 主控室 / 弱电机柜',
        addressing: JSON.stringify({
          cpu: 'Intel i7-10750H (6C12T)',
          ram: '16GB DDR4',
          ssd: '1TB',
          serialPorts: 6,
          nics: 2,
          os: 'Windows 10 Pro',
        }),
        remark: 'Windows 10 + Node.js 20 + PM2 + Nginx, D:\\smart-control\\; NIC1=DeviceLAN 192.168.50.10, NIC2=MgmtLAN(DHCP), 6 COM 闲置备用',
      },
      // ---- DALI 灯光 ----
      {
        code: 'CONV-RTU-1',
        name: 'RS485 RTU↔TCP 转换器',
        category: 'rtu-tcp-converter',
        vendor: '有人 USR',
        model: 'USR-TCP232-410S',
        driverKind: 'cy-dali64a',
        ip: '192.168.50.20',
        floor: '1F',
        location: '1F 弱电机柜 / 公共电箱 F101 附近',
        addressing: JSON.stringify({ port: 502, baud: 9600, parity: 'N', stop: 1 }),
        remark: 'RS485 端接 CY-DALI64A 控制串口 (非调试串口). IP 跟 .env DALI_RTU_HOST 一致.',
      },
      {
        code: 'GW-DALI-1',
        name: 'DALI 网关 #1',
        category: 'dali-gateway',
        vendor: '元创智控',
        model: 'CY-DALI64A',
        floor: '1F',
        location: '弱电机柜',
        // addressing.groups: 这台网关上**实测**存在的 DALI 组 (2026-07-16 扫组亮度寄存器).
        // 只给 health probe / 老 setZoneBrightness 用; 分区下发已改成显式带 slaveId
        // 的 setBrightnessOnGateway, 不走这张表 —— 组号在两台网关间会重复, 一张
        // 全局 group→slave 表本来就表达不了.
        addressing: JSON.stringify({ slaveId: 1, baud: 9600, frameIntervalMs: 200, groups: [5, 6, 7, 8, 9, 10, 11] }),
        remark: 'DALI 总线 16V/250mA, 拨码盘地址 1, RS485 控制串口接 CONV-RTU-1. 实测组 5-11.',
      },
      {
        code: 'GW-DALI-2',
        name: 'DALI 网关 #2',
        category: 'dali-gateway',
        vendor: '元创智控',
        model: 'CY-DALI64A',
        // 2026-07-16: 全馆只剩一层, 这台不再是"2F 那台". 跟 #1 同层、共用 RS485,
        // 靠拨码盘地址 (slaveId 1/2) 区分. 具体机柜位置现场核实.
        floor: '1F',
        location: '弱电机柜',
        addressing: JSON.stringify({ slaveId: 2, baud: 9600, frameIntervalMs: 200, groups: [1, 2, 3] }),
        remark: '拨码盘地址 2, 跟 #1 共用 CONV-RTU-1 RS485 串口. 实测组 1-3.',
      },
      // ==================== DALI 调光设备 (按《金湖照明灯具明细 v3》2026-05-21 重新选型) ====================
      // 方案 B: 灯带走 MEANWELL HLG 恒压 DALI 电源, 灯具走 0-10V (DALI 转换器 LT-84A)
      // 选型详见 docs/LIGHTING_FINAL_SELECTION.md
      // ---------- 灯带恒压 DALI 电源 (12 台 HLG + 1 台 HLG-600 灯箱) ----------
      {
        code: 'DRV-HLG-1', name: '1F F101-R1 前厅灯带电源', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 1, daliGroup: 1, output: 'DC 24V 480W', load: '300W', headroom: '38%' }),
        remark: '前厅灯带 30m / 300W, DALI 2.0 (480H 选型保 38% 余量)',
      },
      {
        code: 'DRV-HLG-2', name: '1F F101-R2 灯带电源', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-185H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 2, daliGroup: 4, output: 'DC 24V 185W' }),
        remark: '重点照明灯带 15m / 150W (同回路含筒灯, 独立 DALI 地址)',
      },
      {
        code: 'DRV-HLG-3', name: '1F F101-R3 灯带电源', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-150H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 3, daliGroup: 4, output: 'DC 24V 150W', load: '120W', headroom: '20%' }),
        remark: '园区展示灯带 12m / 120W (升 150H 留 20% 余量)',
      },
      {
        code: 'DRV-HLG-4', name: '1F F101-R4 走廊灯带电源 #1/3', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 4, daliGroup: 3, output: 'DC 24V 480W', parallelGroup: 'F101-R4' }),
        remark: '走廊 130m 灯带分 3 台并联中段注入, 同 Group 3 同步调光',
      },
      {
        code: 'DRV-HLG-5', name: '1F F101-R4 走廊灯带电源 #2/3', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '1F', location: '1F 走廊中段电箱',
        addressing: JSON.stringify({ daliShort: 5, daliGroup: 3, output: 'DC 24V 480W', parallelGroup: 'F101-R4' }),
        remark: '走廊 130m 灯带 #2, 中段 65m 处注入',
      },
      {
        code: 'DRV-HLG-6', name: '1F F101-R4 走廊灯带电源 #3/3', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '1F', location: '1F 走廊尾端电箱',
        addressing: JSON.stringify({ daliShort: 6, daliGroup: 3, output: 'DC 24V 480W', parallelGroup: 'F101-R4' }),
        remark: '走廊 130m 灯带 #3, 尾端注入',
      },
      {
        code: 'DRV-HLG-7', name: '1F F101-R7 灯带电源 #1/2', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 7, daliGroup: 4, output: 'DC 24V 480W', parallelGroup: 'F101-R7' }),
        remark: '重点照明灯带 80m / 800W 拆 2 台并联',
      },
      {
        code: 'DRV-HLG-8', name: '1F F101-R7 灯带电源 #2/2', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 8, daliGroup: 4, output: 'DC 24V 480W', parallelGroup: 'F101-R7' }),
        remark: '重点照明灯带 #2',
      },
      {
        code: 'DRV-HLG-9', name: '1F F102-R1 灯带电源', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-240H-24DA', floor: '1F', location: '1F 企业展位区电箱 F102',
        addressing: JSON.stringify({ daliShort: 9, daliGroup: 5, output: 'DC 24V 240W' }),
        remark: '企业展位灯带 20m / 200W',
      },
      {
        code: 'DRV-HLG-10', name: '1F F104-R1 灯带电源', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-240H-24DA', floor: '1F', location: '1F 物贸交易电箱 F104',
        addressing: JSON.stringify({ daliShort: 10, daliGroup: 7, output: 'DC 24V 240W' }),
        remark: '物贸交易展示区灯带 20m / 200W',
      },
      {
        code: 'DRV-HLG-11', name: '2F F201-R4 灯带电源 #1/2', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '2F', location: '2F 公共电箱 F201',
        addressing: JSON.stringify({ daliShort: 11, daliGroup: 8, output: 'DC 24V 480W', parallelGroup: 'F201-R4' }),
        remark: '2F 走廊灯带 85m / 900W 拆 2 台并联',
      },
      {
        code: 'DRV-HLG-12', name: '2F F201-R4 灯带电源 #2/2', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-480H-24DA', floor: '2F', location: '2F 公共电箱 F201',
        addressing: JSON.stringify({ daliShort: 12, daliGroup: 8, output: 'DC 24V 480W', parallelGroup: 'F201-R4' }),
        remark: '2F 走廊灯带 #2',
      },
      {
        code: 'DRV-HLG-13a', name: '1F F101-R3 灯箱电源 #1/2', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-320H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 13, daliGroup: 4, output: 'DC 24V 320W', parallelGroup: 'F101-R3-灯箱' }),
        remark: '灯箱 12㎡ / 600W 拆 2 台并联 (640W 总, 余 6%)',
      },
      {
        code: 'DRV-HLG-13b', name: '1F F101-R3 灯箱电源 #2/2', category: 'led-driver',
        vendor: 'MEANWELL 明纬', model: 'HLG-320H-24DA', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliShort: 14, daliGroup: 4, output: 'DC 24V 320W', parallelGroup: 'F101-R3-灯箱' }),
        remark: '灯箱 #2, 与 #1 并联同 Group 4 同步',
      },
      // ---------- DALI→0-10V 转换器 (3 台, 11 路 AC 220V 灯具调光) ----------
      {
        code: 'CONV-DA4V10-1', name: '1F DALI→0-10V 转换器 #1', category: 'dali-converter',
        vendor: 'LTECH 雷特', model: 'LT-84A', floor: '1F', location: '1F 公共电箱 F101',
        addressing: JSON.stringify({ daliStart: 15, daliCount: 4, mode: '4×0-10V' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 15, label: 'F101-R2 筒+射 (9+13)', powerW: 450, daliGroup: 4 },
          { ch: 2, daliShort: 16, label: 'F101-R3 筒灯 (14)', powerW: 880, daliGroup: 4 },
          { ch: 3, daliShort: 17, label: 'F101-R5 走廊筒+射 (29+10)', powerW: 800, daliGroup: 3 },
          { ch: 4, daliShort: 18, label: 'F101-R6 吸顶灯 (2)', powerW: 60, daliGroup: 3 },
        ]),
        remark: '灯具需 0-10V 调光款',
      },
      {
        code: 'CONV-DA4V10-2', name: '1F DALI→0-10V 转换器 #2', category: 'dali-converter',
        vendor: 'LTECH 雷特', model: 'LT-84A', floor: '1F', location: '1F 综合展销电箱 F103',
        addressing: JSON.stringify({ daliStart: 19, daliCount: 4, mode: '4×0-10V' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 19, label: 'F101-R7 格栅长条灯 35m', powerW: 700, daliGroup: 4 },
          { ch: 2, daliShort: 20, label: 'F103-R1 筒+射 (7+12)', powerW: 400, daliGroup: 6 },
          { ch: 3, daliShort: 21, label: 'F201-R1 筒灯 (30)', powerW: 600, daliGroup: 8 },
          { ch: 4, daliShort: 22, label: 'F201-R2 筒灯 (10)', powerW: 1200, daliGroup: 8 },
        ]),
        remark: '灯具需 0-10V 调光款',
      },
      {
        code: 'CONV-DA4V10-3', name: '2F DALI→0-10V 转换器 #3', category: 'dali-converter',
        vendor: 'LTECH 雷特', model: 'LT-84A', floor: '2F', location: '2F 公共电箱 F201',
        addressing: JSON.stringify({ daliStart: 23, daliCount: 4, mode: '4×0-10V' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 23, label: 'F201-R3 筒+射 (16+3)', powerW: 1000, daliGroup: 9 },
          { ch: 2, daliShort: 24, label: 'F202-R1 吸顶 (13)', powerW: 800, daliGroup: 10 },
          { ch: 3, daliShort: 25, label: 'F203-R1 吸顶 (16)', powerW: 1000, daliGroup: 11 },
          { ch: 4, daliShort: 26, label: 'F204-R1 吸顶 (15)', powerW: 900, daliGroup: 12 },
        ]),
        remark: '灯具需 0-10V 调光款',
      },
      // ---- LED 大屏 ----
      // V2460 是诺瓦 V 系列 2-in-1 控制器 (V960/V1060/V1260/V2460 同族),
      // 跟 VX 系列共用一份控制协议 (TCP 5200, 0x55 0xAA 帧头, 校验和=sum+0x5555).
      // 协议实现在 nova-vx1000-protocol.ts, 文件名沿用历史, 不再迁移.
      {
        code: 'LED-NOVA-1',
        name: '1F LED 大屏控制器',
        category: 'led-controller',
        vendor: '诺瓦 NovaStar',
        model: 'V2460',
        driverKind: 'nova-vx',
        ip: '192.168.50.30',
        floor: '1F',
        location: '1F 主控室机柜',
        addressing: JSON.stringify({ box: '1', port: 5200 }),
        remark: 'V 系列 2-in-1 控制器. HDMI1 输入接 GK9000 中控主机 HDMI 输出 (视频源直接来自中控主机)',
      },
      // 注: 原计划的"独立 LED 播控主机 (Intel NUC11)" 已取消
      // 视频文件和播放统一交给 GK9000 中控主机 (GK9000 有 2 个 HDMI 输出, HDMI1 → V2460)
      // 视频存储路径见 D:\smart-control\media\ 或自定义, ViPlex Express 跑在 GK9000 上
      // ---- LED 大屏远程总闸 (2026-07-22 装机联调) ----
      // 走的是 EpaBreakerAdapter: 它按 category='power-breaker' 找这一行读 ip + addressing,
      // 所以连接参数记在断路器这行上 (ip 填的是转换器 IP, 断路器本身在 485 那头没有 IP).
      {
        code: 'BREAKER-LED-1',
        name: 'LED 大屏远程总闸 (智能断路器)',
        category: 'power-breaker',
        vendor: 'ePa',
        model: '3P-40A 智能断路器',
        driverKind: 'epa-breaker',
        ip: '192.168.50.21',
        floor: '1F',
        location: '1F 大屏配电箱',
        // slaveId 是 255(0xFF) 不是 1 —— 出厂从机号, 现场扫 1..247 全部无应答
        addressing: JSON.stringify({ port: 502, slaveId: 255, baud: 115200, parity: 'N', stop: 1 }),
        remark:
          '19KW/三相 LED 大屏物理总闸, 485 标准 Modbus-RTU 经 CONV-RTU-2 接入. ' +
          '分合闸写寄存器 0x0101 (1合/2分), 计量读 0x0000 起 40 个寄存器. ' +
          '被控回路不含 GK9000 中控主机 (否则远程分闸=自锁死锁).',
      },
      {
        code: 'CONV-RTU-2',
        name: 'RS485 RTU↔TCP 转换器 #2 (空开专用)',
        category: 'rtu-tcp-converter',
        vendor: '有人 USR',
        model: 'USR-DR304-C7',
        driverKind: 'epa-breaker',
        ip: '192.168.50.21',
        floor: '1F',
        location: '1F 大屏配电箱',
        addressing: JSON.stringify({ port: 502, baud: 115200, parity: 'N', stop: 1, mode: 'TCP Server' }),
        remark:
          '专供智能断路器, **不能跟 CONV-RTU-1 共用**: 空开 115200, DALI 锁死 9600, 波特率冲突. ' +
          '工作方式 TCP Server / 本地端口 502 / 透传 (Modbus 网关功能关闭, 后端自己发 RTU 帧带 CRC). ' +
          'Web 配置 http://192.168.50.21 admin/admin. 出厂 IP 是 192.168.0.7, 2026-07-22 改到 50 网段.',
      },
      // ---- 音响 (得胜方案 2 + WTG-800 跟随讲解) ----
      // 协议参考: docs/AUDIO_PROTOCOL_EKX808.md
      // 实现: backend/src/adapters/audio/ekx808-protocol.ts (编解码就绪, 待联调)
      {
        code: 'AUDIO-DSP-1',
        name: '音响 DSP 处理器 (8×8 矩阵)',
        category: 'audio-dsp',
        vendor: '得胜 TAKSTAR',
        model: 'EKX-808',
        driverKind: 'ekx-808',
        ip: '192.168.50.61',
        floor: '1F',
        location: '1F 主控室机柜',
        addressing: JSON.stringify({
          devAddr: 1,
          tcpPort: null,             // 厂家固件默认 IP/端口, 现场标定
          inputs: 8,
          outputs: 8,
          presets: { factory: 13, user: 12 },
        }),
        remark: '32位DSP/96kHz · 以太网 TCP 控制 · 8 路 In + 8 路 Out 任意矩阵 · 4 群组 · F00-F12 + U01-U12 预设',
      },
      {
        code: 'AUDIO-WTG-1',
        name: '智能分区导览 (跟随讲解员)',
        category: 'audio-guide',
        vendor: '得胜 TAKSTAR',
        model: 'WTG-800 (1T + 8R)',
        floor: '1F-2F',
        location: '8 个分区天花/墙面',
        addressing: JSON.stringify({
          transmitter: 1,
          receivers: 8,
          channels: 23,
          rangePerZone: '0.5-18m (0-9 档功率)',
          builtInAmp: '60W per receiver',
        }),
        remark: 'UHF 数字加密, RSSI 自动连接, 接收器内置 60W 数字功放可直推喇叭',
      },
      {
        code: 'AUDIO-PWR-SEQ-1',
        name: '音响电源时序器',
        category: 'audio-power',
        vendor: '得胜 TAKSTAR',
        model: 'EPO-802P',
        floor: '1F',
        location: '1F 主控室机柜',
        addressing: JSON.stringify({ channels: 8, control: 'RS232/485' }),
        remark: '8 路时序上电, 保护功放设备 · 支持 RS232/485 远程通断',
      },
      // ---- 空调 ----
      {
        code: 'HVAC-ODU-1F',
        name: '1F 中央空调外机 (商用 VRF)',
        category: 'hvac-outdoor',
        vendor: '奥克斯',
        model: 'DLR-785W5/DCM-ARVX9',
        floor: '1F',
        location: '楼顶设备平台',
        addressing: JSON.stringify({ capacityKw: 35.5, currentA: 57, series: 'ARV-X9', subType: '超低温全直流变频' }),
        remark: '一层专用外机, 制冷量 35.5kW, 57A, R410A, 带 10 台内机 (indoorIdx 1-10)',
      },
      {
        code: 'HVAC-ODU-2F',
        name: '2F 中央空调外机 (商用 VRF)',
        category: 'hvac-outdoor',
        vendor: '奥克斯',
        model: 'DLR-1015W5/DCM-ARVX9',
        floor: '2F',
        location: '楼顶设备平台',
        addressing: JSON.stringify({ capacityKw: 40.8, currentA: 64, series: 'ARV-X9', subType: '超低温全直流变频' }),
        remark: '二层专用外机, 制冷量 40.8kW, 64A, R410A, 带 12 台内机 (indoorIdx 11-22)',
      },
      {
        code: 'HVAC-GW-1F',
        name: '1F 中央空调通讯网关 (TCP)',
        category: 'hvac-gateway',
        vendor: '中弘 ZHONGHONG',
        model: 'B 集控网关 TCP 款',
        driverKind: 'zhonghong-mbt',
        ip: '192.168.50.66',
        floor: '1F',
        location: '1F 弱电机柜',
        addressing: JSON.stringify({ slaveId: 1, port: 502, maxIndoor: 64, protocol: 'MODBUS-TCP (MBT v3.2)', auxBrandCode: 15 }),
        remark: '直接接交换机 (RJ45 + Modbus TCP), 不需要 USR-TCP232. 挂 1F 外机, 10 内机 (n=1..10). 单价 ~¥1,200',
      },
      {
        code: 'HVAC-GW-2F',
        name: '2F 中央空调通讯网关 (TCP)',
        category: 'hvac-gateway',
        vendor: '中弘 ZHONGHONG',
        model: 'B 集控网关 TCP 款',
        driverKind: 'zhonghong-mbt',
        ip: '192.168.50.67',
        floor: '2F',
        location: '2F 公共电箱 F201 或 1F 主控室 (二选一, XYE 总线就近)',
        addressing: JSON.stringify({ slaveId: 1, port: 502, maxIndoor: 64, protocol: 'MODBUS-TCP (MBT v3.2)', auxBrandCode: 15 }),
        remark: '挂 2F 外机, 12 内机 (n=1..12). 跟 1F 网关同型号, 不同 IP',
      },
      // ---- 控制平板 ----
      {
        code: 'TABLET-1F',
        name: '1F 控制平板',
        category: 'tablet',
        vendor: '通用',
        model: 'iPad Pro 12.9 / Android 平板',
        floor: '1F',
        location: '1F 前厅控制台',
        remark: 'PWA 网址 https://cnjinhu.top/control/ 添加到主屏',
      },
    ];

    for (const h of HARDWARE) {
      const exists = await this.hwRepo.findOne({ where: { code: h.code } });
      if (exists) continue;
      const entity = this.hwRepo.create({
        code: h.code,
        name: h.name,
        category: h.category,
        vendor: h.vendor,
        model: h.model,
        driverKind: h.driverKind ?? null,
        serialNo: null,
        firmwareVersion: null,
        location: h.location ?? null,
        floor: h.floor ?? null,
        ip: h.ip ?? null,
        macAddress: null,
        addressing: h.addressing ?? null,
        channels: h.channels ?? null,
        status: 'normal',
        enabled: true,
        remark: h.remark ?? null,
        installedAt: null,
      });
      await this.hwRepo.save(entity);
      this.logger.info(`Seeded hardware: ${h.code} (${h.vendor} ${h.model})`, {
        context: 'SeedService',
      });
    }

    // ---------- 一次性自愈: 修正旧的硬件 IP ----------
    // 之前 CONV-RTU-1 seed 错写成 USR 出厂默认 192.168.0.7. 现场实际 IP 是 192.168.50.20
    // (跟 .env / 文档 / nginx 一致). 由于上面 seed 逻辑遇到已存在记录就跳过, 旧 DB 不会被更新.
    // 这段强制把错值改回正确值, 只动这一个特定字段 + 特定错值, 不影响其他人工调整.
    const HW_IP_FIXES: Array<{ code: string; oldIp: string; newIp: string }> = [
      { code: 'CONV-RTU-1', oldIp: '192.168.0.7', newIp: '192.168.50.20' },
    ];
    for (const fix of HW_IP_FIXES) {
      const row = await this.hwRepo.findOne({ where: { code: fix.code } });
      if (row && row.ip === fix.oldIp) {
        row.ip = fix.newIp;
        await this.hwRepo.save(row);
        this.logger.info(`Hardware IP fix: ${fix.code} ${fix.oldIp} → ${fix.newIp}`, {
          context: 'SeedService',
        });
      }
    }

    // ---------- 一次性自愈: 修正旧的硬件型号 ----------
    // LED-NOVA-1 现场换了 V2460 (同 V/VX 协议族, adapter 兼容). 旧 DB 还是 VX1000.
    const HW_MODEL_FIXES: Array<{ code: string; oldModel: string; newModel: string }> = [
      { code: 'LED-NOVA-1', oldModel: 'VX1000', newModel: 'V2460' },
    ];
    for (const fix of HW_MODEL_FIXES) {
      const row = await this.hwRepo.findOne({ where: { code: fix.code } });
      if (row && row.model === fix.oldModel) {
        row.model = fix.newModel;
        await this.hwRepo.save(row);
        this.logger.info(`Hardware model fix: ${fix.code} ${fix.oldModel} → ${fix.newModel}`, {
          context: 'SeedService',
        });
      }
    }

    // ---------- 一次性自愈: 回填 driverKind (P3) ----------
    // driverKind 是 P3 才加的列, 旧 DB 行没有这个字段. 给已知 code 回填.
    const HW_DRIVER_FIXES: Array<{ code: string; driverKind: string }> = [
      { code: 'CONV-RTU-1', driverKind: 'cy-dali64a' },
      { code: 'LED-NOVA-1', driverKind: 'nova-vx' },
      { code: 'AUDIO-DSP-1', driverKind: 'ekx-808' },
      { code: 'HVAC-GW-1F', driverKind: 'zhonghong-mbt' },
      { code: 'HVAC-GW-2F', driverKind: 'zhonghong-mbt' },
    ];
    for (const fix of HW_DRIVER_FIXES) {
      const row = await this.hwRepo.findOne({ where: { code: fix.code } });
      if (row && !row.driverKind) {
        row.driverKind = fix.driverKind;
        await this.hwRepo.save(row);
        this.logger.info(`Hardware driver backfill: ${fix.code} → ${fix.driverKind}`, {
          context: 'SeedService',
        });
      }
    }

    // ---------- 一次性自愈: 回填 DALI 网关 addressing.groups (2026-05-30) ----------
    // 2 台 DALI 网关后, addressing.groups 字段决定 group → slaveId 路由.
    // 旧 GW-DALI-1 没 groups 字段, 给它补上 1-7. (GW-DALI-2 是新 seed, 不用补)
    const DALI_GROUP_FIXES: Array<{ code: string; groups: number[] }> = [
      { code: 'GW-DALI-1', groups: [1, 2, 3, 4, 5, 6, 7] },
      { code: 'GW-DALI-2', groups: [8, 9, 10, 11, 12] },
    ];
    for (const fix of DALI_GROUP_FIXES) {
      const row = await this.hwRepo.findOne({ where: { code: fix.code } });
      if (!row || !row.addressing) continue;
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(row.addressing) as Record<string, unknown>; } catch { continue; }
      if (Array.isArray(parsed.groups) && parsed.groups.length > 0) continue;
      parsed.groups = fix.groups;
      row.addressing = JSON.stringify(parsed);
      await this.hwRepo.save(row);
      this.logger.info(`DALI gateway groups backfill: ${fix.code} → [${fix.groups.join(',')}]`, {
        context: 'SeedService',
      });
    }
  }
}
