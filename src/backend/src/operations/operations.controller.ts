import { Controller, Get } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { OperationsSnapshot } from './operations.types';

@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  @Get('snapshot')
  getSnapshot(): Promise<OperationsSnapshot> {
    return this.operationsService.getSnapshot();
  }
}
