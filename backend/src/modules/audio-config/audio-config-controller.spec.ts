import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AudioConfigController } from './audio-config.controller';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import {
  AudioDeleteQueryDto,
  AudioInputUpsertDto,
  AudioSceneUpsertDto,
  AudioZoneUpsertDto,
} from './dto/audio-config.dto';

describe('audio configuration route contract', () => {
  it.each([
    ['createZone', AudioZoneUpsertDto],
    ['updateZone', AudioZoneUpsertDto],
    ['deleteZone', AudioDeleteQueryDto],
    ['createInput', AudioInputUpsertDto],
    ['updateInput', AudioInputUpsertDto],
    ['deleteInput', AudioDeleteQueryDto],
    ['createScene', AudioSceneUpsertDto],
    ['updateScene', AudioSceneUpsertDto],
    ['deleteScene', AudioDeleteQueryDto],
  ] as const)(
    '%s has admin authorization and a runtime DTO instead of an erased interface',
    (method, dto) => {
      const handler = AudioConfigController.prototype[method];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(AdminGuard);
      const types = Reflect.getMetadata(
        'design:paramtypes',
        AudioConfigController.prototype,
        method,
      );
      expect(types[types.length - 1]).toBe(dto);
    },
  );
});
