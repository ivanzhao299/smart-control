import { IsInt, IsObject, Max, Min } from 'class-validator';

/** Layout details are checked by the bounded domain normalizer, not stripped by whitelist. */
export class UpdateParkOpsLayoutDto {
  @IsObject()
  config!: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
}
