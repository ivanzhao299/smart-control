import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { User } from '../../entities/user.entity';
import { LogsModule } from '../logs/logs.module';
import { PermissionService } from './permission.service';
import { RolesController } from './roles.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Role, Permission, RolePermission, User]),
    LogsModule,
  ],
  controllers: [RolesController],
  providers: [PermissionService],
  exports: [PermissionService],
})
export class RbacModule {}
