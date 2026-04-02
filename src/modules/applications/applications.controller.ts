import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { ApplicationsService } from './applications.service';
import { AdminKanbanQueryDto } from './dto/admin-kanban-query.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminSummaryQueryDto } from './dto/admin-summary-query.dto';
import { AutofillHouseDto } from './dto/autofill-house.dto';
import { QuickApplicationDto } from './dto/quick-application.dto';
import { RequestVerificationDto } from './dto/request-verification.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applicationsService: ApplicationsService) {}

  @Post('autofill')
  @ApiOperation({ summary: 'GPS/사진 기반 빈집 정보 자동입력 추천' })
  autofill(@Body() dto: AutofillHouseDto) {
    return this.applicationsService.autofillHouseInfo(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '신청 접수 (액세스 토큰 기반)' })
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    description:
      '액세스 토큰 필수. JSON 또는 multipart/form-data 지원. multipart 사용 시 일반 필드는 그대로 넣고, 사진은 photos, 서류는 documents 필드에 파일 첨부하세요.',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'owner@example.com' },
        address: { type: 'string', example: '제주특별자치도 서귀포시 천지동' },
        assetType: { type: 'string', example: 'EMPTY_HOUSE' },
        areaSqm: { type: 'number', example: 72 },
        floorCount: { type: 'number', example: 1 },
        hasYard: { type: 'boolean', example: true },
        hasParking: { type: 'boolean', example: true },
        notes: { type: 'string', example: '건물 관련 추가 설명' },
        payload: {
          type: 'string',
          example:
            '{"address":"제주특별자치도 서귀포시 천지동","assetType":"EMPTY_HOUSE"}',
          description:
            '선택. multipart에서 JSON 문자열로 전달 가능. payload와 개별 필드가 겹치면 개별 필드 우선',
        },
        photos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        documents: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @UseInterceptors(AnyFilesInterceptor())
  create(
    @Body() rawBody: Record<string, unknown>,
    @UploadedFiles() uploadedFiles: Express.Multer.File[] = [],
    @CurrentUser() user: AuthUser,
    @Headers('content-type') contentType?: string,
  ) {
    const dto = this.toQuickApplicationDto(rawBody);
    const files = this.groupFiles(uploadedFiles);
    return this.applicationsService.createQuick(user.id, dto, files, contentType);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '내 신청 목록 조회 (액세스 토큰 기반)' })
  myApplications(@CurrentUser() user: AuthUser) {
    return this.applicationsService.findMyApplicationsByToken(user.id);
  }

  @Get(':id/analysis')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '내 신청 건 AI 매물 분석 (액세스 토큰 기반)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  analyzeMyApplication(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applicationsService.analyzeMyApplication(user.id, id, user.role);
  }

  @Get('me/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '내 신청 건 상세 조회 (액세스 토큰 기반)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  myApplicationDetail(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applicationsService.getMyApplicationDetail(user.id, id, user.role);
  }

  @Post('lookup/request-code')
  @ApiOperation({ summary: '인증번호 요청 (조회/신청 공용)' })
  requestLookupCode(@Body() dto: RequestVerificationDto) {
    return this.applicationsService.requestLookupCode(dto);
  }

  @Post('verification/request-code')
  @ApiOperation({ summary: '신청용 인증번호 요청 (SMS 발송)' })
  requestSubmitCode(@Body() dto: RequestVerificationDto) {
    return this.applicationsService.requestApplyCode(dto);
  }

  @Post('verification/verify')
  @ApiOperation({ summary: '신청용 인증번호 검증' })
  verifySubmitCode(@Body() dto: VerifyCodeDto) {
    return this.applicationsService.verifyApplyCode(dto);
  }

  @Post('lookup/verify')
  @ApiOperation({ summary: '인증번호 검증 후 토큰 발급 + 신청내역 조회' })
  verifyAndLookup(@Body() dto: VerifyCodeDto) {
    return this.applicationsService.verifyAndLookup(dto);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '신청 취소 (액세스 토큰 기반)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  cancelMyApplication(
    @Param('id', ParseUuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.applicationsService.cancelMyApplication(user.id, id, user.role);
  }

  @Get('admin/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '관리자 신청 현황 요약' })
  adminSummary(@Query() query: AdminSummaryQueryDto) {
    return this.applicationsService.adminSummary(query);
  }

  @Get('admin/list')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '관리자 신청 목록 조회' })
  adminList(@Query() query: AdminListQueryDto) {
    return this.applicationsService.adminList(query);
  }

  @Get('admin/kanban')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '관리자 칸반 보드 조회' })
  adminKanban(@Query() query: AdminKanbanQueryDto) {
    return this.applicationsService.adminKanban(query);
  }

  @Get('admin/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '관리자 신청 상세 조회' })
  @ApiParam({ name: 'id', format: 'uuid' })
  adminDetail(@Param('id', ParseUuidPipe) id: string) {
    return this.applicationsService.adminDetail(id);
  }

  @Patch(':id/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '신청 상태 변경 (관리자)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  updateStatus(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.applicationsService.updateStatus(id, dto);
  }

  private toQuickApplicationDto(rawBody: Record<string, unknown>): QuickApplicationDto {
    const payloadRaw = typeof rawBody.payload === 'string' ? rawBody.payload : undefined;
    let payloadObject: Record<string, unknown> = {};

    if (payloadRaw) {
      try {
        const parsed = JSON.parse(payloadRaw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payloadObject = parsed as Record<string, unknown>;
        } else {
          throw new BadRequestException('payload는 JSON 객체 문자열이어야 합니다.');
        }
      } catch {
        throw new BadRequestException('payload JSON 파싱에 실패했습니다.');
      }
    }

    const merged = {
      ...payloadObject,
      ...rawBody,
    };
    delete merged.payload;

    return merged as unknown as QuickApplicationDto;
  }

  private groupFiles(files: Express.Multer.File[]) {
    const photos = files.filter((file) => file.fieldname === 'photos');
    const documents = files.filter((file) => file.fieldname === 'documents');

    if (files.length > 0 && photos.length === 0 && documents.length === 0) {
      throw new BadRequestException(
        '파일 필드명은 photos 또는 documents만 사용할 수 있습니다.',
      );
    }

    return { photos, documents };
  }
}
