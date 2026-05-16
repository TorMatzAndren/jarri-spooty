import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TrackService } from './track.service';
import { TrackEntity } from './track.entity';

function getDownloadsPerMinute(): number {
  const parsed = Number(process.env.YT_DOWNLOADS_PER_MINUTE || 3);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 3;
  }

  return Math.max(1, Math.min(30, Math.floor(parsed)));
}

@Processor('track-download-processor', {
  concurrency: 1,
})
export class TrackDownloadProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackDownloadProcessor.name);

  constructor(private readonly trackService: TrackService) {
    super();
  }

  async process(job: Job<TrackEntity, void>): Promise<void> {
    if (!job.data?.id) {
      this.logger.warn(`Skipping malformed download job ${job.id}`);
      return;
    }

    const maxPerMinute = getDownloadsPerMinute();
    const sleepMs = Math.floor(60000 / maxPerMinute);

    this.logger.debug(
      `Processing download job ${job.id} for track ${job.data.id}; pacing ${sleepMs}ms`,
    );

    await new Promise((res) => setTimeout(res, sleepMs));
    await this.trackService.downloadFromYoutube(job.data);
  }
}
