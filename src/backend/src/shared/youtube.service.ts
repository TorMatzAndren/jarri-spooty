import { Injectable, Logger } from '@nestjs/common';
import { TrackEntity } from '../track/track.entity';
import { EnvironmentEnum } from '../environmentEnum';
import { TrackService } from '../track/track.service';
import { ConfigService } from '@nestjs/config';
import { YtDlp } from 'ytdlp-nodejs';
import * as yts from 'yt-search';
import * as fs from 'fs';
const NodeID3 = require('node-id3');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

const ALLOWED_YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(TrackService.name);

  constructor(private readonly configService: ConfigService) {}

  async findOnYoutubeOne(artist: string, name: string): Promise<string> {
    const query = `${artist} - ${name}`;
    this.logger.debug(`Searching ${query} on YT`);

    const result = await yts(query);
    const firstVideo = result.videos?.[0];

    if (!firstVideo?.url) {
      throw new Error(`No YouTube result found for: ${query}`);
    }

    this.assertValidYoutubeUrl(firstVideo.url);
    this.logger.debug(`Found ${query} on ${firstVideo.url}`);
    return firstVideo.url;
  }

  assertValidYoutubeUrl(url: string): void {
    let parsed: URL;

    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid YouTube URL');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Rejected non-HTTP YouTube URL');
    }

    if (!ALLOWED_YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new Error(`Rejected non-YouTube URL: ${parsed.hostname}`);
    }
  }

  private getCookiesOptions(): {
    cookiesFromBrowser?: string;
    cookies?: string;
  } {
    const cookiesBrowser = this.configService.get<string>(
      EnvironmentEnum.YT_COOKIES,
    );
    if (cookiesBrowser) {
      this.logger.debug(`Using cookies from browser: ${cookiesBrowser}`);
      return { cookiesFromBrowser: cookiesBrowser };
    }
    const cookiesFile = this.configService.get<string>(
      EnvironmentEnum.YT_COOKIES_FILE,
    );
    if (cookiesFile && fs.existsSync(cookiesFile)) {
      this.logger.debug(`Using cookies file: ${cookiesFile}`);
      return { cookies: cookiesFile };
    }
    return {};
  }

  async downloadAndFormat(track: TrackEntity, output: string): Promise<void> {
    this.logger.debug(
      `Downloading ${track.artist} - ${track.name} (${track.youtubeUrl}) from YT`,
    );

    if (!track.youtubeUrl) {
      throw new Error('youtubeUrl is null or undefined');
    }

    this.assertValidYoutubeUrl(track.youtubeUrl);

    const ytdlp = new YtDlp();
    await ytdlp.downloadAudio(
      track.youtubeUrl,
      this.configService.get<'m4a'>(EnvironmentEnum.FORMAT),
      {
        output,
        ...this.getCookiesOptions(),
        headers: HEADERS,
        jsRuntime: 'node',
        audioQuality: this.configService.get<string>('QUALITY'),
      },
    );

    this.logger.debug(
      `Downloaded ${track.artist} - ${track.name} to ${output}`,
    );
  }

  async addImage(
    folderName: string,
    coverUrl: string,
    title: string,
    artist: string,
  ): Promise<void> {
    if (!coverUrl) {
      return;
    }

    const res = await fetch(coverUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch cover art: ${res.status}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const imageBuffer = Buffer.from(arrayBuf);

    NodeID3.write(
      {
        title,
        artist,
        APIC: {
          mime: 'image/jpeg',
          type: { id: 3, name: 'front cover' },
          description: 'cover',
          imageBuffer,
        },
      },
      folderName,
    );
  }
}
