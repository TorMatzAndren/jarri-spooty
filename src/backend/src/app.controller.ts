import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'ONLINE';
  }

  @Get('health')
  getHealth(): { status: string } {
    return { status: 'ok' };
  }
}
