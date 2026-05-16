import { IsString, IsUrl, MaxLength } from 'class-validator';

export class CreatePlaylistDto {
  @IsString()
  @MaxLength(2048)
  @IsUrl({
    require_protocol: true,
    protocols: ['https'],
  })
  spotifyUrl: string;
}
