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

const BAD_MATCH_TERMS = [
  'live',
  'cover',
  'karaoke',
  'remix',
  'sped up',
  'slowed',
  'nightcore',
  'reaction',
  'tutorial',
  'instrumental',
];

export interface YoutubeMatch {
  url: string;
  title: string;
  author: string;
  score: number;
  reason: string;
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(TrackService.name);

  constructor(private readonly configService: ConfigService) {}

  async findBestYoutubeMatch(artist: string, name: string): Promise<YoutubeMatch> {
    const query = `${artist} - ${name}`;
    this.logger.debug(`Searching ${query} on YT`);

    const result = await yts(query);
    const candidates = (result.videos || [])
      .filter((video: any) => !!video?.url && !!video?.title)
      .slice(0, 10)
      .map((video: any) => this.scoreCandidate(video, artist, name))
      .filter((match: YoutubeMatch) => {
        try {
          this.assertValidYoutubeUrl(match.url);
          return true;
        } catch {
          return false;
        }
      })
      .sort((a: YoutubeMatch, b: YoutubeMatch) => {
        if (b.score !== a.score) {
          return b.score - a.score;
        }
        return a.url.localeCompare(b.url);
      });

    const best = candidates[0];

    if (!best) {
      throw new Error(`No YouTube result found for: ${query}`);
    }

    if (best.score < 40) {
      throw new Error(
        `No confident YouTube match for "${query}". Best score: ${best.score} (${best.title})`,
      );
    }

    this.logger.debug(
      `Selected YouTube match for "${query}": ${best.title} by ${best.author} (${best.score})`,
    );

    return best;
  }

  async findOnYoutubeOne(artist: string, name: string): Promise<string> {
    return (await this.findBestYoutubeMatch(artist, name)).url;
  }

  private scoreCandidate(video: any, artist: string, name: string): YoutubeMatch {
    const title = String(video.title || '');
    const author = String(video.author?.name || video.author || '');
    const haystack = normalize(`${title} ${author}`);
    const titleScore = tokenOverlap(name, title) * 55;
    const artistScore = tokenOverlap(artist, `${title} ${author}`) * 35;

    let score = titleScore + artistScore;
    const reasons = [
      `title=${Math.round(titleScore)}`,
      `artist=${Math.round(artistScore)}`,
    ];

    for (const term of BAD_MATCH_TERMS) {
      if (haystack.includes(term)) {
        score -= 15;
        reasons.push(`penalty:${term}`);
      }
    }

    if (haystack.includes('official audio') || haystack.includes('topic')) {
      score += 10;
      reasons.push('bonus:officialish');
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      url: String(video.url),
      title,
      author,
      score,
      reason: reasons.join(', '),
    };
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

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9åäöüéèàáíóúñ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(' ')
      .filter((token) => token.length > 1),
  );
}

function tokenOverlap(needle: string, haystack: string): number {
  const needleTokens = tokens(needle);
  const haystackTokens = tokens(haystack);

  if (needleTokens.size === 0) {
    return 0;
  }

  let matches = 0;
  for (const token of needleTokens) {
    if (haystackTokens.has(token)) {
      matches++;
    }
  }

  return matches / needleTokens.size;
}
