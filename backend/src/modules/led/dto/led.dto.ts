import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const INPUTS = ['HDMI1', 'HDMI2', 'welcome', 'video'] as const;
type LedInput = (typeof INPUTS)[number];

export class LedInputDto {
  @IsIn([...INPUTS])
  input!: LedInput;
}

export class LedPlayDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  media?: string;
}
