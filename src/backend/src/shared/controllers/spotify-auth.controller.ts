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
  login(
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: Response,
  ): void {
    const state =
      returnTo && /^https?:\/\/localhost:\d+\/?$/.test(returnTo)
        ? Buffer.from(JSON.stringify({ returnTo }), 'utf8').toString('base64url')
        : undefined;

    res.redirect(this.spotifyApiService.getAuthorizationUrl(state));
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('error') error: string | undefined,
    @Query('state') state: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const returnTo = this.parseReturnTo(state);

    if (error) {
      res.redirect(`${returnTo}?spotify_error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      res.redirect(`${returnTo}?spotify_error=missing_code`);
      return;
    }

    await this.spotifyApiService.exchangeAuthorizationCode(code);
    res.redirect(`${returnTo}?spotify=connected`);
  }

  private parseReturnTo(state: string | undefined): string {
    if (!state) {
      return '/';
    }

    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
      const returnTo = parsed?.returnTo;

      if (typeof returnTo === 'string' && /^https?:\/\/localhost:\d+\/?$/.test(returnTo)) {
        return returnTo;
      }
    } catch {
      return '/';
    }

    return '/';
  }
}
