import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { AssetsService } from './assets.service';
import { AssetListingQueryDto } from './dto/asset-listing-query.dto';
import { AssetFilterDto } from './dto/asset-filter.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@ApiTags('assets')
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '자산 등록' })
  create(@CurrentUser('id') ownerId: string, @Body() dto: CreateAssetDto) {
    return this.assetsService.create(ownerId, dto);
  }

  @Get()
  @ApiOperation({ summary: '자산 목록 조회' })
  findAll(@Query() filter: AssetFilterDto) {
    return this.assetsService.findAll(filter);
  }

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

  @Post(':id/inquiries')
  @ApiOperation({ summary: '개인 매물 임대 문의 접수' })
  @ApiParam({ name: 'id', format: 'uuid' })
  createInquiry(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CreateInquiryDto,
  ) {
    return this.assetsService.createInquiry(id, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: '자산 상세 조회' })
  @ApiParam({ name: 'id', format: 'uuid' })
  findOne(@Param('id', ParseUuidPipe) id: string) {
    return this.assetsService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '자산 수정' })
  @ApiParam({ name: 'id', format: 'uuid' })
  update(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(id, user, dto);
  }
}
