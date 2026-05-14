import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrackEntity, TrackStatusEnum } from './track.entity';
import { PlaylistEntity } from '../playlist/playlist.entity';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'path';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { EnvironmentEnum } from '../environmentEnum';
import { UtilsService } from '../shared/utils.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { YoutubeService } from '../shared/youtube.service';
import { toSafeErrorMessage } from '../shared/errors/safe-error';

enum WsTrackOperation {
  New = 'trackNew',
  Update = 'trackUpdate',
  Delete = 'trackDelete',
}

@WebSocketGateway()
@Injectable()
export class TrackService {
  @WebSocketServer() io: Server;
  private readonly logger = new Logger(TrackService.name);

  constructor(
    @InjectRepository(TrackEntity)
    private repository: Repository<TrackEntity>,
    @InjectQueue('track-download-processor') private trackDownloadQueue: Queue,
    @InjectQueue('track-search-processor') private trackSearchQueue: Queue,
    private readonly configService: ConfigService,
    private readonly utilsService: UtilsService,
    private readonly youtubeService: YoutubeService,
  ) {}

  getAll(
    where?: { [key: string]: any },
    relations: Record<string, boolean> = {},
  ): Promise<TrackEntity[]> {
    return this.repository.find({ where, relations });
  }

  getAllByPlaylist(id: number): Promise<TrackEntity[]> {
    return this.repository.find({ where: { playlist: { id } } });
  }

  get(id: number): Promise<TrackEntity | null> {
    return this.repository.findOne({ where: { id }, relations: ['playlist'] });
  }

  async remove(id: number): Promise<void> {
    await this.repository.delete(id);
    this.io.emit(WsTrackOperation.Delete, { id });
  }

  async create(track: TrackEntity, playlist?: PlaylistEntity): Promise<void> {
    const savedTrack = await this.repository.save({ ...track, playlist });
    await this.enqueueSearch(savedTrack.id);
    this.io.emit(WsTrackOperation.New, {
      track: savedTrack,
      playlistId: playlist.id,
    });
  }

  async update(id: number, track: TrackEntity): Promise<void> {
    await this.repository.update(id, track);
    this.io.emit(WsTrackOperation.Update, track);
  }

  async retry(id: number): Promise<void> {
    const track = await this.get(id);

    if (!track) {
      this.logger.warn(`Cannot retry missing track ${id}`);
      return;
    }

    await this.enqueueSearch(id);
    await this.update(id, {
      ...track,
      error: null,
      status: TrackStatusEnum.New,
    });
  }

  async findOnYoutube(track: TrackEntity): Promise<void> {
    const dbTrack = await this.get(track.id);

    if (!dbTrack) {
      this.logger.warn(`Skipping search for missing track ${track.id}`);
      return;
    }

    track = dbTrack;

    await this.update(track.id, {
      ...track,
      status: TrackStatusEnum.Searching,
    });
    let updatedTrack: TrackEntity;
    try {
      const youtubeMatch = await this.youtubeService.findBestYoutubeMatch(
        track.artist,
        track.name,
      );
      updatedTrack = {
        ...track,
        youtubeUrl: youtubeMatch.url,
        status: TrackStatusEnum.Queued,
      };
      this.logger.debug(
        `YouTube match for track ${track.id}: ${youtubeMatch.title} by ${youtubeMatch.author} score=${youtubeMatch.score} reason=${youtubeMatch.reason}`,
      );
    } catch (err) {
      this.logger.error(err);
      updatedTrack = {
        ...track,
        error: toSafeErrorMessage(err),
        status: TrackStatusEnum.Error,
      };
      await this.update(track.id, updatedTrack);
      return;
    }

    await this.update(track.id, updatedTrack);
    await this.enqueueDownload(updatedTrack.id);
  }

  private async enqueueSearch(id: number): Promise<void> {
    const track = await this.get(id);

    if (!track) {
      this.logger.warn(`Cannot enqueue search for missing track ${id}`);
      return;
    }

    const jobId = `search-${id}`;
    const existingJob = await this.trackSearchQueue.getJob(jobId);

    if (existingJob) {
      this.logger.warn(`Search job already exists for track ${id}`);
      return;
    }

    await this.trackSearchQueue.add('search-track', { id }, { jobId });
  }

  private async enqueueDownload(id: number): Promise<void> {
    const track = await this.get(id);

    if (!track) {
      this.logger.warn(`Cannot enqueue download for missing track ${id}`);
      return;
    }

    const jobId = `download-${id}`;
    const existingJob = await this.trackDownloadQueue.getJob(jobId);

    if (existingJob) {
      this.logger.warn(`Download job already exists for track ${id}`);
      return;
    }

    await this.trackDownloadQueue.add('download-track', { id }, { jobId });
  }

  async downloadFromYoutube(track: TrackEntity): Promise<void> {
    const dbTrack = await this.get(track.id);
    if (!dbTrack) {
      return;
    }

    track = dbTrack;

    if (!track.name || !track.artist || !track.playlist) {
      this.logger.error(
        `Track or playlist field is null or undefined: name=${track.name}, artist=${track.artist}, playlist=${track.playlist ? 'ok' : 'null'}`,
      );
      return;
    }

    const coverUrl = track.coverUrl || track.playlist.coverUrl;
    if (!coverUrl) {
      this.logger.warn(
        `No cover art available for track: ${track.artist} - ${track.name}`,
      );
    }

    await this.update(track.id, {
      ...track,
      status: TrackStatusEnum.Downloading,
    });

    let error: string;
    try {
      const folderName = this.getFolderName(track, track.playlist);
      await this.youtubeService.downloadAndFormat(track, folderName);
      if (coverUrl) {
        try {
          await this.youtubeService.addImage(
            folderName,
            coverUrl,
            track.name,
            track.artist,
          );
        } catch (imageError) {
          this.logger.warn(
            `Cover art embed failed for track ${track.id}: ${toSafeErrorMessage(imageError)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(err);
      error = toSafeErrorMessage(err);
    }

    const updatedTrack = {
      ...track,
      status: error ? TrackStatusEnum.Error : TrackStatusEnum.Completed,
      ...(error ? { error } : {}),
    };
    await this.update(track.id, updatedTrack);
  }

  getTrackFileName(track: TrackEntity): string {
    const safeArtist = track.artist || 'unknown_artist';
    const safeName = track.name || 'unknown_track';
    const fileName = `${safeArtist} - ${safeName}`;
    return `${this.utilsService.stripFileIllegalChars(fileName)}.${this.configService.get<string>(EnvironmentEnum.FORMAT)}`;
  }

  getFolderName(track: TrackEntity, playlist: PlaylistEntity): string {
    if (playlist?.isTrack) {
      return this.utilsService.ensureInsideDownloadsRoot(
        resolve(
          this.utilsService.getRootDownloadsPath(),
          this.getTrackFileName(track),
        ),
      );
    }

    const safePlaylistName = playlist?.name || 'unknown_playlist';
    return this.utilsService.ensureInsideDownloadsRoot(
      resolve(
        this.utilsService.getPlaylistFolderPath(safePlaylistName),
        this.getTrackFileName(track),
      ),
    );
  }
}
