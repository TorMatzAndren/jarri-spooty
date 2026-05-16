import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { relative, resolve } from 'path';
import { EnvironmentEnum } from '../environmentEnum';

@Injectable()
export class UtilsService {
  constructor(private readonly configService: ConfigService) {}

  getRootDownloadsPath(): string {
    return resolve(
      __dirname,
      '..',
      this.configService.get<string>(EnvironmentEnum.DOWNLOADS_PATH),
    );
  }

  getPlaylistFolderPath(name: string): string {
    return this.ensureInsideDownloadsRoot(
      resolve(this.getRootDownloadsPath(), this.stripFileIllegalChars(name)),
    );
  }

  ensureInsideDownloadsRoot(candidatePath: string): string {
    const root = resolve(this.getRootDownloadsPath());
    const resolvedCandidate = resolve(candidatePath);
    const rel = relative(root, resolvedCandidate);

    if (rel === '' || (!rel.startsWith('..') && !relative('', rel).startsWith('..'))) {
      return resolvedCandidate;
    }

    throw new Error(`Unsafe path outside downloads root: ${resolvedCandidate}`);
  }

  stripFileIllegalChars(text: string): string {
    const sanitized = String(text || '')
      .replace(/[\x00-\x1f\x80-\x9f]/g, '-')
      .replace(/[/\\?%*:|"<>]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/[. ]+$/g, '')
      .trim();

    const fallback = sanitized || 'untitled';
    const reservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

    if (reservedName.test(fallback) || fallback === '.' || fallback === '..') {
      return `_${fallback}`;
    }

    return fallback.slice(0, 180);
  }
}
