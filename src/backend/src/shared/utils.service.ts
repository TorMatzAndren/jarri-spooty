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
    const root = this.getRootDownloadsPath();
    const resolvedCandidate = resolve(candidatePath);
    const rel = relative(root, resolvedCandidate);

    if (rel === '' || (!rel.startsWith('..') && !relative('', rel).startsWith('..'))) {
      return resolvedCandidate;
    }

    throw new Error(`Unsafe path outside downloads root: ${resolvedCandidate}`);
  }

  stripFileIllegalChars(text: string): string {
    return text.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'untitled';
  }
}
