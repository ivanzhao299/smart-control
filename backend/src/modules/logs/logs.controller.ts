import { Controller, Get, Query } from '@nestjs/common';
import { OperationLogService } from './operation-log.service';
import { AlertService } from '../alerts/alert.service';
import { QueryLogDto } from './dto/query-log.dto';

@Controller('logs')
export class LogsController {
  constructor(
    private readonly service: OperationLogService,
    private readonly alertService: AlertService,
  ) {}

  @Get()
  async list(@Query() query: QueryLogDto) {
    const data = await this.service.findAll(query);
    return { message: '查询成功', data };
  }

  /** Sprint-08: 今日运行汇总 */
  @Get('summary')
  async summary() {
    const [logs, alerts] = await Promise.all([
      this.service.todaySummary(),
      this.alertService.summary(),
    ]);
    return {
      message: '查询成功',
      data: {
        operations: logs.operations,
        sceneExecutions: logs.sceneExecutions,
        sceneFailures: logs.sceneFailures,
        deviceOffline: logs.deviceOffline,
        alerts: {
          active: alerts.active,
          last24h: alerts.last24h,
          byLevel: alerts.byLevel,
        },
        rangeStart: logs.rangeStart,
        rangeEnd: logs.rangeEnd,
      },
    };
  }
}
