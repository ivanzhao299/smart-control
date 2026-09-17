import { IsInt, IsObject, Max, Min } from 'class-validator';

/** The editor envelope is strict; document keys and values use the bounded domain normalizer. */
export class UpdateParkOpsMetricsDto {
  @IsObject()
  document!: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
}
