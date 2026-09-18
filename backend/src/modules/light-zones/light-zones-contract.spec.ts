import { ValidationPipe } from '@nestjs/common';
import { CreateLightZoneDto, UpdateLightZoneDto } from './dto/light-zone.dto';
import { AssignGroupsDto, CreateGroupDto, GroupShortsDto, ReorderDto } from './dto/group.dto';

describe('light metadata runtime contract', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (metatype: new () => unknown, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype });

  it('rejects unknown fields and invalid zone metadata before service code', async () => {
    await expect(body(CreateLightZoneDto, {
      code: '  foyer  ', name: '前厅', floor: '1F', unknown: 'must reject',
    })).rejects.toThrow();
    await expect(body(CreateLightZoneDto, { code: '', name: '前厅', floor: '1F' })).rejects.toThrow();
    await expect(body(UpdateLightZoneDto, { name: 'x'.repeat(129) })).rejects.toThrow();
  });

  it('accepts only bounded group, reorder, and short-address metadata', async () => {
    await expect(body(CreateGroupDto, { gatewayCode: 'GW-1', daliGroup: 17 })).rejects.toThrow();
    await expect(body(GroupShortsDto, { shorts: [0, 64] })).rejects.toThrow();
    await expect(body(AssignGroupsDto, { groupIds: [] })).rejects.toThrow();
    await expect(body(ReorderDto, { ids: [1, '2'] })).rejects.toThrow();
    await expect(body(CreateGroupDto, { gatewayCode: 'GW-1', daliGroup: 3, zoneCode: null })).resolves.toMatchObject({ daliGroup: 3 });
  });
});
