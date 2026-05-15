import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { AppModule } from './app.module';
import * as fs from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import helmet from 'helmet';
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
      const redisProcess = spawn(
        'redis-server',
        ['--port', String(process.env.REDIS_PORT || 6379)],
        {
          stdio: 'ignore',
          detached: true,
        },
      );

      redisProcess.unref();
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

  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );

  const corsOrigin =
    process.env[EnvironmentEnum.CORS_ORIGIN] || 'http://localhost:4200';

  app.enableCors({
    origin: corsOrigin,
    credentials: false,
  });

  if (
    process.env[EnvironmentEnum.NODE_ENV] === 'production' &&
    !envFlag(EnvironmentEnum.AUTH_ENABLED)
  ) {
    console.warn('[SECURITY] AUTH_ENABLED is false while NODE_ENV=production');
  }

  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
