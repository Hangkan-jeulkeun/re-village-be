import {
  Controller,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { Request } from 'express';

interface RefreshRequestUser {
  id: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('refresh')
  @UseGuards(AuthGuard('jwt-refresh'))
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '리프레시 토큰으로 액세스 토큰 재발급' })
  @ApiResponse({ status: 200, description: '토큰 재발급 성공' })
  refresh(@Req() request: Request & { user?: RefreshRequestUser }) {
    const userId = request.user?.id;
    if (!userId) {
      throw new UnauthorizedException('유효한 리프레시 토큰이 필요합니다.');
    }
    return this.authService.refresh(userId);
  }
}
