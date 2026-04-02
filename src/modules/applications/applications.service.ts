import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApplicationStatus, AssetType, Prisma, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminSummaryQueryDto } from './dto/admin-summary-query.dto';
import { CancelApplicationDto } from './dto/cancel-application.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { QuickApplicationDto } from './dto/quick-application.dto';
import { RequestVerificationDto } from './dto/request-verification.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

interface VerificationCodeEntry {
  code: string;
  expiresAt: number;
}

@Injectable()
export class ApplicationsService {
  private readonly verificationCodes = new Map<string, VerificationCodeEntry>();

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
        asset: {
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createQuick(dto: QuickApplicationDto) {
    const applicant = await this.findOrCreateApplicant(dto);

    const assetId = dto.assetId ?? (await this.createAssetForQuickApplication(applicant.id, dto));

    const application = await this.prisma.application.create({
      data: {
        applicantId: applicant.id,
        assetId,
        businessIdea: dto.notes?.trim() || '빈집 신청',
        businessType: 'VACANCY_REQUEST',
        desiredStartDate: dto.desiredStartDate ?? new Date(),
        status: ApplicationStatus.RECEIVED,
      },
      include: {
        applicant: {
          select: { id: true, name: true, phone: true, email: true },
        },
        asset: {
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    await this.attachDocuments(applicant.id, application.id, dto.documentUrls);

    return {
      ...application,
      statusLabel: this.statusLabel(application.status),
    };
  }

  requestLookupCode(dto: RequestVerificationDto) {
    const phone = this.normalizePhone(dto.phone);
    const code = this.generateCode();
    this.verificationCodes.set(phone, {
      code,
      expiresAt: Date.now() + 3 * 60 * 1000,
    });

    return {
      message: '인증번호가 발급되었습니다.',
      expiresInSeconds: 180,
      // 실제 서비스에서는 SMS 발송으로 대체
      code,
    };
  }

  async verifyAndLookup(dto: VerifyCodeDto) {
    this.verifyCode(dto.phone, dto.code);
    const phone = this.normalizePhone(dto.phone);

    const users = await this.prisma.user.findMany({
      where: { phone },
      select: { id: true },
    });

    if (users.length === 0) {
      return {
        total: 0,
        inProgress: [],
        completed: [],
        rejected: [],
      };
    }

    const applicantIds = users.map((user) => user.id);
    const applications = await this.prisma.application.findMany({
      where: { applicantId: { in: applicantIds } },
      include: {
        asset: {
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const decorated = applications.map((application) => ({
      ...application,
      statusLabel: this.statusLabel(application.status),
      canCancel: application.status === ApplicationStatus.RECEIVED,
    }));
    const inProgressStatuses: ApplicationStatus[] = [
      ApplicationStatus.RECEIVED,
      ApplicationStatus.REVIEWING,
      ApplicationStatus.REMODELING,
      ApplicationStatus.LEASING,
    ];

    return {
      total: decorated.length,
      inProgress: decorated.filter((item) => inProgressStatuses.includes(item.status)),
      completed: decorated.filter((item) => item.status === ApplicationStatus.COMPLETED),
      rejected: decorated.filter((item) => item.status === ApplicationStatus.REJECTED),
    };
  }

  async cancelByPhone(applicationId: string, dto: CancelApplicationDto) {
    this.verifyCode(dto.phone, dto.code);
    const phone = this.normalizePhone(dto.phone);

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        applicant: {
          select: { id: true, phone: true },
        },
      },
    });

    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (application.applicant.phone !== phone) {
      throw new ForbiddenException('본인 신청 건만 취소할 수 있습니다.');
    }

    if (application.status !== ApplicationStatus.RECEIVED) {
      throw new BadRequestException('접수 상태의 신청서만 취소할 수 있습니다.');
    }

    return this.prisma.application.update({
      where: { id: applicationId },
      data: {
        status: ApplicationStatus.REJECTED,
        rejectReason: '신청자 취소',
      },
    });
  }

  async adminSummary(query: AdminSummaryQueryDto) {
    const month = query.month ?? dayjs().format('YYYY-MM');
    const start = dayjs(`${month}-01`).startOf('month').toDate();
    const end = dayjs(`${month}-01`).endOf('month').toDate();

    const where: Prisma.ApplicationWhereInput = {
      createdAt: {
        gte: start,
        lte: end,
      },
    };

    const [total, grouped] = await Promise.all([
      this.prisma.application.count({ where }),
      this.prisma.application.groupBy({
        by: ['status'],
        where,
        _count: {
          _all: true,
        },
      }),
    ]);

    return {
      month,
      total,
      statusCounts: grouped.map((item) => ({
        status: item.status,
        label: this.statusLabel(item.status),
        count: item._count._all,
      })),
    };
  }

  async adminList(query: AdminListQueryDto) {
    const where: Prisma.ApplicationWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.search
        ? {
            OR: [
              {
                applicant: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                applicant: {
                  phone: {
                    contains: query.search,
                  },
                },
              },
              {
                asset: {
                  address: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
          applicant: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          asset: {
            select: {
              id: true,
              address: true,
              assetType: true,
              areaSqm: true,
            },
          },
        },
        orderBy: { createdAt: query.sort === 'oldest' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.application.count({ where }),
    ]);

    return {
      items: items.map((item) => ({
        ...item,
        statusLabel: this.statusLabel(item.status),
      })),
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async adminDetail(id: string) {
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        applicant: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            role: true,
          },
        },
        asset: {
          include: {
            images: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    const documents = await this.prisma.file.findMany({
      where: {
        refId: id,
        refType: 'APPLICATION_DOC',
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...application,
      statusLabel: this.statusLabel(application.status),
      documents,
    };
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    const application = await this.prisma.application.findUnique({ where: { id } });
    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (dto.status === ApplicationStatus.REJECTED && !dto.rejectReason) {
      throw new BadRequestException('반려 시 rejectReason은 필수입니다.');
    }

    return this.prisma.application.update({
      where: { id },
      data: {
        status: dto.status,
        rejectReason: dto.status === ApplicationStatus.REJECTED ? dto.rejectReason : null,
      },
    });
  }

  private async findOrCreateApplicant(dto: QuickApplicationDto) {
    const phone = this.normalizePhone(dto.phone);

    const existing = await this.prisma.user.findFirst({
      where: { phone },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: dto.applicantName,
          ...(dto.email ? { email: dto.email } : {}),
        },
      });
    }

    const email = dto.email ?? `phone-${phone.replace(/[^0-9]/g, '')}-${uuidv4()}@placeholder.local`;
    const passwordHash = await bcrypt.hash(uuidv4(), 10);

    return this.prisma.user.create({
      data: {
        name: dto.applicantName,
        phone,
        email,
        passwordHash,
        role: UserRole.ELDER,
      },
    });
  }

  private async createAssetForQuickApplication(ownerId: string, dto: QuickApplicationDto): Promise<string> {
    const asset = await this.prisma.asset.create({
      data: {
        ownerId,
        title: `${dto.applicantName} 신청 건`,
        assetType: dto.assetType ?? AssetType.EMPTY_HOUSE,
        address: dto.address,
        regionCode: 'JEJU-UNKNOWN',
        areaSqm: dto.areaSqm,
        latitude: dto.latitude,
        longitude: dto.longitude,
        description: dto.notes,
        images: {
          create:
            dto.photoUrls?.map((url, index) => ({
              fileUrl: url,
              sortOrder: index,
            })) ?? [],
        },
      },
      select: { id: true },
    });

    return asset.id;
  }

  private async attachDocuments(userId: string, applicationId: string, documentUrls?: string[]) {
    if (!documentUrls || documentUrls.length === 0) {
      return;
    }

    await this.prisma.file.createMany({
      data: documentUrls.map((url) => {
        const originalName = this.extractFilename(url);
        return {
          uploadedBy: userId,
          originalName,
          storedName: originalName,
          fileUrl: url,
          mimeType: this.guessMimeType(originalName),
          fileSizeBytes: 0,
          refType: 'APPLICATION_DOC',
          refId: applicationId,
        };
      }),
    });
  }

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  private generateCode(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private verifyCode(phoneRaw: string, code: string): void {
    const phone = this.normalizePhone(phoneRaw);
    const current = this.verificationCodes.get(phone);

    if (!current) {
      throw new UnauthorizedException('인증번호를 먼저 요청해주세요.');
    }

    if (Date.now() > current.expiresAt) {
      this.verificationCodes.delete(phone);
      throw new UnauthorizedException('인증번호가 만료되었습니다.');
    }

    if (current.code !== code) {
      throw new UnauthorizedException('인증번호가 올바르지 않습니다.');
    }

    this.verificationCodes.delete(phone);
  }

  private extractFilename(url: string): string {
    try {
      const parsed = new URL(url);
      const filename = parsed.pathname.split('/').pop();
      if (filename && filename.length > 0) {
        return filename;
      }
      return `${uuidv4()}.dat`;
    } catch {
      return `${uuidv4()}.dat`;
    }
  }

  private guessMimeType(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'application/octet-stream';
  }

  private statusLabel(status: ApplicationStatus): string {
    switch (status) {
      case ApplicationStatus.RECEIVED:
        return '접수됨';
      case ApplicationStatus.REVIEWING:
        return '관리자 검토 중';
      case ApplicationStatus.REMODELING:
        return '리모델링 진행 중';
      case ApplicationStatus.LEASING:
        return '임대 진행 중';
      case ApplicationStatus.COMPLETED:
        return '최종 완료';
      case ApplicationStatus.REJECTED:
        return '반려';
      default:
        return status;
    }
  }
}
