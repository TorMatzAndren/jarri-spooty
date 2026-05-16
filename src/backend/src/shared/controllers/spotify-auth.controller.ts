import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SpotifyApiService } from '../spotify-api.service';

@Controller('spotify')
export class SpotifyAuthController {
  constructor(private readonly spotifyApiService: SpotifyApiService) {}

  @Get('status')
  async status(): Promise<{ connected: boolean }> {
    return { connected: await this.spotifyApiService.hasUserToken() };
  }

  @Get('login')
  login(@Res() res: Response): void {
    res.redirect(this.spotifyApiService.getAuthorizationUrl());
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      res.redirect(`/?spotify_error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      res.redirect('/?spotify_error=missing_code');
      return;
    }

    await this.spotifyApiService.exchangeAuthorizationCode(code);
    res.redirect('/?spotify=connected');
  }
}
