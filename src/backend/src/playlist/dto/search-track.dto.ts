import { IsString, MaxLength } from 'class-validator';

export class SearchTrackDto {
  @IsString()
  @MaxLength(512)
  artist: string;

  @IsString()
  @MaxLength(512)
  title: string;
}
