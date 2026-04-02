import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  AssetType,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminKanbanQueryDto } from './dto/admin-kanban-query.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminSummaryQueryDto } from './dto/admin-summary-query.dto';
import { CancelApplicationDto } from './dto/cancel-application.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { LookupApplicationDetailDto } from './dto/lookup-application-detail.dto';
import {
  ApplicationDocumentType,
  QuickApplicationDto,
} from './dto/quick-application.dto';
import { RequestVerificationDto } from './dto/request-verification.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

interface VerificationCodeEntry {
  code: string;
  expiresAt: number;
}

type ApplicationListItem = Prisma.ApplicationGetPayload<{
  include: {
    asset: { include: { images: true } };
    contract: true;
  };
}>;

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
    const applicantName = this.resolveApplicantName(dto);
    const applicant = await this.findOrCreateApplicant(dto);

    const assetId = dto.assetId
      ? await this.resolveExistingAssetId(dto.assetId)
      : await this.createAssetForQuickApplication(applicant.id, dto);

    const application = await this.createApplicationRecord(applicant.id, assetId, applicantName, dto);

    await this.attachDocuments(applicant.id, application.id, dto);

    return {
      ...application,
      statusLabel: this.statusLabel(application.status),
    };
  }

  private async resolveExistingAssetId(assetId: string): Promise<string> {
    const existing = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException(
        '선택한 매물을 찾을 수 없습니다. 목록에서 다시 선택해주세요.',
      );
    }

    return existing.id;
  }

  private async createApplicationRecord(
    applicantId: string,
    assetId: string,
    applicantName: string,
    dto: QuickApplicationDto,
  ) {
    try {
      return await this.prisma.application.create({
        data: {
          applicantId,
          assetId,
          businessIdea: dto.notes?.trim() || `${applicantName} 신청`,
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
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new NotFoundException(
          '선택한 매물이 존재하지 않아 신청을 접수할 수 없습니다.',
        );
      }

      throw error;
    }
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
        progressCount: 0,
        completedCount: 0,
        rejectedCount: 0,
        inProgress: [],
        completed: [],
        rejected: [],
        message:
          '아직 신청 내역이 없습니다. 빈집을 신청하면 여기서 진행 상황을 확인하실 수 있습니다.',
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
        contract: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const decorated = applications.map((application) => this.toApplicationCard(application));
    const inProgressStatuses: ApplicationStatus[] = [
      ApplicationStatus.RECEIVED,
      ApplicationStatus.REVIEWING,
      ApplicationStatus.REMODELING,
      ApplicationStatus.LEASING,
    ];

    const inProgress = decorated.filter((item) => inProgressStatuses.includes(item.status));
    const completed = decorated.filter((item) => item.status === ApplicationStatus.COMPLETED);
    const rejected = decorated.filter((item) => item.status === ApplicationStatus.REJECTED);

    return {
      total: decorated.length,
      progressCount: inProgress.length,
      completedCount: completed.length,
      rejectedCount: rejected.length,
      inProgress,
      completed,
      rejected,
    };
  }

  async lookupDetail(dto: LookupApplicationDetailDto) {
    this.verifyCode(dto.phone, dto.code);
    const phone = this.normalizePhone(dto.phone);

    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
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
        contract: true,
      },
    });

    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (application.applicant.phone !== phone) {
      throw new ForbiddenException('본인 신청 건만 조회할 수 있습니다.');
    }

    const documents = await this.prisma.file.findMany({
      where: {
        refId: application.id,
        refType: { startsWith: 'APPLICATION_DOC' },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      ...this.toApplicationCard(application),
      applicant: application.applicant,
      documents,
      asset: application.asset,
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

  async adminKanban(query: AdminKanbanQueryDto) {
    const where: Prisma.ApplicationWhereInput = query.search
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
      : {};

    const items = await this.prisma.application.findMany({
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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const statusOrder: ApplicationStatus[] = [
      ApplicationStatus.RECEIVED,
      ApplicationStatus.REVIEWING,
      ApplicationStatus.REMODELING,
      ApplicationStatus.LEASING,
      ApplicationStatus.COMPLETED,
      ApplicationStatus.REJECTED,
    ];

    const columns = statusOrder.map((status) => ({
      status,
      label: this.statusLabel(status),
      count: items.filter((item) => item.status === status).length,
      items: items.filter((item) => item.status === status),
    }));

    return {
      total: items.length,
      columns,
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
        contract: true,
      },
    });

    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    const documents = await this.prisma.file.findMany({
      where: {
        refId: id,
        refType: { startsWith: 'APPLICATION_DOC' },
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
    const application = await this.prisma.application.findUnique({
      where: { id },
      include: {
        applicant: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (dto.status === ApplicationStatus.REJECTED && !dto.rejectReason) {
      throw new BadRequestException('반려 시 rejectReason은 필수입니다.');
    }

    const updated = await this.prisma.application.update({
      where: { id },
      data: {
        status: dto.status,
        rejectReason: dto.status === ApplicationStatus.REJECTED ? dto.rejectReason : null,
        residentAgeGroup: dto.residentAgeGroup,
        leasePurpose: dto.leasePurpose,
        occupantCount: dto.occupantCount,
        remodelSummary: dto.remodelSummary,
        managerContact: dto.managerContact,
        completedAt:
          dto.status === ApplicationStatus.COMPLETED ? new Date() : application.completedAt,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: application.applicantId,
        type: NotificationType.APPLICATION,
        title: '신청 처리 상태가 변경되었습니다.',
        body: `신청 상태가 "${this.statusLabel(dto.status)}"로 변경되었습니다.`,
        refType: 'APPLICATION',
        refId: application.id,
      },
    });

    return {
      ...updated,
      statusLabel: this.statusLabel(updated.status),
      emailNotification: {
        willSend: Boolean(application.applicant.email),
        target: application.applicant.email ?? null,
      },
    };
  }

  private async findOrCreateApplicant(dto: QuickApplicationDto) {
    const name = this.resolveApplicantName(dto);
    const phone = this.normalizePhone(dto.phone);

    const existing = await this.prisma.user.findFirst({
      where: { phone },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
          ...(dto.email ? { email: dto.email } : {}),
        },
      });
    }

    const email = dto.email ?? `phone-${phone.replace(/[^0-9]/g, '')}-${uuidv4()}@placeholder.local`;
    const passwordHash = await bcrypt.hash(uuidv4(), 10);

    return this.prisma.user.create({
      data: {
        name,
        phone,
        email,
        passwordHash,
        role: UserRole.ELDER,
      },
    });
  }

  private async createAssetForQuickApplication(ownerId: string, dto: QuickApplicationDto): Promise<string> {
    const name = this.resolveApplicantName(dto);
    const address = dto.address ?? dto.detectedAddress ?? '주소 미입력';
    const assetType = dto.assetType ?? dto.detectedAssetType ?? AssetType.EMPTY_HOUSE;
    const areaSqm = dto.areaSqm ?? dto.detectedAreaSqm;
    const asset = await this.prisma.asset.create({
      data: {
        ownerId,
        title: `${name} 신청 건`,
        assetType,
        address,
        regionCode: 'JEJU-UNKNOWN',
        areaSqm,
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

  private async attachDocuments(userId: string, applicationId: string, dto: QuickApplicationDto) {
    const documents = this.normalizeDocuments(dto);

    if (documents.length === 0) {
      return;
    }

    await this.prisma.file.createMany({
      data: documents.map((document) => {
        const originalName = this.extractFilename(document.fileUrl);
        return {
          uploadedBy: userId,
          originalName,
          storedName: originalName,
          fileUrl: document.fileUrl,
          mimeType: this.guessMimeType(originalName),
          fileSizeBytes: 0,
          refType: `APPLICATION_DOC_${document.type}`,
          refId: applicationId,
        };
      }),
    });
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const compact = trimmed.replace(/[^0-9+]/g, '');

    if (compact.startsWith('+')) {
      return compact;
    }

    if (compact.startsWith('0')) {
      return `+82${compact.slice(1)}`;
    }

    if (compact.startsWith('82')) {
      return `+${compact}`;
    }

    return `+${compact}`;
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

  private resolveApplicantName(dto: QuickApplicationDto): string {
    const name = dto.name ?? dto.applicantName;
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('이름은 필수입니다.');
    }

    return name.trim();
  }

  private normalizeDocuments(dto: QuickApplicationDto): Array<{
    fileUrl: string;
    type: ApplicationDocumentType;
  }> {
    const fromTyped =
      dto.documentFiles?.map((doc) => ({
        fileUrl: doc.fileUrl,
        type: doc.type ?? ApplicationDocumentType.OTHER,
      })) ?? [];
    const fromLegacy =
      dto.documentUrls?.map((url) => ({
        fileUrl: url,
        type: ApplicationDocumentType.OTHER,
      })) ?? [];

    return [...fromTyped, ...fromLegacy];
  }

  private toApplicationCard(application: ApplicationListItem) {
    const leaseYears = application.contract
      ? dayjs(application.contract.endDate).diff(dayjs(application.contract.startDate), 'year', true)
      : null;
    const remainingYears = application.contract
      ? Math.max(dayjs(application.contract.endDate).diff(dayjs(), 'year', true), 0)
      : null;

    return {
      id: application.id,
      status: application.status,
      statusLabel: this.statusLabel(application.status),
      appliedAt: application.createdAt,
      completedAt: application.completedAt,
      rejectReason: application.rejectReason,
      canCancel: application.status === ApplicationStatus.RECEIVED,
      asset: {
        id: application.asset.id,
        address: application.asset.address,
        assetType: application.asset.assetType,
        areaSqm: application.asset.areaSqm,
        images: application.asset.images,
      },
      lease: application.contract
        ? {
            startDate: application.contract.startDate,
            endDate: application.contract.endDate,
            periodYears: Number(leaseYears?.toFixed(1) ?? 0),
            remainingYears: Number(remainingYears?.toFixed(1) ?? 0),
            residentAgeGroup: application.residentAgeGroup,
            purpose: application.leasePurpose,
            headCount: application.occupantCount,
            remodelSummary: application.remodelSummary,
            managerContact: application.managerContact,
          }
        : null,
    };
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
