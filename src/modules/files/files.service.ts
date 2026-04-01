import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FilesService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.region = this.configService.get<string>('s3.region') ?? 'ap-northeast-2';
    const accessKeyId = this.configService.get<string>('s3.accessKeyId') ?? '';
    const secretAccessKey = this.configService.get<string>('s3.secretAccessKey') ?? '';

    this.bucket = this.configService.get<string>('s3.bucket') ?? '';
    this.s3Client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async uploadFile(
    uploadedBy: string,
    file: Express.Multer.File | undefined,
    refType?: string,
    refId?: string,
  ) {
    if (!file) {
      throw new BadRequestException('업로드 파일이 필요합니다.');
    }

    if (!this.bucket) {
      throw new InternalServerErrorException('S3 버킷 설정이 필요합니다.');
    }

    const extension = this.extractExtension(file.originalname);
    const storedName = `${uuidv4()}${extension}`;
    const key = `uploads/${storedName}`;

    try {
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch (error) {
      throw new InternalServerErrorException('S3 업로드에 실패했습니다.');
    }

    const fileUrl = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

    return this.prisma.file.create({
      data: {
        uploadedBy,
        originalName: file.originalname,
        storedName,
        fileUrl,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        refType,
        refId,
      },
    });
  }

  findMyFiles(userId: string) {
    return this.prisma.file.findMany({
      where: { uploadedBy: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private extractExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    if (idx < 0) {
      return '';
    }

    return filename.slice(idx);
  }
}
