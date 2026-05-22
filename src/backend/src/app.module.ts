import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TrackEntity } from './track/track.entity';
import { TrackModule } from './track/track.module';
import { PlaylistModule } from './playlist/playlist.module';
import { PlaylistEntity } from './playlist/playlist.entity';
import { resolve } from 'path';
import { EnvironmentEnum } from './environmentEnum';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './shared/auth.guard';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ArchiveModule } from './archive/archive.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        type: 'sqlite',
        database: resolve(
          __dirname,
          configService.get<string>(EnvironmentEnum.DB_PATH),
        ),
        entities: [TrackEntity, PlaylistEntity],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    ServeStaticModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => [
        {
          rootPath: resolve(
            __dirname,
            configService.get<string>(EnvironmentEnum.FE_PATH),
          ),
          exclude: ['/api/(.*)'],
        },
      ],
      inject: [ConfigService],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 60,
      },
    ]),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          removeOnComplete: {
            age: 3_600,
            count: 1_000,
          },
          removeOnFail: {
            age: 86_400,
            count: 1_000,
          },
          timeout: 10 * 60_000,
        },
        connection: {
          host: configService.get<string>(EnvironmentEnum.REDIS_HOST),
          port: configService.get<number>(EnvironmentEnum.REDIS_PORT),
        },
      }),
      inject: [ConfigService],
    }),
    TrackModule,
    PlaylistModule,
    ArchiveModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
