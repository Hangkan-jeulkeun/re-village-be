import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MapService } from './map.service';

@ApiTags('map')
@Controller('map')
export class MapController {
  constructor(private readonly mapService: MapService) {}

  @Get('nearby')
  @ApiOperation({ summary: '반경 기반 자산 검색' })
  @ApiQuery({ name: 'lat', example: 33.4996, required: true })
  @ApiQuery({ name: 'lng', example: 126.5312, required: true })
  @ApiQuery({ name: 'radiusKm', example: 5, required: true })
  findNearby(
    @Query('lat') latRaw: string,
    @Query('lng') lngRaw: string,
    @Query('radiusKm') radiusRaw: string,
  ) {
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    const radiusKm = Number(radiusRaw);

    if ([lat, lng, radiusKm].some((v) => Number.isNaN(v)) || radiusKm <= 0) {
      throw new BadRequestException('lat, lng, radiusKm 쿼리 값을 확인해주세요.');
    }

    return this.mapService.findNearby(lat, lng, radiusKm);
  }
}
