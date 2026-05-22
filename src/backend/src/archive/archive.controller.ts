import { Controller, Get } from '@nestjs/common';
import { ArchiveListingDto, ArchiveService } from './archive.service';

@Controller('archive')
export class ArchiveController {
  constructor(private readonly archiveService: ArchiveService) {}

  @Get()
  list(): Promise<ArchiveListingDto> {
    return this.archiveService.list();
  }
}
