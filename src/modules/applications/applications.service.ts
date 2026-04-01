import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';
import { UpdateStatusDto } from './dto/update-status.dto';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(applicantId: string, dto: CreateApplicationDto) {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) {
      throw new NotFoundException('자산을 찾을 수 없습니다.');
    }

    return this.prisma.application.create({
      data: {
        applicantId,
        assetId: dto.assetId,
        businessIdea: dto.businessIdea,
        businessType: dto.businessType,
        desiredStartDate: dto.desiredStartDate,
      },
    });
  }

  findMyApplications(applicantId: string) {
    return this.prisma.application.findMany({
      where: { applicantId },
      include: {
        asset: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const application = await this.prisma.application.findUnique({ where: { id } });
    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (dto.status === ApplicationStatus.REJECTED && !dto.rejectReason) {
      throw new BadRequestException('거절 시 rejectReason은 필수입니다.');
    }

    return this.prisma.application.update({
      where: { id },
      data: {
        status: dto.status,
        rejectReason: dto.status === ApplicationStatus.REJECTED ? dto.rejectReason : null,
      },
    });
  }
}
