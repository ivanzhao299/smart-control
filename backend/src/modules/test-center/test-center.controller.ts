import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { TestCenterService } from './test-center.service';
import {
  DeviceTestDto,
  PingTestDto,
  PortTestDto,
  QueryTestLogDto,
  SceneTestDto,
  SubsystemTestDto,
  TestReportDto,
} from './dto/test.dto';

@Controller('test')
export class TestCenterController {
  constructor(private readonly service: TestCenterService) {}

  @Post('device/:deviceId')
  async device(@Param('deviceId') deviceId: string, @Body() dto: DeviceTestDto) {
    const data = await this.service.testDevice(deviceId, dto.command, dto.params ?? {});
    return { message: '测试完成', data };
  }

  @Post('subsystem/:type')
  async subsystem(@Param('type') type: string, @Body() dto: SubsystemTestDto) {
    const data = await this.service.testSubsystem(type, dto.command, dto.params ?? {});
    return { message: '子系统测试完成', data };
  }

  @Post('scene/:sceneCode')
  async scene(@Param('sceneCode') code: string, @Body() dto: SceneTestDto) {
    const data = await this.service.testScene(code, dto.dryRun ?? false);
    return { message: '场景测试完成', data };
  }

  @Post('network/ping')
  async ping(@Body() dto: PingTestDto) {
    const data = await this.service.ping(dto.ip, dto.timeoutMs ?? 2000);
    return { message: '网络测试完成', data };
  }

  @Post('network/port')
  async port(@Body() dto: PortTestDto) {
    const data = await this.service.portCheck(dto.ip, dto.port, dto.timeoutMs ?? 2000);
    return { message: '端口测试完成', data };
  }

  /**
   * 查看主机当前 ARP 缓存 (`arp -a`) — 业主反馈"网线同交换机但 ping 不通",
   * 设备 IP 可能配错网段, 同 broadcast domain 内 ARP 一定能看到. 列表带 MAC,
   * 接手用厂家 MAC OUI 反查能定位设备种类.
   *
   * 跨平台:
   *   - Windows: `arp -a`  → "  192.168.124.1   00-aa-bb-..." 行
   *   - Linux/macOS: `arp -an` → "? (192.168.x.x) at ab:cd:..."
   */
  @Get('network/arp')
  async arp() {
    const data = await this.service.arpTable();
    return { message: 'ARP 表查询完成', data };
  }

  @Get('logs')
  async listLogs(@Query() q: QueryTestLogDto) {
    const data = await this.service.findLogs(q);
    return { message: '查询成功', data };
  }

  @Get('logs/:id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findLog(id);
    return { message: '查询成功', data };
  }

  @Post('report')
  async report(@Body() dto: TestReportDto) {
    const data = await this.service.report(dto);
    return { message: '报告生成完成', data };
  }

  @Get('checklist')
  async checklist() {
    const data = await this.service.checklist();
    return { message: '联调清单', data };
  }
}
