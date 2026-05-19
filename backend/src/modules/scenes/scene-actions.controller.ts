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
} from '@nestjs/common';
import { SceneActionsService } from './scene-actions.service';
import {
  CreateSingleActionDto,
  UpdateSingleActionDto,
} from './dto/single-action.dto';

@Controller()
export class SceneActionsController {
  constructor(private readonly service: SceneActionsService) {}

  /** 列出某场景的所有动作 */
  @Get('scenes/:id/actions')
  async list(@Param('id', ParseIntPipe) sceneId: number) {
    const data = await this.service.listForScene(sceneId);
    return { message: '查询成功', data };
  }

  /** 在某场景下新增一个动作 */
  @Post('scenes/:id/actions')
  async create(
    @Param('id', ParseIntPipe) sceneId: number,
    @Body() dto: CreateSingleActionDto,
  ) {
    const data = await this.service.create(sceneId, dto);
    return { message: '创建成功', data };
  }

  /** 修改单个动作 (按动作 id, 不需要 scene id) */
  @Put('scene-actions/:id')
  async update(
    @Param('id', ParseIntPipe) actionId: number,
    @Body() dto: UpdateSingleActionDto,
  ) {
    const data = await this.service.update(actionId, dto);
    return { message: '更新成功', data };
  }

  /** 删除单个动作 */
  @Delete('scene-actions/:id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) actionId: number) {
    await this.service.remove(actionId);
    return { message: '删除成功', data: null };
  }
}
