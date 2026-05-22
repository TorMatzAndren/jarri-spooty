import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { relative, resolve } from 'path';
import { UtilsService } from '../shared/utils.service';

export interface ArchiveFileDto {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface ArchiveListingDto {
  root: string;
  files: ArchiveFileDto[];
}

@Injectable()
export class ArchiveService {
  constructor(private readonly utilsService: UtilsService) {}

  async list(): Promise<ArchiveListingDto> {
    const root = this.utilsService.getRootDownloadsPath();
    const files = await this.listFiles(root, root);

    return {
      root,
      files: files.sort((a, b) => b.modifiedAt - a.modifiedAt),
    };
  }

  private async listFiles(root: string, currentPath: string): Promise<ArchiveFileDto[]> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const files: ArchiveFileDto[] = [];

    for (const entry of entries) {
      const entryPath = this.utilsService.ensureInsideDownloadsRoot(
        resolve(currentPath, entry.name),
      );

      if (entry.isDirectory()) {
        files.push(...await this.listFiles(root, entryPath));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stat = await fs.stat(entryPath);

      files.push({
        name: entry.name,
        path: relative(root, entryPath).split(/[\\/]+/).join('/'),
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }

    return files;
  }
}
