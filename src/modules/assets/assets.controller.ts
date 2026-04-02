import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { AssetsService } from './assets.service';
import { AssetListingQueryDto } from './dto/asset-listing-query.dto';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get('listings')
  @ApiOperation({ summary: '매물 리스트 조회 (공공/개인 분리)' })
  listMarketplace(@Query() query: AssetListingQueryDto) {
    return this.assetsService.listMarketplace(query);
  }

  @Get('listings/:id')
  @ApiOperation({ summary: '매물 상세 조회' })
  @ApiParam({ name: 'id', format: 'uuid' })
  getListingDetail(@Param('id', ParseUuidPipe) id: string) {
    return this.assetsService.getListingDetail(id);
  }
}
