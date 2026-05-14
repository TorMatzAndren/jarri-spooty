import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { TrackService } from './track.service';
import { TrackEntity } from './track.entity';

@Processor('track-search-processor', {
  concurrency: 2,
})
export class TrackSearchProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackSearchProcessor.name);

  constructor(private readonly trackService: TrackService) {
    super();
  }

  async process(job: Job<TrackEntity, void, string>): Promise<void> {
    if (!job.data?.id) {
      this.logger.warn(`Skipping malformed search job ${job.id}`);
      return;
    }

    this.logger.debug(`Processing search job ${job.id} for track ${job.data.id}`);
    await this.trackService.findOnYoutube(job.data);
  }
}
