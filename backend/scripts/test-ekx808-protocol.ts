/**
 * EKX-808 协议编解码器 e2e 测试 (不需要真实设备)
 *
 * 用途:
 *   1. 验证 dB ↔ 码值换算对称性
 *   2. 验证 12 个用户预设的命令字节正确
 *   3. 验证矩阵路由命令格式
 *   4. 对比官方手册范例报文 (回归测试)
 *
 * 运行: cd backend && npx ts-node -r tsconfig-paths/register scripts/test-ekx808-protocol.ts
 */
import {
  buildFrame,
  parseFrame,
  dbToCode,
  codeToDb,
  cmdRecallUserPreset,
  cmdRecallFactoryPreset,
  cmdSetInputVolume,
  cmdSetOutputVolume,
  cmdMute,
  cmdReadPreset,
  cmdReadGain,
  cmdSetMatrix,
  cmdGroupVolume,
  cmdAuxSwitch,
  cmdReadLevel,
  cmdReadFullMatrix,
  AUX_SW,
  IO_IN,
  IO_OUT,
} from '../src/adapters/audio/ekx808-protocol';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertEq<T>(name: string, actual: T, expected: T): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    const msg = `  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
}

function hex(buf: Buffer): string {
  return Array.from(buf).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function assertHex(name: string, actual: Buffer, expectedHex: string): void {
  const cleaned = expectedHex.replace(/\s+/g, '').toUpperCase();
  const actualHex = hex(actual).replace(/\s+/g, '');
  if (actualHex === cleaned) {
    passed++;
    console.log(`  ✓ ${name}  =>  ${hex(actual)}`);
  } else {
    failed++;
    const msg = `  ✗ ${name}\n      expected: ${cleaned.match(/.{2}/g)?.join(' ')}\n      actual:   ${hex(actual)}`;
    failures.push(msg);
    console.log(msg);
  }
}

// ============ 测试 1: 帧边界 ============
console.log('\n[1] 帧边界 + 基础构造');
{
  const f = buildFrame(1, 0x40, 0x01, 0x02, 0x00);
  assertHex('构造帧 (devAddr=1, cmd=0x40, U02)', f, '7B 7D 01 40 01 02 00 7D 7B');
  assertEq('帧长度 = 9', f.length, 9);
  assertEq('包头 = 0x7B 0x7D', [f[0], f[1]], [0x7b, 0x7d]);
  assertEq('包尾 = 0x7D 0x7B', [f[7], f[8]], [0x7d, 0x7b]);

  try {
    buildFrame(0, 0x40);
    failed++; failures.push('  ✗ 应拒绝 devAddr=0');
    console.log('  ✗ 应拒绝 devAddr=0');
  } catch {
    passed++;
    console.log('  ✓ 正确拒绝 devAddr=0');
  }

  try {
    buildFrame(255, 0x40);
    failed++; failures.push('  ✗ 应拒绝 devAddr=255');
    console.log('  ✗ 应拒绝 devAddr=255');
  } catch {
    passed++;
    console.log('  ✓ 正确拒绝 devAddr=255');
  }
}

// ============ 测试 2: dB ↔ 码值换算 ============
console.log('\n[2] dB ↔ 码值换算 (三段分段)');
{
  // 关键点
  assertEq('+0.0dB → code 280', dbToCode(0).hi * 256 + dbToCode(0).lo, 280);
  assertEq('-3.0dB → code 250', dbToCode(-3).hi * 256 + dbToCode(-3).lo, 250);
  assertEq('-20.0dB → code 80', dbToCode(-20).hi * 256 + dbToCode(-20).lo, 80);
  assertEq('-60.0dB → code 0', dbToCode(-60).hi * 256 + dbToCode(-60).lo, 0);
  assertEq('+12.0dB → code 400', dbToCode(12).hi * 256 + dbToCode(12).lo, 400);

  // 双向对称性
  const samples = [-60, -40, -20, -10, -3, 0, 6, 12];
  for (const db of samples) {
    const { hi, lo } = dbToCode(db);
    const back = codeToDb(hi, lo);
    const diff = Math.abs(back - db);
    if (diff > 0.5) {
      failed++;
      const msg = `  ✗ ${db}dB → 0x${hi.toString(16)}${lo.toString(16).padStart(2,'0')} → ${back}dB (差 ${diff})`;
      failures.push(msg); console.log(msg);
    } else {
      passed++;
      console.log(`  ✓ ${db}dB 双向换算误差 ${diff.toFixed(2)}dB`);
    }
  }
}

// ============ 测试 3: 官方手册范例报文 ============
console.log('\n[3] 官方手册范例报文 (回归)');
{
  // 范例: 调用用户预设 U02 → 7B7D01400102007D7B
  assertHex('调用预设 U02',
    cmdRecallUserPreset(1, 2),
    '7B 7D 01 43 01 02 00 7D 7B');
  // 范例: 调用预设矩阵 U02 (0x40)
  assertHex('调用预设矩阵 U02 (手工构造对比)',
    buildFrame(1, 0x40, 0x01, 0x02, 0x00),
    '7B 7D 01 40 01 02 00 7D 7B');
  // 范例: 不静音 Out1 → 7B7D01420100007D7B (channel=0, no=0)
  assertHex('Out0 解除静音',
    cmdMute(1, IO_OUT, 0, false),
    '7B 7D 01 42 01 00 00 7D 7B');
  // 范例: In1 音量 +0.0dB → 7B7D01440001187D7B (channel=0, code=0x118=280)
  assertHex('In0 音量设 0.0dB',
    cmdSetInputVolume(1, 0, 0),
    '7B 7D 01 44 00 01 18 7D 7B');
  // 范例: Out2 音量 -3.0dB → 7B7D0145 01 00 FA 7D7B (channel=1, code=0x00FA=250)
  assertHex('Out1 音量设 -3.0dB',
    cmdSetOutputVolume(1, 1, -3),
    '7B 7D 01 45 01 00 FA 7D 7B');
  // 范例: 读取 In1 音量 → 7B7D01480000007D7B
  assertHex('读取 In0 增益',
    cmdReadGain(1, IO_IN, 0),
    '7B 7D 01 48 00 00 00 7D 7B');
  // 范例: 读取当前预设 → 7B7D014A0000007D7B (D1=0x30 per手册, 但 D1 可为 0)
  // 这里我们按 §4.10 写的 D1=0x30
  assertHex('读取当前预设号',
    cmdReadPreset(1),
    '7B 7D 01 4A 30 00 00 7D 7B');
  // 范例: Out4 矩阵 In2 开 → 7B7D014E0301017D7B
  assertHex('Out3 ← In1 矩阵开',
    cmdSetMatrix(1, 3, 1, true),
    '7B 7D 01 4E 03 01 01 7D 7B');
  // 范例: 输入编组 90% → 7B7D0146005A007D7B
  assertHex('输入编组音量 90%',
    cmdGroupVolume(1, IO_IN, 90),
    '7B 7D 01 46 00 5A 00 7D 7B');
  // 范例: AUX 效果开 → 7B7D01552002017D7B
  //   按手册 0x55 D1=0x02, D2=Select(0=效果), D3=On/Off(1)
  assertHex('AUX 效果器开',
    cmdAuxSwitch(1, AUX_SW.EFFECT, true),
    '7B 7D 01 55 02 00 01 7D 7B');
  assertHex('AUX 摄像头跟踪开',
    cmdAuxSwitch(1, AUX_SW.CAMERA, true),
    '7B 7D 01 55 02 01 01 7D 7B');
  assertHex('AUX 自动混音开',
    cmdAuxSwitch(1, AUX_SW.AUTO_MIX, true),
    '7B 7D 01 55 02 02 01 7D 7B');
  assertHex('AUX AEC 回声消除开',
    cmdAuxSwitch(1, AUX_SW.AEC, true),
    '7B 7D 01 55 02 03 01 7D 7B');
  assertHex('AUX NR 降噪开',
    cmdAuxSwitch(1, AUX_SW.NR, true),
    '7B 7D 01 55 02 04 01 7D 7B');
  // 范例: 读取 In1 电平 → 7B7D014D0000007D7B
  assertHex('读 In0 实时电平',
    cmdReadLevel(1, 0, 0),
    '7B 7D 01 4D 00 00 00 7D 7B');
  // 读取全矩阵
  assertHex('读全矩阵',
    cmdReadFullMatrix(1),
    '7B 7D 01 61 00 00 00 7D 7B');
}

// ============ 测试 4: U01-U12 全部预设可生成 ============
console.log('\n[4] U01-U12 12 个用户预设命令生成');
for (let i = 1; i <= 12; i++) {
  const buf = cmdRecallUserPreset(1, i);
  if (buf[3] !== 0x43 || buf[4] !== 0x01 || buf[5] !== i) {
    failed++;
    const msg = `  ✗ U${i}: ${hex(buf)} (CMD/Type/Preset 不对)`;
    failures.push(msg); console.log(msg);
  } else {
    passed++;
    console.log(`  ✓ U${String(i).padStart(2,'0')}: ${hex(buf)}`);
  }
}

// ============ 测试 5: 边界 / 错误处理 ============
console.log('\n[5] 边界条件');
{
  try {
    cmdRecallUserPreset(1, 13);
    failed++; failures.push('  ✗ 应拒绝 preset=13');
    console.log('  ✗ 应拒绝 preset=13');
  } catch {
    passed++;
    console.log('  ✓ 正确拒绝 preset=13');
  }
  try {
    cmdRecallFactoryPreset(1, -1);
    failed++; failures.push('  ✗ 应拒绝 preset=-1');
    console.log('  ✗ 应拒绝 preset=-1');
  } catch {
    passed++;
    console.log('  ✓ 正确拒绝 preset=-1');
  }
}

// ============ 测试 6: 响应帧解析 ============
console.log('\n[6] 响应帧解析');
{
  // 模拟 DSP 返回 "当前是 U03"
  const resp = Buffer.from([0x7b, 0x7d, 0x01, 0x4a, 0x03, 0x00, 0x00, 0x7d, 0x7b]);
  const parsed = parseFrame(resp);
  assertEq('解析帧 devAddr', parsed?.devAddr, 1);
  assertEq('解析帧 cmd', parsed?.cmd, 0x4a);
  assertEq('payload[0] = preset 03', parsed?.payload[0], 3);

  // 错误帧 (包头错)
  const bad = Buffer.from([0x00, 0x7d, 0x01, 0x4a, 0x03, 0x00, 0x00, 0x7d, 0x7b]);
  assertEq('错帧应返回 null', parseFrame(bad), null);

  // 太短
  assertEq('短帧应返回 null', parseFrame(Buffer.from([0x7b, 0x7d, 0x01])), null);
}

// ============ 总结 ============
console.log('\n' + '='.repeat(50));
console.log(`✓ 通过: ${passed}    ✗ 失败: ${failed}`);
if (failed > 0) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
console.log('🎉 全部通过. EKX-808 协议层就绪.');
