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
  'ao vivo',
  'acústico',
  'acustico',
  'acoustic',
  'concert',
  'festival',
  'session',
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

const OFFICIALISH_TERMS = [
  'official audio',
  'official video',
  'official music video',
  'lyric video',
  'lyrics',
  'vevo',
  '- topic',
];

export interface YoutubeMatch {
  url: string;
  title: string;
  author: string;
  score: number;
  reason: string;
}

interface CandidateScore extends YoutubeMatch {
  rejected: boolean;
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(TrackService.name);

  constructor(private readonly configService: ConfigService) {}

  async findBestYoutubeMatch(
    artist: string,
    name: string,
    durationMs?: number,
  ): Promise<YoutubeMatch> {
    const query = `${artist} - ${name}`;
    this.logger.debug(`Searching ${query} on YT`);

    const result = await yts(query);
    const candidates = (result.videos || [])
      .filter((video: any) => !!video?.url && !!video?.title)
      .slice(0, 15)
      .map((video: any) => this.scoreCandidate(video, artist, name, durationMs))
      .filter((match: CandidateScore) => {
        try {
          this.assertValidYoutubeUrl(match.url);
          return true;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.score - a.score);

    this.logger.debug(
      `YouTube candidates for "${query}": ` +
        candidates
          .slice(0, 5)
          .map(
            (c) =>
              `[${c.score}${c.rejected ? ' rejected' : ''}] ${c.title} by ${c.author} (${c.reason})`,
          )
          .join(' | '),
    );

    const accepted = candidates.find((candidate) => !candidate.rejected);

    if (!accepted) {
      throw new Error(`No acceptable YouTube result found for: ${query}`);
    }

    this.logger.debug(
      `Selected YouTube match for "${query}": ${accepted.title} by ${accepted.author} (${accepted.score})`,
    );

    return accepted;
  }

  private scoreCandidate(
    video: any,
    artist: string,
    name: string,
    durationMs?: number,
  ): CandidateScore {
    const title = String(video.title || '');
    const author = String(video.author?.name || video.author || '');
    const url = String(video.url || '');
    const seconds = this.getVideoSeconds(video);

    const normalizedTitle = this.normalize(title);
    const normalizedAuthor = this.normalize(author);
    const normalizedArtist = this.normalize(artist);
    const normalizedName = this.normalize(name);

    let score = 0;
    const reasons: string[] = [];
    let rejected = false;

    if (normalizedTitle.includes(normalizedName)) {
      score += 45;
      reasons.push('title=45');
    }

    for (const artistPart of this.artistParts(normalizedArtist)) {
      if (artistPart.length >= 3 && (normalizedTitle.includes(artistPart) || normalizedAuthor.includes(artistPart))) {
        score += 20;
        reasons.push(`artist=${artistPart}:20`);
        break;
      }
    }

    const officialish = OFFICIALISH_TERMS.find((term) =>
      `${normalizedTitle} ${normalizedAuthor}`.includes(this.normalize(term)),
    );
    if (officialish) {
      score += 12;
      reasons.push(`officialish=${officialish}:12`);
    }

    const badTerm = BAD_MATCH_TERMS.find((term) =>
      normalizedTitle.includes(this.normalize(term)),
    );
    if (badTerm) {
      score -= 25;
      reasons.push(`bad=${badTerm}:-25`);
    }

    if (durationMs && seconds) {
      const spotifySeconds = Math.round(durationMs / 1000);
      const diff = Math.abs(seconds - spotifySeconds);
      const ratio = diff / Math.max(spotifySeconds, 1);

      if (diff <= 8 || ratio <= 0.05) {
        score += 40;
        reasons.push(`duration=excellent:${diff}s:+40`);
      } else if (diff <= 15 || ratio <= 0.10) {
        score += 30;
        reasons.push(`duration=good:${diff}s:+30`);
      } else if (diff <= 30 || ratio <= 0.15) {
        score += 18;
        reasons.push(`duration=ok:${diff}s:+18`);
      } else if (diff <= 45 || ratio <= 0.25) {
        score += 5;
        reasons.push(`duration=weak:${diff}s:+5`);
      } else if (diff > 60 && ratio > 0.40) {
        score -= 80;
        rejected = true;
        reasons.push(`duration=reject:${diff}s:-80`);
      } else {
        score -= 35;
        reasons.push(`duration=bad:${diff}s:-35`);
      }
    } else {
      reasons.push('duration=unknown');
    }

    return {
      url,
      title,
      author,
      score,
      reason: reasons.join(', '),
      rejected,
    };
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private artistParts(normalizedArtist: string): string[] {
    return normalizedArtist
      .split(/\s+(and|feat|featuring|ft|x|,|with)\s+|,/)
      .map((part) => part.trim())
      .filter((part) => part && !['and', 'feat', 'featuring', 'ft', 'x', 'with'].includes(part));
  }

  private getVideoSeconds(video: any): number | undefined {
    if (typeof video.seconds === 'number' && Number.isFinite(video.seconds)) {
      return video.seconds;
    }

    const timestamp = String(video.timestamp || video.duration || '');
    const parts = timestamp
      .split(':')
      .map((part) => Number(part))
      .filter((part) => Number.isFinite(part));

    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return undefined;
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
