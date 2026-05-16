import {
  Controller,
  Delete,
  Get,
  Post,
  NotFoundException,
  Param,
  ParseIntPipe,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { TrackService } from './track.service';
import { createReadStream, existsSync } from 'fs';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { TrackEntity } from './track.entity';

@Controller('track')
export class TrackController {
  constructor(
    private readonly service: TrackService,
    private readonly configService: ConfigService,
  ) {}

  @Get('playlist/:id')
  getAllByPlaylist(
    @Param('id', ParseIntPipe) playlistId: number,
  ): Promise<TrackEntity[]> {
    return this.service.getAllByPlaylist(playlistId);
  }

  @Get('download/:id')
  async getFile(
    @Res({ passthrough: true }) res: Response,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const track = await this.service.get(id);

    if (!track || !track.playlist) {
      throw new NotFoundException('Track not found');
    }

    const filePath = this.service.getFolderName(track, track.playlist);

    if (!existsSync(filePath)) {
      throw new NotFoundException('Track file not found');
    }

    const fileName = this.service.getTrackFileName(track);

    const readStream = createReadStream(filePath);

    res.set({
      'Content-Disposition':
        `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Type': 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });

    return new StreamableFile(readStream);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.remove(id);
  }

  @Post('retry/:id')
  retry(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.retry(id);
  }
}
