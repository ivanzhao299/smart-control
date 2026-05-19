import { DeviceProtocolError } from '../errors';
import { TcpClient } from './tcp-client';

/**
 * 最小 Modbus TCP 客户端 (短连接, 一问一答)
 * 支持: FC 0x03 (Read Holding Registers), FC 0x06 (Write Single Register)
 *
 * MBAP Header:
 *   [Tx ID 2B][Proto 0 2B][Length 2B][Unit 1B] + PDU
 */
export class ModbusTcpClient {
  private txId = 0;

  constructor(
    private readonly tcp: TcpClient,
    private readonly defaultUnit: number = 1,
  ) {}

  private nextTxId(): number {
    this.txId = (this.txId + 1) & 0xffff;
    return this.txId || 1;
  }

  private buildHeader(length: number, unit: number, tx: number): Buffer {
    const b = Buffer.alloc(7);
    b.writeUInt16BE(tx, 0);
    b.writeUInt16BE(0, 2);
    b.writeUInt16BE(length + 1, 4);
    b.writeUInt8(unit, 6);
    return b;
  }

  async readHoldingRegisters(
    address: number,
    quantity: number,
    unit = this.defaultUnit,
    signal?: AbortSignal,
  ): Promise<number[]> {
    if (quantity < 1 || quantity > 125) {
      throw new DeviceProtocolError('modbus', `invalid quantity: ${quantity}`);
    }
    const tx = this.nextTxId();
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x03, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(quantity, 3);

    const frame = Buffer.concat([this.buildHeader(pdu.length, unit, tx), pdu]);
    const expectBytes = 9 + quantity * 2;
    const resp = await this.tcp.sendAndExpect(frame, expectBytes, signal);
    this.assertTx(resp, tx);
    this.assertFunc(resp, 0x03, unit);

    const byteCount = resp.readUInt8(8);
    if (byteCount !== quantity * 2) {
      throw new DeviceProtocolError('modbus', `byte count mismatch: ${byteCount}`);
    }
    const values: number[] = [];
    for (let i = 0; i < quantity; i += 1) {
      values.push(resp.readUInt16BE(9 + i * 2));
    }
    return values;
  }

  async writeSingleRegister(
    address: number,
    value: number,
    unit = this.defaultUnit,
    signal?: AbortSignal,
  ): Promise<void> {
    const tx = this.nextTxId();
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x06, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(value & 0xffff, 3);

    const frame = Buffer.concat([this.buildHeader(pdu.length, unit, tx), pdu]);
    const resp = await this.tcp.sendAndExpect(frame, 12, signal);
    this.assertTx(resp, tx);
    this.assertFunc(resp, 0x06, unit);

    const echoAddr = resp.readUInt16BE(8);
    const echoVal = resp.readUInt16BE(10);
    if (echoAddr !== address || echoVal !== (value & 0xffff)) {
      throw new DeviceProtocolError('modbus', `write echo mismatch: ${echoAddr}=${echoVal}`);
    }
  }

  private assertTx(resp: Buffer, expectedTx: number): void {
    const tx = resp.readUInt16BE(0);
    if (tx !== expectedTx) {
      throw new DeviceProtocolError('modbus', `tx id mismatch: got ${tx}, expected ${expectedTx}`);
    }
  }

  private assertFunc(resp: Buffer, expectedFunc: number, unit: number): void {
    const respUnit = resp.readUInt8(6);
    const func = resp.readUInt8(7);
    if (respUnit !== unit) {
      throw new DeviceProtocolError('modbus', `unit id mismatch: ${respUnit}`);
    }
    if (func === (expectedFunc | 0x80)) {
      const code = resp.length > 8 ? resp.readUInt8(8) : 0;
      throw new DeviceProtocolError('modbus', `slave exception code 0x${code.toString(16)}`);
    }
    if (func !== expectedFunc) {
      throw new DeviceProtocolError('modbus', `func code mismatch: 0x${func.toString(16)}`);
    }
  }
}
