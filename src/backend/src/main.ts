import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { AppModule } from './app.module';
import * as fs from 'fs';
import { resolve } from 'path';
import { exec } from 'child_process';
import { EnvironmentEnum } from './environmentEnum';

function envFlag(name: string): boolean {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

async function bootstrap() {
  if (!process.env[EnvironmentEnum.DOWNLOADS_PATH]) {
    throw new Error('DOWNLOADS_PATH environment variable is missing');
  }

  const folderName = resolve(
    __dirname,
    process.env[EnvironmentEnum.DOWNLOADS_PATH],
  );
  fs.mkdirSync(folderName, { recursive: true });

  if (envFlag(EnvironmentEnum.REDIS_RUN)) {
    try {
      // Convenience mode for the single-container Docker image.
      // Hardened deployments should prefer an external Redis service.
      exec(`redis-server --port ${process.env.REDIS_PORT || 6379}`);
    } catch (e) {
      console.log('Unable to run redis server from app');
      console.log(e);
    }
  }

  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());
  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
