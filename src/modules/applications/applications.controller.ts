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
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { ApplicationsService } from './applications.service';
import { AdminKanbanQueryDto } from './dto/admin-kanban-query.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminSummaryQueryDto } from './dto/admin-summary-query.dto';
import { AutofillHouseDto } from './dto/autofill-house.dto';
import { CancelApplicationDto } from './dto/cancel-application.dto';
import { LookupApplicationDetailDto } from './dto/lookup-application-detail.dto';
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
  @ApiOperation({ summary: '신청 접수 (회원가입 없이 이름/전화번호 기반)' })
  create(@Body() dto: QuickApplicationDto) {
    return this.applicationsService.createQuick(dto);
  }

  @Post('lookup/request-code')
  @ApiOperation({ summary: '신청내역 조회용 인증번호 요청' })
  requestLookupCode(@Body() dto: RequestVerificationDto) {
    return this.applicationsService.requestLookupCode(dto);
  }

  @Post('lookup/verify')
  @ApiOperation({ summary: '인증번호 검증 후 신청내역 조회' })
  verifyAndLookup(@Body() dto: VerifyCodeDto) {
    return this.applicationsService.verifyAndLookup(dto);
  }

  @Post('lookup/detail')
  @ApiOperation({ summary: '인증번호 검증 후 특정 신청 상세 조회' })
  lookupDetail(@Body() dto: LookupApplicationDetailDto) {
    return this.applicationsService.lookupDetail(dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: '신청 취소 (전화번호 인증 기반)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  cancel(
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: CancelApplicationDto,
  ) {
    return this.applicationsService.cancelByPhone(id, dto);
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
}
