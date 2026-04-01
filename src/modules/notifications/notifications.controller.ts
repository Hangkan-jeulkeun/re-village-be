import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ParseUuidPipe } from '../../common/pipes/parse-uuid.pipe';
import { PushTokenDto } from './dto/push-token.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('push-token')
  @ApiOperation({ summary: '푸시 토큰 등록/갱신' })
  registerPushToken(@CurrentUser('id') userId: string, @Body() dto: PushTokenDto) {
    return this.notificationsService.registerPushToken(userId, dto);
  }

  @Get('me')
  @ApiOperation({ summary: '내 알림 목록 조회' })
  findMine(@CurrentUser('id') userId: string) {
    return this.notificationsService.findMine(userId);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '알림 읽음 처리' })
  @ApiParam({ name: 'id', format: 'uuid' })
  markAsRead(@CurrentUser('id') userId: string, @Param('id', ParseUuidPipe) id: string) {
    return this.notificationsService.markAsRead(userId, id);
  }
}
