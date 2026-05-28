import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CyDali64aAdapter } from '../../adapters/lighting/cy-dali64a.adapter';
import { NovaLedAdapter } from '../../adapters/led/nova-led.adapter';
import { EkxDspAdapter } from '../../adapters/audio/ekx808.adapter';
import { ModbusHvacAdapter } from '../../adapters/hvac/modbus-hvac.adapter';
import { HardwareService } from './hardware.service';
import { CreateHardwareDto, QueryHardwareDto, UpdateHardwareDto } from './dto/hardware.dto';

/**
 * hardware_unit 编辑成功后 → 通知对应 adapter 清 DB 缓存 → 下次 IO 用新 IP/端口
 * 这张表把 code / category 映射到要清缓存的 adapter 实例.
 * P3 之后会用 driver_template kind 来路由, 不再写死 code/category.
 */
type AdapterCacheTarget = { codes: string[]; categories: string[]; adapter: { invalidateConfigCache(): void } };

@Controller('hardware')
export class HardwareController {
  private readonly adapterTargets: AdapterCacheTarget[];

  constructor(
    private readonly service: HardwareService,
    private readonly daliAdapter: CyDali64aAdapter,
    private readonly ledAdapter: NovaLedAdapter,
    private readonly audioAdapter: EkxDspAdapter,
    private readonly hvacAdapter: ModbusHvacAdapter,
  ) {
    this.adapterTargets = [
      { codes: ['CONV-RTU-1'], categories: ['dali-converter', 'rtu-tcp-converter'], adapter: this.daliAdapter },
      { codes: ['LED-NOVA-1'], categories: ['led-controller'], adapter: this.ledAdapter },
      { codes: ['AUDIO-DSP-1'], categories: ['audio-dsp'], adapter: this.audioAdapter },
      { codes: [], categories: ['hvac-gateway'], adapter: this.hvacAdapter },
    ];
  }

  @Get()
  async list(@Query() q: QueryHardwareDto) {
    const data = await this.service.findAll(q);
    return { message: '查询成功', data };
  }

  @Get('summary')
  async summary() {
    const data = await this.service.summary();
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }

  @Post()
  async create(@Body() dto: CreateHardwareDto) {
    const data = await this.service.create(dto);
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHardwareDto) {
    const data = await this.service.update(id, dto);
    // 命中任何已知 code / category 就清对应 adapter 的 DB 缓存, 下次 IO 立刻用新 IP
    const code = data?.code ?? dto.code;
    const category = data?.category ?? dto.category;
    for (const target of this.adapterTargets) {
      const hitCode = code && target.codes.includes(code);
      const hitCategory = category && target.categories.includes(category);
      if (hitCode || hitCategory) target.adapter.invalidateConfigCache();
    }
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }
}
