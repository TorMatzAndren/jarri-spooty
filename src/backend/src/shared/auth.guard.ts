import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (
      request.path === '/api/health' ||
      request.path === '/api/spotify/login' ||
      request.path === '/api/spotify/callback' ||
      request.path === '/api/spotify/status'
    ) {
      return true;
    }

    if (!this.authEnabled()) {
      return true;
    }

    const expectedToken = process.env.SPOOTY_AUTH_TOKEN;
    if (!expectedToken) {
      throw new UnauthorizedException(
        'AUTH_ENABLED=true but SPOOTY_AUTH_TOKEN is missing',
      );
    }

    const providedToken = this.extractToken(request);

    if (providedToken !== expectedToken) {
      throw new UnauthorizedException('Invalid or missing Jarri Spooty auth token');
    }

    return true;
  }

  private authEnabled(): boolean {
    return String(process.env.AUTH_ENABLED || '').toLowerCase() === 'true';
  }

  private extractToken(request: Request): string | undefined {
    const headerToken = request.header('x-spooty-token');
    if (headerToken) {
      return headerToken;
    }

    const authorization = request.header('authorization');
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return authorization.slice('bearer '.length).trim();
    }

    return undefined;
  }
}
