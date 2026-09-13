import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDaliLightAndScenes1784596499266 implements MigrationInterface {
    name = 'AddDaliLightAndScenes1784596499266'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "light_scene" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "code" varchar(64) NOT NULL, "name" varchar(128) NOT NULL, "floor" varchar(16), "icon" varchar(32), "sort_order" integer NOT NULL DEFAULT (100), "enabled" boolean NOT NULL DEFAULT (1), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_7f18d771a37713be4057a2e25c" ON "light_scene" ("code") `);
        await queryRunner.query(`CREATE TABLE "light_scene_item" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "scene_code" varchar(64) NOT NULL, "target_type" varchar(16) NOT NULL, "target_ref" varchar(96) NOT NULL, "on" boolean NOT NULL DEFAULT (1), "brightness" integer, "kelvin" integer, "created_at" datetime NOT NULL DEFAULT (datetime('now')))`);
        await queryRunner.query(`CREATE INDEX "IDX_2f8cbd9f1f0c0a906bee82702c" ON "light_scene_item" ("scene_code") `);
        await queryRunner.query(`CREATE TABLE "dali_light" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "gateway_code" varchar(64) NOT NULL, "short_addr" integer NOT NULL, "name" varchar(128), "zone_code" varchar(64), "online" boolean NOT NULL DEFAULT (0), "fault" boolean NOT NULL DEFAULT (0), "last_seen_at" datetime, "sort_order" integer NOT NULL DEFAULT (100), "enabled" boolean NOT NULL DEFAULT (1), "created_at" datetime NOT NULL DEFAULT (datetime('now')), "updated_at" datetime NOT NULL DEFAULT (datetime('now')), CONSTRAINT "uq_dali_light_gw_short" UNIQUE ("gateway_code", "short_addr"))`);
        await queryRunner.query(`CREATE INDEX "IDX_068d7790ec1ebeb5d6e5b190de" ON "dali_light" ("gateway_code") `);
        await queryRunner.query(`CREATE INDEX "IDX_c73c378cc1d4aeb6f2183bcac2" ON "dali_light" ("zone_code") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_c73c378cc1d4aeb6f2183bcac2"`);
        await queryRunner.query(`DROP INDEX "IDX_068d7790ec1ebeb5d6e5b190de"`);
        await queryRunner.query(`DROP TABLE "dali_light"`);
        await queryRunner.query(`DROP INDEX "IDX_2f8cbd9f1f0c0a906bee82702c"`);
        await queryRunner.query(`DROP TABLE "light_scene_item"`);
        await queryRunner.query(`DROP INDEX "IDX_7f18d771a37713be4057a2e25c"`);
        await queryRunner.query(`DROP TABLE "light_scene"`);
    }

}
