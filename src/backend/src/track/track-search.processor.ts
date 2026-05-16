import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TrackService } from './track.service';
import { TrackEntity } from './track.entity';

function getSearchDelayMs(): number {
  const parsed = Number(process.env.YT_SEARCH_DELAY_MS || 5000);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 5000;
  }

  return Math.max(1000, Math.min(30000, Math.floor(parsed)));
}

@Processor('track-search-processor', {
  concurrency: 1,
})
export class TrackSearchProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackSearchProcessor.name);

  constructor(private readonly trackService: TrackService) {
    super();
  }

  async process(job: Job<{ id: number }, void, string>): Promise<void> {
    const delayMs = getSearchDelayMs();

    this.logger.debug(
      `Processing search job ${job.id} for track ${job.data.id}; pacing ${delayMs}ms`,
    );

    await new Promise((res) => setTimeout(res, delayMs));
    await this.trackService.findOnYoutube({ id: job.data.id } as TrackEntity);
  }
}
