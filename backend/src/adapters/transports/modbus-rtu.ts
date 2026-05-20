import { DeviceProtocolError } from '../errors';
import { TcpClient } from './tcp-client';

/**
 * Modbus RTU 客户端 (短连接, 一问一答), 走 RTU-over-TCP 转换器 (USR-TCP232 / Moxa MGate 等)
 *
 * 帧格式: [slaveId 1B] [funcCode 1B] [PDU N B] [CRC16 LSB-first 2B]
 *
 * 支持: FC 0x03 / 0x06 / 0x10
 *
 * 与 ModbusTcpClient 区别:
 * - 没有 MBAP header (Tx/Proto/Length)
 * - 帧尾必须有 CRC16 (poly 0xA001, init 0xFFFF, byte order LSB-first)
 * - 多个请求之间必须有 ≥150ms 间隔 (CY-DALI64A 文档要求)
 */
export class ModbusRtuClient {
  private lastTxAt = 0;

  constructor(
    private readonly tcp: TcpClient,
    private readonly defaultSlaveId: number = 1,
    /** 帧间隔 ms (CY-DALI64A 文档要求 ≥150ms) */
    private readonly frameIntervalMs: number = 200,
  ) {}

  /** CRC16 Modbus: poly=0xA001, init=0xFFFF, 输出 LSB-first (低字节在前) */
  static crc16(buf: Buffer): Buffer {
    let crc = 0xffff;
    for (let i = 0; i < buf.length; i += 1) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j += 1) {
        if (crc & 0x0001) crc = (crc >>> 1) ^ 0xa001;
        else crc >>>= 1;
      }
    }
    const out = Buffer.alloc(2);
    out.writeUInt8(crc & 0xff, 0);
    out.writeUInt8((crc >>> 8) & 0xff, 1);
    return out;
  }

  private async respectFrameInterval(): Promise<void> {
    const since = Date.now() - this.lastTxAt;
    if (since < this.frameIntervalMs) {
      await new Promise((r) => setTimeout(r, this.frameIntervalMs - since));
    }
  }

  private finalizeFrame(pdu: Buffer): Buffer {
    return Buffer.concat([pdu, ModbusRtuClient.crc16(pdu)]);
  }

  private verifyResponse(resp: Buffer, slaveId: number, expectedFunc: number): Buffer {
    if (resp.length < 4) {
      throw new DeviceProtocolError('modbus-rtu', `response too short: ${resp.length}B`);
    }
    const payload = resp.subarray(0, resp.length - 2);
    const crcGot = resp.subarray(resp.length - 2);
    const crcCalc = ModbusRtuClient.crc16(payload);
    if (!crcGot.equals(crcCalc)) {
      throw new DeviceProtocolError(
        'modbus-rtu',
        `crc mismatch: got ${crcGot.toString('hex')}, want ${crcCalc.toString('hex')}`,
      );
    }
    const respSlave = resp.readUInt8(0);
    if (respSlave !== slaveId) {
      throw new DeviceProtocolError('modbus-rtu', `slaveId mismatch: ${respSlave} vs ${slaveId}`);
    }
    const func = resp.readUInt8(1);
    if (func === (expectedFunc | 0x80)) {
      const ex = resp.readUInt8(2);
      throw new DeviceProtocolError('modbus-rtu', `slave exception code 0x${ex.toString(16)}`);
    }
    if (func !== expectedFunc) {
      throw new DeviceProtocolError('modbus-rtu', `func code mismatch: 0x${func.toString(16)}`);
    }
    return payload;
  }

  /** FC 0x03: 读保持寄存器, 返回 16-bit 值数组 */
  async readHoldingRegisters(
    address: number,
    quantity: number,
    slaveId = this.defaultSlaveId,
    signal?: AbortSignal,
  ): Promise<number[]> {
    if (quantity < 1 || quantity > 125) {
      throw new DeviceProtocolError('modbus-rtu', `invalid quantity: ${quantity}`);
    }
    await this.respectFrameInterval();
    const pdu = Buffer.alloc(6);
    pdu.writeUInt8(slaveId, 0);
    pdu.writeUInt8(0x03, 1);
    pdu.writeUInt16BE(address, 2);
    pdu.writeUInt16BE(quantity, 4);
    const frame = this.finalizeFrame(pdu);
    const expectBytes = 5 + quantity * 2; // slave + func + bc + data + crc
    const resp = await this.tcp.sendAndExpect(frame, expectBytes, signal);
    this.lastTxAt = Date.now();
    const payload = this.verifyResponse(resp, slaveId, 0x03);
    const byteCount = payload.readUInt8(2);
    if (byteCount !== quantity * 2) {
      throw new DeviceProtocolError('modbus-rtu', `byte count mismatch: ${byteCount}`);
    }
    const values: number[] = [];
    for (let i = 0; i < quantity; i += 1) {
      values.push(payload.readUInt16BE(3 + i * 2));
    }
    return values;
  }

  /** FC 0x06: 写单个寄存器 */
  async writeSingleRegister(
    address: number,
    value: number,
    slaveId = this.defaultSlaveId,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.respectFrameInterval();
    const pdu = Buffer.alloc(6);
    pdu.writeUInt8(slaveId, 0);
    pdu.writeUInt8(0x06, 1);
    pdu.writeUInt16BE(address, 2);
    pdu.writeUInt16BE(value & 0xffff, 4);
    const frame = this.finalizeFrame(pdu);
    const resp = await this.tcp.sendAndExpect(frame, 8, signal);
    this.lastTxAt = Date.now();
    const payload = this.verifyResponse(resp, slaveId, 0x06);
    const echoAddr = payload.readUInt16BE(2);
    const echoVal = payload.readUInt16BE(4);
    if (echoAddr !== address || echoVal !== (value & 0xffff)) {
      throw new DeviceProtocolError('modbus-rtu', `echo mismatch addr=${echoAddr} val=${echoVal}`);
    }
  }

  /** FC 0x10: 写多个寄存器 */
  async writeMultipleRegisters(
    address: number,
    values: number[],
    slaveId = this.defaultSlaveId,
    signal?: AbortSignal,
  ): Promise<void> {
    if (values.length < 1 || values.length > 123) {
      throw new DeviceProtocolError('modbus-rtu', `invalid count: ${values.length}`);
    }
    await this.respectFrameInterval();
    const byteCount = values.length * 2;
    const pdu = Buffer.alloc(7 + byteCount);
    pdu.writeUInt8(slaveId, 0);
    pdu.writeUInt8(0x10, 1);
    pdu.writeUInt16BE(address, 2);
    pdu.writeUInt16BE(values.length, 4);
    pdu.writeUInt8(byteCount, 6);
    for (let i = 0; i < values.length; i += 1) {
      pdu.writeUInt16BE(values[i] & 0xffff, 7 + i * 2);
    }
    const frame = this.finalizeFrame(pdu);
    const resp = await this.tcp.sendAndExpect(frame, 8, signal);
    this.lastTxAt = Date.now();
    const payload = this.verifyResponse(resp, slaveId, 0x10);
    const echoAddr = payload.readUInt16BE(2);
    const echoQty = payload.readUInt16BE(4);
    if (echoAddr !== address || echoQty !== values.length) {
      throw new DeviceProtocolError('modbus-rtu', `echo mismatch addr=${echoAddr} qty=${echoQty}`);
    }
  }
}
