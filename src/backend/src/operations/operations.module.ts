import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaylistEntity } from '../playlist/playlist.entity';
import { SharedModule } from '../shared/shared.module';
import { TrackEntity } from '../track/track.entity';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaylistEntity, TrackEntity]),
    BullModule.registerQueue(
      { name: 'track-search-processor' },
      { name: 'track-download-processor' },
    ),
    SharedModule,
  ],
  controllers: [OperationsController],
  providers: [OperationsService],
})
export class OperationsModule {}
