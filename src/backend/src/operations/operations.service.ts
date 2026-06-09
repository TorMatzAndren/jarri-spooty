import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { In, MoreThan, Repository } from 'typeorm';
import { PlaylistEntity } from '../playlist/playlist.entity';
import { SpotifyApiService } from '../shared/spotify-api.service';
import { TrackEntity, TrackStatusEnum } from '../track/track.entity';
import {
  ErrorClass,
  FailureTruth,
  OperationsSnapshot,
  SpootyOperation,
  TrackTruth,
} from './operations.types';

interface ClassifiedError {
  errorClass: ErrorClass;
  errorSummary: string;
  errorDetail: string;
}

@Injectable()
export class OperationsService {
  constructor(
    @InjectRepository(TrackEntity)
    private readonly trackRepository: Repository<TrackEntity>,
    @InjectRepository(PlaylistEntity)
    private readonly playlistRepository: Repository<PlaylistEntity>,
    @InjectQueue('track-download-processor')
    private readonly trackDownloadQueue: Queue,
    @InjectQueue('track-search-processor')
    private readonly trackSearchQueue: Queue,
    private readonly spotifyApiService: SpotifyApiService,
  ) {}

  async getSnapshot(): Promise<OperationsSnapshot> {
    const [
      spotifyConnected,
      searchQueueCounts,
      downloadQueueCounts,
      activeSearchJobs,
      activeDownloadJobs,
      playlists,
      singleSongs,
      tracks,
      active,
      completed,
      failed,
      retries,
      searchingTracks,
      downloadingTracks,
      recentFailures,
      recentTracks,
    ] = await Promise.all([
      this.spotifyApiService.hasUserToken(),
      this.trackSearchQueue.getJobCounts('waiting', 'delayed', 'active'),
      this.trackDownloadQueue.getJobCounts('waiting', 'delayed', 'active'),
      this.trackSearchQueue.getJobs('active', 0, 100, true),
      this.trackDownloadQueue.getJobs('active', 0, 100, true),
      this.playlistRepository.countBy({ isTrack: false }),
      this.playlistRepository.countBy({ isTrack: true }),
      this.trackRepository.count(),
      this.trackRepository.countBy({
        status: In([
          TrackStatusEnum.Searching,
          TrackStatusEnum.Queued,
          TrackStatusEnum.Downloading,
        ]),
      }),
      this.trackRepository.countBy({ status: TrackStatusEnum.Completed }),
      this.trackRepository.countBy({ status: TrackStatusEnum.Error }),
      this.trackRepository.countBy({ downloadAttemptCount: MoreThan(0) }),
      this.trackRepository.find({
        where: { status: TrackStatusEnum.Searching },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.trackRepository.find({
        where: { status: TrackStatusEnum.Downloading },
        order: { createdAt: 'DESC' },
        take: 100,
      }),
      this.trackRepository.find({
        where: { status: TrackStatusEnum.Error },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.trackRepository.find({
        order: { createdAt: 'DESC' },
        take: 20,
      }),
    ]);

    const activeSearchTracks = await this.mergeTracksFromActiveJobs(
      searchingTracks,
      activeSearchJobs,
    );
    const activeDownloadTracks = await this.mergeTracksFromActiveJobs(
      downloadingTracks,
      activeDownloadJobs,
    );

    const searchQueueDepth =
      (searchQueueCounts.waiting || 0) + (searchQueueCounts.delayed || 0);
    const downloadQueueDepth =
      (downloadQueueCounts.waiting || 0) + (downloadQueueCounts.delayed || 0);
    const activeSearches = activeSearchJobs.length;
    const activeDownloads = activeDownloadJobs.length;

    return {
      generatedAt: new Date().toISOString(),
      runtime: {
        operation: this.getOperation({
          activeSearches,
          activeDownloads,
          searchQueueDepth,
          downloadQueueDepth,
          failed,
          retries,
        }),
        spotifyConnected,
        searchQueueDepth,
        downloadQueueDepth,
        activeSearches,
        activeDownloads,
      },
      counters: {
        playlists,
        singleSongs,
        tracks,
        active,
        completed,
        failed,
        retries,
      },
      active: {
        searching: activeSearchTracks.map((track) => this.toTrackTruth(track)),
        downloading: activeDownloadTracks.map((track) =>
          this.toTrackTruth(track),
        ),
      },
      recentFailures: recentFailures.map((track) => this.toTrackTruth(track)),
      recentTracks: recentTracks.map((track) => this.toTrackTruth(track)),
    };
  }

  private async mergeTracksFromActiveJobs(
    tracks: TrackEntity[],
    jobs: Job[],
  ): Promise<TrackEntity[]> {
    const knownIds = new Set(tracks.map((track) => track.id).filter(Boolean));
    const missingIds = jobs
      .map((job) => Number(job.data?.id))
      .filter((id) => Number.isInteger(id) && !knownIds.has(id));

    if (!missingIds.length) {
      return tracks;
    }

    const activeJobTracks = await this.trackRepository.find({
      where: { id: In(missingIds) },
    });

    return [...tracks, ...activeJobTracks];
  }

  private toTrackTruth(track: TrackEntity): TrackTruth | FailureTruth {
    const rejectedCandidates = this.parseRejectedCandidates(track);
    const error = this.classifyError(track.error);

    return {
      id: track.id,
      artist: track.artist,
      name: track.name,
      status: TrackStatusEnum[track.status] || String(track.status),
      ...(track.spotifyUrl ? { spotifyUrl: track.spotifyUrl } : {}),
      ...(track.youtubeUrl ? { youtubeUrl: track.youtubeUrl } : {}),
      ...(track.youtubeUrl
        ? {
            selectedCandidate: {
              url: track.youtubeUrl,
              ...(track.selectedYoutubeTitle
                ? { title: track.selectedYoutubeTitle }
                : {}),
              ...(track.selectedYoutubeAuthor
                ? { author: track.selectedYoutubeAuthor }
                : {}),
              ...(typeof track.selectedYoutubeScore === 'number'
                ? { score: track.selectedYoutubeScore }
                : {}),
              ...(track.selectedYoutubeReason
                ? { reason: track.selectedYoutubeReason }
                : {}),
            },
          }
        : {}),
      ...(typeof track.downloadAttemptCount === 'number'
        ? { downloadAttemptCount: track.downloadAttemptCount }
        : {}),
      ...(error || {}),
      rejectedCandidateCount: rejectedCandidates.length,
      rejectedCandidates,
    };
  }

  private parseRejectedCandidates(track: TrackEntity): string[] {
    if (!track.rejectedYoutubeUrls) {
      return [];
    }

    try {
      const parsed = JSON.parse(track.rejectedYoutubeUrls);
      return Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private classifyError(error?: string): ClassifiedError | undefined {
    if (!error) {
      return undefined;
    }

    const detail = this.trimDetail(error);
    const normalized = error.toLowerCase();

    if (normalized.includes('no acceptable youtube result found')) {
      return this.error(
        'NO_ACCEPTABLE_CANDIDATE',
        'No acceptable YouTube candidate',
        detail,
      );
    }

    if (normalized.includes('sign in to confirm your age')) {
      return this.error(
        'YOUTUBE_AGE_GATED',
        'YouTube video is age-gated',
        detail,
      );
    }

    if (normalized.includes('private video')) {
      return this.error(
        'YOUTUBE_PRIVATE_VIDEO',
        'YouTube video is private',
        detail,
      );
    }

    if (
      normalized.includes('only images are available') ||
      normalized.includes('requested format is not available') ||
      normalized.includes('no downloadable audio/video formats')
    ) {
      return this.error(
        'YOUTUBE_NO_FORMATS',
        'No downloadable YouTube audio format',
        detail,
      );
    }

    if (
      normalized.includes('video unavailable') ||
      normalized.includes('this video is not available') ||
      normalized.includes('selected video unavailable')
    ) {
      return this.error(
        'YOUTUBE_VIDEO_UNAVAILABLE',
        'YouTube video is unavailable',
        detail,
      );
    }

    if (normalized.includes('unable to download webpage')) {
      return this.error(
        'YOUTUBE_WEBPAGE_UNAVAILABLE',
        'YouTube webpage is unavailable',
        detail,
      );
    }

    if (
      normalized.includes('failed to parse yt-dlp search output') ||
      normalized.includes('yt-dlp exited with code') ||
      normalized.includes('failed to start yt-dlp') ||
      normalized.includes('yt-dlp exceeded maximum runtime')
    ) {
      return this.error(
        'YOUTUBE_EXTRACTION_FAILURE',
        'YouTube extraction failed',
        detail,
      );
    }

    if (
      normalized.includes('eacces') ||
      normalized.includes('enoent') ||
      normalized.includes('failed to write') ||
      normalized.includes('permission denied')
    ) {
      return this.error('FILE_WRITE_FAILED', 'File write failed', detail);
    }

    return this.error(
      'UNKNOWN_DOWNLOAD_ERROR',
      'Unknown download error',
      detail,
    );
  }

  private error(
    errorClass: ErrorClass,
    errorSummary: string,
    errorDetail: string,
  ): ClassifiedError {
    return { errorClass, errorSummary, errorDetail };
  }

  private trimDetail(error: string): string {
    const trimmed = error.trim();
    return trimmed.length > 1200 ? `${trimmed.slice(0, 1197)}...` : trimmed;
  }

  private getOperation(input: {
    activeSearches: number;
    activeDownloads: number;
    searchQueueDepth: number;
    downloadQueueDepth: number;
    failed: number;
    retries: number;
  }): SpootyOperation {
    if (input.activeDownloads > 0 || input.downloadQueueDepth > 0) {
      return input.retries > 0 ? 'retrying' : 'downloading';
    }

    if (input.activeSearches > 0 || input.searchQueueDepth > 0) {
      return input.retries > 0 ? 'retrying' : 'searching';
    }

    if (input.failed > 0) {
      return 'degraded';
    }

    return 'idle';
  }
}
