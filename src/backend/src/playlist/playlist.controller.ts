import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { PlaylistService } from './playlist.service';
import { PlaylistEntity } from './playlist.entity';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';

@Controller('playlist')
export class PlaylistController {
  constructor(private readonly service: PlaylistService) {}

  @Get()
  getAll(): Promise<PlaylistEntity[]> {
    return this.service.findAll();
  }

  @Post()
  async create(@Body() playlist: CreatePlaylistDto): Promise<void> {
    await this.service.create(playlist as PlaylistEntity);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() playlist: UpdatePlaylistDto,
  ): Promise<void> {
    return this.service.update(id, playlist);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.service.remove(id);
  }

  @Post('retry/:id')
  retryFailedOfPlaylist(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.service.retryFailedOfPlaylist(id);
  }
}
