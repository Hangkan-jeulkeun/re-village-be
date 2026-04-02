import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadPublicFileDto } from './dto/upload-public-file.dto';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '신청용 파일 업로드 (회원가입 없이 사용 가능)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        name: { type: 'string' },
        phone: { type: 'string' },
        refType: { type: 'string' },
        refId: { type: 'string' },
      },
      required: ['file', 'name', 'phone'],
    },
  })
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadPublicFileDto,
  ) {
    return this.filesService.uploadPublicFile(file, body);
  }
}
