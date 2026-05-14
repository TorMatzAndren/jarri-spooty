import { Module } from '@nestjs/common';
import { UtilsService } from './utils.service';
import { ConfigModule } from '@nestjs/config';
import { SpotifyService } from './spotify.service';
import { YoutubeService } from './youtube.service';
import { SpotifyApiService } from './spotify-api.service';
import { SpotifyAuthController } from './controllers/spotify-auth.controller';

@Module({
  imports: [ConfigModule],
  providers: [UtilsService, SpotifyService, YoutubeService, SpotifyApiService],
  controllers: [SpotifyAuthController],
  exports: [UtilsService, SpotifyService, YoutubeService, SpotifyApiService],
})
export class SharedModule {}
