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

type ClientTrack = Omit<Partial<TrackEntity>, 'rejectedYoutubeUrls'> & {
  rejectedYoutubeUrls?: string[];
};

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

  private toClientTrack(track: TrackEntity): ClientTrack {
    return {
      id: track.id,
      artist: track.artist,
      name: track.name,
      spotifyUrl: track.spotifyUrl,
      youtubeUrl: track.youtubeUrl,
      rejectedYoutubeUrls: this.parseRejectedYoutubeUrls(track),
      downloadAttemptCount: track.downloadAttemptCount,
      status: track.status,
      error: track.error,
      coverUrl: track.coverUrl,
      durationMs: track.durationMs,
      createdAt: track.createdAt,
    };
  }

  async create(track: TrackEntity, playlist?: PlaylistEntity): Promise<void> {
    const savedTrack = await this.repository.save({ ...track, playlist });
    await this.enqueueSearch(savedTrack.id);
    this.io.emit(WsTrackOperation.New, {
      track: this.toClientTrack(savedTrack),
      playlistId: playlist.id,
    });
  }

  async update(id: number, track: TrackEntity): Promise<void> {
    await this.repository.update(id, track);
    this.io.emit(WsTrackOperation.Update, this.toClientTrack(track));
  }

  private parseRejectedYoutubeUrls(track: TrackEntity): string[] {
    if (!track.rejectedYoutubeUrls) {
      return [];
    }

    try {
      const parsed = JSON.parse(track.rejectedYoutubeUrls);
      return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  private stringifyRejectedYoutubeUrls(urls: string[]): string {
    return JSON.stringify([...new Set(urls)].slice(0, 20));
  }

  async retry(id: number): Promise<void> {
    const track = await this.get(id);

    if (!track) {
      this.logger.warn(`Cannot retry missing track ${id}`);
      return;
    }

    const rejectedUrls = this.parseRejectedYoutubeUrls(track);

    if (track.youtubeUrl && !rejectedUrls.includes(track.youtubeUrl)) {
      rejectedUrls.push(track.youtubeUrl);
    }

    await this.update(id, {
      ...track,
      youtubeUrl: null,
      rejectedYoutubeUrls: this.stringifyRejectedYoutubeUrls(rejectedUrls),
      downloadAttemptCount: 0,
      error: null,
      status: TrackStatusEnum.New,
    });

    await this.enqueueSearch(id);
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
      const rejectedUrls = this.parseRejectedYoutubeUrls(track);

      const youtubeMatch = await this.youtubeService.findBestYoutubeMatch(
        track.artist,
        track.name,
        track.durationMs,
        rejectedUrls,
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
      this.logger.warn(`Removing existing search job for track ${id} before enqueue`);
      await existingJob.remove();
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
      this.logger.warn(`Removing existing download job for track ${id} before enqueue`);
      await existingJob.remove();
    }

    await this.trackDownloadQueue.add('download-track', { id }, { jobId });
  }

  private getMaxDownloadAttempts(): number {
    const parsed = Number(process.env.YT_DOWNLOAD_FALLBACK_ATTEMPTS || 3);

    if (!Number.isFinite(parsed) || parsed < 1) {
      return 3;
    }

    return Math.max(1, Math.min(10, Math.floor(parsed)));
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

    const rejectedUrls = this.parseRejectedYoutubeUrls(track);
    const nextAttemptCount = (track.downloadAttemptCount || 0) + 1;
    const maxAttempts = this.getMaxDownloadAttempts();

    if (error && track.youtubeUrl && !rejectedUrls.includes(track.youtubeUrl)) {
      rejectedUrls.push(track.youtubeUrl);
    }

    if (error && nextAttemptCount < maxAttempts) {
      this.logger.warn(
        `Download failed for track ${track.id}; rejecting current YouTube candidate and retrying search ` +
          `(${nextAttemptCount}/${maxAttempts})`,
      );

      await this.update(track.id, {
        ...track,
        youtubeUrl: null,
        rejectedYoutubeUrls: this.stringifyRejectedYoutubeUrls(rejectedUrls),
        downloadAttemptCount: nextAttemptCount,
        error: null,
        status: TrackStatusEnum.New,
      });

      await this.enqueueSearch(track.id);
      return;
    }

    const updatedTrack = {
      ...track,
      status: error ? TrackStatusEnum.Error : TrackStatusEnum.Completed,
      rejectedYoutubeUrls: this.stringifyRejectedYoutubeUrls(rejectedUrls),
      downloadAttemptCount: error ? nextAttemptCount : 0,
      ...(error ? { error } : { error: null }),
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
