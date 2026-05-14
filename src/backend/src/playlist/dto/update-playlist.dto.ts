import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePlaylistDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
