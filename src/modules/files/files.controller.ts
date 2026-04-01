import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FilesService } from './files.service';

interface UploadFileBody {
  refType?: string;
  refId?: string;
}

@ApiTags('files')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'S3 파일 업로드' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        refType: { type: 'string' },
        refId: { type: 'string' },
      },
      required: ['file'],
    },
  })
  upload(
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadFileBody,
  ) {
    return this.filesService.uploadFile(userId, file, body.refType, body.refId);
  }

  @Get('me')
  @ApiOperation({ summary: '내 업로드 파일 목록 조회' })
  findMine(@CurrentUser('id') userId: string) {
    return this.filesService.findMyFiles(userId);
  }
}
