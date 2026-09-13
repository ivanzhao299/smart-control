import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeviceStates1784591295811 implements MigrationInterface {
    name = 'AddDeviceStates1784591295811'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "device_states" ("device_name" varchar(128) PRIMARY KEY NOT NULL, "status" varchar(32) NOT NULL DEFAULT ('offline'), "state" text, "last_command_at" datetime, "last_command_result" text, "updated_at" datetime NOT NULL)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "device_states"`);
    }

}
