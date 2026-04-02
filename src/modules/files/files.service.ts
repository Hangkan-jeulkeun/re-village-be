import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { UploadPublicFileDto } from './dto/upload-public-file.dto';

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
    return this.saveUploadedFile(uploadedBy, file, refType, refId);
  }

  async uploadPublicFile(file: Express.Multer.File | undefined, dto: UploadPublicFileDto) {
    const phone = this.normalizePhone(dto.phone);
    const user = await this.findOrCreateUploader(dto.name, phone);
    return this.saveUploadedFile(user.id, file, dto.refType, dto.refId);
  }

  private async saveUploadedFile(
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

  private normalizePhone(phone: string): string {
    const compact = phone.trim().replace(/[^0-9+]/g, '');
    if (compact.startsWith('+')) return compact;
    if (compact.startsWith('0')) return `+82${compact.slice(1)}`;
    if (compact.startsWith('82')) return `+${compact}`;
    return `+${compact}`;
  }

  private async findOrCreateUploader(name: string, phone: string) {
    const existing = await this.prisma.user.findFirst({
      where: { phone },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { name },
      });
    }

    const placeholderEmail = `upload-${phone.replace(/[^0-9]/g, '')}-${uuidv4()}@placeholder.local`;
    const passwordHash = await bcrypt.hash(uuidv4(), 10);

    return this.prisma.user.create({
      data: {
        name,
        phone,
        email: placeholderEmail,
        passwordHash,
        role: UserRole.ELDER,
      },
    });
  }
}
