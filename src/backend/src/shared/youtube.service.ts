import { Injectable, Logger } from '@nestjs/common';
import { TrackEntity } from '../track/track.entity';
import { EnvironmentEnum } from '../environmentEnum';
import { TrackService } from '../track/track.service';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import { spawn } from 'child_process';
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

interface YtDlpSearchVideo {
  url?: string;
  webpage_url?: string;
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
}

@Injectable()
export class YoutubeService {
  private readonly logger = new Logger(TrackService.name);

  constructor(private readonly configService: ConfigService) {}

  async findBestYoutubeMatch(
    artist: string,
    name: string,
    durationMs?: number,
    excludedUrls: string[] = [],
  ): Promise<YoutubeMatch> {
    const query = `${artist} - ${name}`;
    this.logger.debug(`Searching ${query} on YT`);

    const videos = await this.searchYoutubeVideos(query);
    const excludedVideoIds = new Set(
      excludedUrls
        .map((url) => this.getYoutubeVideoId(url))
        .filter((id): id is string => !!id),
    );

    const candidates = videos
      .filter((video: any) => !!video?.url && !!video?.title)
      .filter((video: any) => {
        const videoId = this.getYoutubeVideoId(String(video.url));
        return !videoId || !excludedVideoIds.has(videoId);
      })
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
      throw new Error(
        `No acceptable YouTube result found for: ${query}` +
          (excludedUrls.length ? ` after excluding ${excludedUrls.length} failed candidate(s)` : ''),
      );
    }

    this.logger.debug(
      `Selected YouTube match for "${query}": ${accepted.title} by ${accepted.author} (${accepted.score})`,
    );

    return accepted;
  }

  private async searchYoutubeVideos(query: string): Promise<YtDlpSearchVideo[]> {
    const searchTarget = `ytsearch15:${query}`;
    const args = [
      '--dump-single-json',
      '--flat-playlist',
      '--skip-download',
      '--no-playlist',
      '--no-cache-dir',
      '--no-cookies-from-browser',
      '--add-header',
      `User-Agent:${HEADERS['User-Agent']}`,
      searchTarget,
    ];

    const output = await this.runYtDlpForOutput(args);
    let parsed: any;

    try {
      parsed = JSON.parse(output);
    } catch (error) {
      throw new Error(`Failed to parse yt-dlp search output: ${(error as Error).message}`);
    }

    const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    return entries
      .filter((entry: YtDlpSearchVideo) => !!entry?.title && (!!entry?.url || !!entry?.webpage_url || !!entry?.id))
      .map((entry: YtDlpSearchVideo) => ({
        ...entry,
        url: this.normalizeYtDlpVideoUrl(entry),
        author: entry.uploader || entry.channel || '',
        seconds: typeof entry.duration === 'number' ? entry.duration : undefined,
      }));
  }

  private normalizeYtDlpVideoUrl(video: YtDlpSearchVideo): string {
    const rawUrl = String(video.webpage_url || video.url || '');

    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      return rawUrl;
    }

    const id = String(video.id || rawUrl || '').trim();
    if (!id) {
      return '';
    }

    return `https://www.youtube.com/watch?v=${id}`;
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

  private getYoutubeVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);

      if (parsed.hostname === 'youtu.be') {
        return parsed.pathname.replace(/^\//, '') || null;
      }

      return parsed.searchParams.get('v');
    } catch {
      return null;
    }
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

  private getCookiesFile(): string | null {
    const cookiesFile = this.configService.get<string>(
      EnvironmentEnum.YT_COOKIES_FILE,
    );

    if (cookiesFile && fs.existsSync(cookiesFile)) {
      this.logger.debug(`Using cookies file: ${cookiesFile}`);
      return cookiesFile;
    }

    return null;
  }

  private classifyYtDlpError(output: string): string {
    const text = output || '';

    if (text.includes('Sign in to confirm your age')) {
      return 'YouTube age-gated: cookies required or invalid';
    }

    if (text.includes('Only images are available')) {
      return 'YouTube unavailable: no downloadable audio/video formats';
    }

    if (text.includes('Requested format is not available')) {
      return 'YouTube unavailable: requested audio format is not available';
    }

    if (text.includes('Private video')) {
      return 'YouTube unavailable: private video';
    }

    if (text.includes('Video unavailable')) {
      return 'YouTube unavailable';
    }

    if (text.includes('Unable to download webpage')) {
      return 'YouTube unavailable: unable to download webpage';
    }

    return text.trim().slice(0, 1200) || 'Unknown yt-dlp error';
  }

  private prepareWritableCookiesFile(cookiesFile: string | null): string | null {
    if (!cookiesFile) {
      return null;
    }

    const tempCookiesFile = `/tmp/jarri-spooty-youtube-${process.pid}.cookies.txt`;
    fs.copyFileSync(cookiesFile, tempCookiesFile);
    return tempCookiesFile;
  }

  private runYtDlpForOutput(args: string[]): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('yt-dlp', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeoutMs = 10 * 60 * 1000;
      let settled = false;

      const settleResolve = (value: string) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolvePromise(value);
      };

      const settleReject = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        rejectPromise(error);
      };

      const timeout = setTimeout(() => {
        child.kill('SIGKILL');

        settleReject(
          new Error(`yt-dlp exceeded maximum runtime of ${timeoutMs}ms`),
        );
      }, timeoutMs);

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        settleReject(new Error(`Failed to start yt-dlp: ${error.message}`));
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }

        if (code === 0) {
          settleResolve(stdout);
          return;
        }

        settleReject(
          new Error(
            `yt-dlp exited with code ${code}: ${this.classifyYtDlpError(stderr || stdout)}`,
          ),
        );
      });
    });
  }

  private async runYtDlp(args: string[]): Promise<void> {
    await this.runYtDlpForOutput(args);
  }

  async downloadAndFormat(track: TrackEntity, output: string): Promise<void> {
    this.logger.debug(
      `Downloading ${track.artist} - ${track.name} (${track.youtubeUrl}) from YT`,
    );

    if (!track.youtubeUrl) {
      throw new Error('youtubeUrl is null or undefined');
    }

    this.assertValidYoutubeUrl(track.youtubeUrl);

    const format = this.configService.get<string>(EnvironmentEnum.FORMAT) || 'mp3';
    const quality = this.configService.get<string>('QUALITY') || '0';
    const cookiesFile = this.prepareWritableCookiesFile(this.getCookiesFile());

    const args = [
      '--no-playlist',
      '--no-cache-dir',
      '--no-cookies-from-browser',
      '--extract-audio',
      '--audio-format',
      format,
      '--audio-quality',
      quality,
      '--add-header',
      `User-Agent:${HEADERS['User-Agent']}`,
      '-o',
      output,
    ];

    if (cookiesFile) {
      args.push('--cookies', cookiesFile);
    }

    args.push(track.youtubeUrl);

    await this.runYtDlp(args);

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

    let parsedCoverUrl: URL;
    try {
      parsedCoverUrl = new URL(coverUrl);
    } catch {
      throw new Error('Invalid cover art URL');
    }

    if (!['http:', 'https:'].includes(parsedCoverUrl.protocol)) {
      throw new Error('Rejected non-HTTP cover art URL');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let res: Response;
    try {
      res = await fetch(parsedCoverUrl.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch cover art: ${res.status}`);
    }

    const contentType = res.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      throw new Error(`Rejected unsupported cover art type: ${contentType || 'unknown'}`);
    }

    const maxCoverBytes = 5 * 1024 * 1024;
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > maxCoverBytes) {
      throw new Error(`Rejected oversized cover art: ${contentLength} bytes`);
    }

    const arrayBuf = await res.arrayBuffer();
    if (arrayBuf.byteLength > maxCoverBytes) {
      throw new Error(`Rejected oversized cover art: ${arrayBuf.byteLength} bytes`);
    }

    const imageBuffer = Buffer.from(arrayBuf);

    NodeID3.write(
      {
        title,
        artist,
        APIC: {
          mime: contentType,
          type: { id: 3, name: 'front cover' },
          description: 'cover',
          imageBuffer,
        },
      },
      folderName,
    );
  }
}
