import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ApplicationStatus,
  AssetType,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHmac } from 'crypto';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminKanbanQueryDto } from './dto/admin-kanban-query.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminSummaryQueryDto } from './dto/admin-summary-query.dto';
import { AutofillHouseDto } from './dto/autofill-house.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import { ExtractDocumentsDto } from './dto/extract-documents.dto';
import {
  ApplicationDocumentType,
  QuickApplicationDto,
} from './dto/quick-application.dto';
import { RequestVerificationDto } from './dto/request-verification.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

interface VerificationCodeEntry {
  code: string;
  name: string;
  expiresAt: number;
}

type VerificationPurpose = 'APPLY' | 'LOOKUP';

interface SmsSendResult {
  ok: boolean;
  status?: number;
  providerCode?: string;
  providerMessage?: string;
}

export interface NearbyAttraction {
  name: string;
  distanceMeters: number | null;
  distanceText: string | null;
}

interface QuickApplicationUploadFiles {
  photos?: Express.Multer.File[];
  documents?: Express.Multer.File[];
}

const RANDOM_HOUSE_TYPES: AssetType[] = [
  AssetType.STONE_WALL_FIELD_HOUSE,
  AssetType.STONE_WALL_HOUSE,
  AssetType.DEMOLITION_HOUSE,
  AssetType.NO_STONE_WALL_HOUSE,
  AssetType.D_SHAPED_HOUSE,
  AssetType.URBAN_HOUSE_VILLA,
];

const LEGACY_ASSET_TYPES: AssetType[] = [
  AssetType.EMPTY_HOUSE,
  AssetType.WAREHOUSE,
  AssetType.FIELD,
  AssetType.OTHER,
];

interface DocumentSource {
  fileUrl: string;
  mimeType?: string;
}

export interface PdfExtractionResult {
  address: string | null;
  detectedAssetType: AssetType | null;
  detectedAreaSqm: number | null;
  detectedFloorCount: number | null;
  hasYard: boolean | null;
  hasParking: boolean | null;
  summary: string | null;
  warnings: string[];
  sourceCount: number;
}

export interface HouseAutoFillResult {
  address: string | null;
  eupMyeonDong: string | null;
  latitude: number | null;
  longitude: number | null;
  detectedAssetType: AssetType | null;
  detectedAreaSqm: number | null;
  detectedFloorCount: number | null;
  hasYard: boolean | null;
  hasParking: boolean | null;
  nearbyAttractions: NearbyAttraction[];
  strengthSummary: string | null;
  recommendedDirections: string[];
  recommendation: string | null;
  recommendationReason: string | null;
  warnings: string[];
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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
        contract: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMyApplicationsByToken(userId: string) {
    const applications = await this.findMyApplications(userId);
    return applications.map((application) => this.toApplicationCard(application));
  }

  async createQuick(
    userId: string,
    dto: QuickApplicationDto,
    uploadFiles: QuickApplicationUploadFiles = {},
    contentType?: string,
  ) {
    this.validateQuickApplicationUploadInput(dto, uploadFiles, contentType);

    const uploadedPhotoUrls = this.filesToDataUrls(uploadFiles.photos);
    const documentSources = this.buildDocumentSources(dto, uploadFiles.documents ?? []);
    const pdfExtracted = await this.extractPdfAutoFillFromDocuments(documentSources);
    const applicant = await this.getApplicantFromToken(userId);
    const applicantName = applicant.name;
    const autoFilled = await this.resolveAutoFillFromInput({
      address: dto.address ?? dto.detectedAddress ?? pdfExtracted?.address ?? undefined,
      latitude: dto.latitude,
      longitude: dto.longitude,
      assetType:
        dto.assetType ??
        dto.detectedAssetType ??
        pdfExtracted?.detectedAssetType ??
        undefined,
      areaSqm:
        dto.areaSqm ??
        dto.detectedAreaSqm ??
        pdfExtracted?.detectedAreaSqm ??
        undefined,
      floorCount: dto.floorCount ?? pdfExtracted?.detectedFloorCount ?? undefined,
      hasYard: dto.hasYard ?? pdfExtracted?.hasYard ?? undefined,
      hasParking: dto.hasParking ?? pdfExtracted?.hasParking ?? undefined,
      photoUrls: [...(dto.photoUrls ?? []), ...uploadedPhotoUrls],
    });

    const assetId = await this.createAssetForQuickApplication(
      applicant.id,
      dto,
      autoFilled,
      pdfExtracted,
      uploadedPhotoUrls,
      applicantName,
    );

    const application = await this.createApplicationRecord(applicant.id, assetId, applicantName, dto);

    await this.attachDocuments(applicant.id, application.id, dto, uploadFiles.documents);
    const tokens = await this.generateTokens(
      application.applicant.id,
      application.applicant.email,
      application.applicant.role,
    );

    return {
      ...application,
      statusLabel: this.statusLabel(application.status),
      autoFilled,
      pdfExtracted,
      ...tokens,
    };
  }

  async extractFromDocuments(
    dto: ExtractDocumentsDto,
    uploadedDocumentFiles: Express.Multer.File[] = [],
    contentType?: string,
  ) {
    const documentUrls = this.toStringArraySafe(dto.documentUrls);

    if (uploadedDocumentFiles.length === 0 && documentUrls.length === 0) {
      throw new BadRequestException(
        'documents 필드에 PDF 파일을 하나 이상 첨부해주세요.',
      );
    }

    if (uploadedDocumentFiles.length > 0) {
      if (!contentType?.includes('multipart/form-data')) {
        throw new BadRequestException('파일 업로드는 multipart/form-data로 요청해야 합니다.');
      }

      const maxSize = 10 * 1024 * 1024;
      for (const file of uploadedDocumentFiles) {
        if (!file.buffer || file.size <= 0) {
          throw new BadRequestException('업로드 파일 읽기에 실패했습니다.');
        }
        if (file.size > maxSize) {
          throw new BadRequestException('PDF 파일은 개당 10MB 이하만 허용됩니다.');
        }
        if (!this.isPdfUploadFile(file)) {
          throw new BadRequestException(
            'documents 필드에는 PDF 파일만 업로드할 수 있습니다.',
          );
        }
      }
    }

    const sources: DocumentSource[] = [
      ...uploadedDocumentFiles.map((file) => ({
        fileUrl: this.toDataUrl(file),
        mimeType: file.mimetype,
      })),
      ...documentUrls.map((fileUrl) => ({ fileUrl })),
    ];

    const extracted = await this.extractPdfAutoFillFromDocuments(sources);
    if (!extracted) {
      throw new ServiceUnavailableException(
        'PDF 자동분석을 수행할 수 없습니다. GEMINI 설정 또는 PDF 파일을 확인해주세요.',
      );
    }

    const autoFilled = await this.resolveAutoFillFromInput({
      address: extracted.address ?? undefined,
      assetType: extracted.detectedAssetType ?? undefined,
      areaSqm: extracted.detectedAreaSqm ?? undefined,
      floorCount: extracted.detectedFloorCount ?? undefined,
      hasYard: extracted.hasYard ?? undefined,
      hasParking: extracted.hasParking ?? undefined,
    });

    return {
      extracted,
      autoFilled,
    };
  }

  async autofillHouseInfo(dto: AutofillHouseDto): Promise<HouseAutoFillResult> {
    if (!dto.address && (dto.latitude == null || dto.longitude == null) && !dto.photoUrls?.length) {
      throw new BadRequestException(
        '자동입력을 위해 주소 또는 위도/경도 또는 사진 중 하나 이상이 필요합니다.',
      );
    }

    return this.resolveAutoFillFromInput(dto);
  }

  async analyzeMyApplication(userId: string, applicationId: string, role: UserRole) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
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

    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (application.applicantId !== userId && role !== UserRole.ADMIN) {
      throw new ForbiddenException('본인 신청 건만 분석할 수 있습니다.');
    }

    const autoFilled = await this.resolveAutoFillFromInput({
      address: application.asset.address,
      latitude: application.asset.latitude ?? undefined,
      longitude: application.asset.longitude ?? undefined,
      assetType: application.asset.assetType,
      areaSqm: application.asset.areaSqm ?? undefined,
      photoUrls: application.asset.images.map((image) => image.fileUrl),
    });

    return {
      applicationId: application.id,
      status: application.status,
      statusLabel: this.statusLabel(application.status),
      applicant: application.applicant,
      notes: application.businessIdea,
      analysis: {
        ...autoFilled,
        narrative: this.buildAnalysisNarrative(autoFilled),
      },
    };
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
            select: { id: true, name: true, phone: true, email: true, role: true },
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
      this.throwPrismaException(error, 'APPLICATION_CREATE');
    }
  }

  async requestCode(dto: RequestVerificationDto) {
    return this.requestVerificationCode(dto);
  }

  async verifyApplyCode(dto: VerifyCodeDto) {
    this.verifyCode(dto.phone, dto.code, 'APPLY', false, dto.name);
    return this.issueSmsVerifiedTokens(dto.name, dto.phone);
  }

  private async requestVerificationCode(dto: RequestVerificationDto) {
    const phone = this.normalizePhone(dto.phone);
    const name = dto.name.trim();
    const code = this.generateCode();
    const entry = {
      code,
      name,
      expiresAt: Date.now() + 3 * 60 * 1000,
    };
    // 인증번호 요청은 하나의 API로 통합: 조회/신청 검증 목적 키 모두 저장
    this.verificationCodes.set(this.verificationKey(phone, 'APPLY'), entry);
    this.verificationCodes.set(this.verificationKey(phone, 'LOOKUP'), entry);

    const smsResult = await this.sendVerificationCodeSms(phone, code);
    const isDevMode = this.configService.get<string>('app.nodeEnv') !== 'production';

    if (!smsResult.ok && this.isSmsConfigured()) {
      const debugReason = [
        smsResult.status ? `status=${smsResult.status}` : null,
        smsResult.providerCode ? `code=${smsResult.providerCode}` : null,
        smsResult.providerMessage ? `message=${smsResult.providerMessage}` : null,
      ]
        .filter((item) => item !== null)
        .join(', ');
      throw new ServiceUnavailableException(
        debugReason
          ? `인증번호 SMS 발송에 실패했습니다. (${debugReason})`
          : '인증번호 SMS 발송에 실패했습니다. 잠시 후 다시 시도해주세요.',
      );
    }

    return {
      message: smsResult.ok
        ? '인증번호를 전송했습니다.'
        : '인증번호가 발급되었습니다. (개발 모드)',
      expiresInSeconds: 180,
      ...(isDevMode && !smsResult.ok ? { code } : {}),
    };
  }

  async verifyAndLookup(dto: VerifyCodeDto) {
    this.verifyCode(dto.phone, dto.code, 'LOOKUP', true, dto.name);
    const phone = this.normalizePhone(dto.phone);
    const user = await this.findOrCreateSmsUser(dto.name, phone);
    const tokens = await this.generateTokens(user.id, user.email, user.role);

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
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      ...tokens,
      total: decorated.length,
      progressCount: inProgress.length,
      completedCount: completed.length,
      rejectedCount: rejected.length,
      inProgress,
      completed,
      rejected,
    };
  }

  async getMyApplicationDetail(
    userId: string,
    applicationId: string,
    role: UserRole,
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
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

    if (application.applicantId !== userId && role !== UserRole.ADMIN) {
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

  async cancelMyApplication(
    userId: string,
    applicationId: string,
    role: UserRole,
  ) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        applicant: {
          select: { id: true },
        },
      },
    });

    if (!application) {
      throw new NotFoundException('신청서를 찾을 수 없습니다.');
    }

    if (application.applicantId !== userId && role !== UserRole.ADMIN) {
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

  private async getApplicantFromToken(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('유효한 사용자 토큰이 필요합니다.');
    }
    return user;
  }

  private async createAssetForQuickApplication(
    ownerId: string,
    dto: QuickApplicationDto,
    autoFilled: HouseAutoFillResult,
    pdfExtracted: PdfExtractionResult | null,
    uploadedPhotoUrls: string[],
    applicantName: string,
  ): Promise<string> {
    const name = applicantName;
    const address =
      dto.address ??
      dto.detectedAddress ??
      pdfExtracted?.address ??
      autoFilled.address ??
      '주소 미입력';
    // 프론트에서 assetType을 받지 않고, 현재 정책상 랜덤 분류를 사용합니다.
    const assetType = this.pickRandomHouseAssetType();
    const areaSqm =
      dto.areaSqm ??
      dto.detectedAreaSqm ??
      pdfExtracted?.detectedAreaSqm ??
      autoFilled.detectedAreaSqm ??
      undefined;
    const latitude = dto.latitude ?? autoFilled.latitude ?? undefined;
    const longitude = dto.longitude ?? autoFilled.longitude ?? undefined;
    const mergedPhotoUrls = [...(dto.photoUrls ?? []), ...uploadedPhotoUrls];
    const analysisLines: string[] = [];
    if (autoFilled.eupMyeonDong) {
      analysisLines.push(`위치(읍면동): ${autoFilled.eupMyeonDong}`);
    }
    if (autoFilled.detectedFloorCount != null) {
      analysisLines.push(`층수: ${autoFilled.detectedFloorCount}층`);
    }
    if (autoFilled.hasYard != null) {
      analysisLines.push(`마당: ${autoFilled.hasYard ? '있음' : '없음'}`);
    }
    if (autoFilled.hasParking != null) {
      analysisLines.push(`주차: ${autoFilled.hasParking ? '가능' : '불가'}`);
    }
    if (autoFilled.nearbyAttractions.length > 0) {
      analysisLines.push(
        `주변 관광지: ${autoFilled.nearbyAttractions
          .map((item) =>
            item.distanceText ? `${item.name}(${item.distanceText})` : item.name,
          )
          .join(', ')}`,
      );
    }
    if (autoFilled.strengthSummary) {
      analysisLines.push(`강점 요약: ${autoFilled.strengthSummary}`);
    }
    if (autoFilled.recommendedDirections.length > 0) {
      analysisLines.push(`추천 방향: ${autoFilled.recommendedDirections.join(', ')}`);
    }
    if (autoFilled.recommendation) {
      analysisLines.push(`추천 설명: ${autoFilled.recommendation}`);
    }
    if (autoFilled.recommendationReason) {
      analysisLines.push(`근거: ${autoFilled.recommendationReason}`);
    }
    if (pdfExtracted?.summary) {
      analysisLines.push(`문서 요약: ${pdfExtracted.summary}`);
    }
    const aiRecommendation =
      analysisLines.length > 0 ? `\n\n[AI 매물 분석]\n${analysisLines.join('\n')}` : '';
    const createAsset = (resolvedAssetType: AssetType) =>
      this.prisma.asset.create({
        data: {
          ownerId,
          title: `${name} 신청 건`,
          assetType: resolvedAssetType,
          address,
          regionCode: 'JEJU-UNKNOWN',
          areaSqm,
          latitude,
          longitude,
          description: `${dto.notes ?? ''}${aiRecommendation}`.trim() || null,
          images: {
            create: mergedPhotoUrls.map((url, index) => ({
              fileUrl: url,
              sortOrder: index,
            })),
          },
        },
        select: { id: true },
      });

    const persistableAssetType = await this.resolvePersistableAssetType(assetType);

    let asset;
    try {
      asset = await createAsset(persistableAssetType);
    } catch (error) {
      if (this.isAssetTypeEnumMismatchError(error)) {
        try {
          asset = await createAsset(await this.resolvePersistableAssetType(this.pickLegacyAssetType()));
        } catch (retryError) {
          this.throwPrismaException(retryError, 'ASSET_CREATE_RETRY');
        }
      } else {
        this.throwPrismaException(error, 'ASSET_CREATE');
      }
    }

    return asset.id;
  }

  private async attachDocuments(
    userId: string,
    applicationId: string,
    dto: QuickApplicationDto,
    uploadedDocumentFiles: Express.Multer.File[] = [],
  ) {
    const documents = this.normalizeDocuments(dto);
    const uploadedDocuments = uploadedDocumentFiles.map((file) => ({
      fileUrl: this.toDataUrl(file),
      type: ApplicationDocumentType.OTHER,
      originalName: file.originalname || `${uuidv4()}.dat`,
      mimeType: file.mimetype || 'application/octet-stream',
      fileSizeBytes: file.size ?? 0,
    }));

    if (documents.length === 0 && uploadedDocuments.length === 0) {
      return;
    }

    try {
      await this.prisma.file.createMany({
        data: [
          ...documents.map((document) => {
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
          ...uploadedDocuments.map((document) => {
            const storedName = `${uuidv4()}-${document.originalName}`;
            return {
              uploadedBy: userId,
              originalName: document.originalName,
              storedName,
              fileUrl: document.fileUrl,
              mimeType: document.mimeType,
              fileSizeBytes: document.fileSizeBytes,
              refType: `APPLICATION_DOC_${document.type}`,
              refId: applicationId,
            };
          }),
        ],
      });
    } catch (error) {
      this.throwPrismaException(error, 'DOCUMENT_ATTACH');
    }
  }

  private validateQuickApplicationUploadInput(
    dto: QuickApplicationDto,
    uploadFiles: QuickApplicationUploadFiles,
    contentType?: string,
  ) {
    const photoCount = uploadFiles.photos?.length ?? 0;
    const docCount = uploadFiles.documents?.length ?? 0;
    const totalUploadCount = photoCount + docCount;

    if (totalUploadCount === 0) {
      return;
    }

    if (!contentType?.includes('multipart/form-data')) {
      throw new BadRequestException('파일 업로드는 multipart/form-data로 요청해야 합니다.');
    }

    if (photoCount > 20) {
      throw new BadRequestException('집 사진은 최대 20개까지 업로드할 수 있습니다.');
    }

    if (docCount > 20) {
      throw new BadRequestException('관련 서류는 최대 20개까지 업로드할 수 있습니다.');
    }

    const maxSize = 10 * 1024 * 1024;
    for (const file of [...(uploadFiles.photos ?? []), ...(uploadFiles.documents ?? [])]) {
      if (!file.buffer || file.size <= 0) {
        throw new BadRequestException('업로드 파일 읽기에 실패했습니다.');
      }
      if (file.size > maxSize) {
        throw new BadRequestException('업로드 파일은 개당 10MB 이하만 허용됩니다.');
      }
    }

    if ((dto.photoUrls?.length ?? 0) > 0 && photoCount > 0) {
      // URL + 업로드 동시 사용 허용
    }
  }

  private filesToDataUrls(files: Express.Multer.File[] | undefined): string[] {
    if (!files || files.length === 0) {
      return [];
    }

    return files.map((file) => this.toDataUrl(file));
  }

  private toDataUrl(file: Express.Multer.File): string {
    if (!file.buffer) {
      throw new BadRequestException('업로드 파일 데이터가 비어 있습니다.');
    }

    const mimeType = file.mimetype?.trim() || 'application/octet-stream';
    const base64 = file.buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  }

  private toStringArraySafe(value: unknown): string[] {
    if (value == null || value === '') {
      return [];
    }

    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
        }
      } catch {
        return [trimmed];
      }

      return [trimmed];
    }

    return [];
  }

  private isPdfUploadFile(file: Express.Multer.File): boolean {
    const mime = (file.mimetype ?? '').toLowerCase();
    const originalName = (file.originalname ?? '').toLowerCase();
    if (mime.includes('pdf') || originalName.endsWith('.pdf')) {
      return true;
    }

    if (!file.buffer || file.buffer.length < 4) {
      return false;
    }

    return file.buffer.subarray(0, 4).toString('ascii') === '%PDF';
  }

  private async issueSmsVerifiedTokens(nameRaw: string, phoneRaw: string) {
    const normalizedName = nameRaw.trim();
    const phone = this.normalizePhone(phoneRaw);
    const user = await this.findOrCreateSmsUser(normalizedName, phone);
    const tokens = await this.generateTokens(user.id, user.email, user.role);

    return {
      verified: true,
      message: '인증번호가 확인되었습니다.',
      user: {
        id: user.id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
      ...tokens,
    };
  }

  private async findOrCreateSmsUser(nameRaw: string, normalizedPhone: string) {
    const name = nameRaw.trim();
    const existing = await this.prisma.user.findFirst({
      where: { phone: normalizedPhone },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name,
        },
      });
    }

    const email = `sms-${normalizedPhone.replace(/[^0-9]/g, '')}-${uuidv4()}@placeholder.local`;
    const passwordHash = await bcrypt.hash(uuidv4(), 10);

    return this.prisma.user.create({
      data: {
        name,
        phone: normalizedPhone,
        email,
        passwordHash,
        role: UserRole.ELDER,
      },
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

  private verificationKey(phone: string, purpose: VerificationPurpose): string {
    return `${purpose}:${phone}`;
  }

  private verifyCode(
    phoneRaw: string,
    code: string,
    purpose: VerificationPurpose = 'LOOKUP',
    consume = true,
    expectedName?: string,
  ): void {
    const phone = this.normalizePhone(phoneRaw);
    const key = this.verificationKey(phone, purpose);
    const current = this.verificationCodes.get(key);

    if (!current) {
      throw new UnauthorizedException('인증번호를 먼저 요청해주세요.');
    }

    if (Date.now() > current.expiresAt) {
      this.verificationCodes.delete(key);
      throw new UnauthorizedException('인증번호가 만료되었습니다.');
    }

    if (current.code !== code) {
      throw new UnauthorizedException('인증번호가 올바르지 않습니다.');
    }

    if (expectedName && current.name !== expectedName.trim()) {
      throw new UnauthorizedException('이름 또는 인증번호가 올바르지 않습니다.');
    }

    if (consume) {
      this.verificationCodes.delete(key);
    }
  }

  private isSmsConfigured(): boolean {
    const apiKey = this.configService.get<string>('sms.solapiApiKey');
    const apiSecret = this.configService.get<string>('sms.solapiApiSecret');
    const sender = this.configService.get<string>('sms.solapiSender');
    return Boolean(apiKey && apiSecret && sender);
  }

  private async sendVerificationCodeSms(
    toPhone: string,
    code: string,
  ): Promise<SmsSendResult> {
    const baseUrlRaw =
      this.configService.get<string>('sms.solapiBaseUrl') ?? 'https://api.solapi.com';
    const apiKey = this.configService.get<string>('sms.solapiApiKey');
    const apiSecret = this.configService.get<string>('sms.solapiApiSecret');
    const sender = this.configService.get<string>('sms.solapiSender');
    const timeoutMs = this.configService.get<number>('sms.timeoutMs') ?? 5000;

    if (!baseUrlRaw || !apiKey || !apiSecret || !sender) {
      return { ok: false, providerMessage: 'SOLAPI 설정값 누락' };
    }

    const formattedTo = this.formatSolapiPhone(toPhone);
    const formattedSender = this.formatSolapiPhone(sender);
    const baseUrl = baseUrlRaw.replace(/\/+$/, '');
    const endpoint = `${baseUrl}/messages/v4/send`;
    const message = `[제주 리-빌리지] 인증번호 ${code} (3분 유효)`;
    const date = new Date().toISOString();
    const salt = uuidv4();
    const signature = createHmac('sha256', apiSecret)
      .update(date + salt)
      .digest('hex');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          message: {
            to: formattedTo,
            from: formattedSender,
            text: message,
          },
        }),
        signal: controller.signal,
      });
      let providerCode: string | undefined;
      let providerMessage: string | undefined;
      try {
        const body = (await response.json()) as
          | { errorCode?: string; errorMessage?: string; message?: string }
          | undefined;
        providerCode = body?.errorCode;
        providerMessage = body?.errorMessage ?? body?.message;
      } catch {
        // noop
      }

      return {
        ok: response.ok,
        status: response.status,
        providerCode,
        providerMessage,
      };
    } catch {
      return { ok: false, providerMessage: 'SOLAPI 요청 실패(네트워크/타임아웃)' };
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatSolapiPhone(phone: string): string {
    const trimmed = phone.trim();
    if (!/^\+?[0-9-]+$/.test(trimmed)) {
      return trimmed;
    }

    const digits = trimmed.replace(/[^0-9]/g, '');
    if (digits.startsWith('82') && digits.length >= 11) {
      return `0${digits.slice(2)}`;
    }

    return digits;
  }

  private extractFilename(url: string): string {
    if (url.startsWith('data:')) {
      return `${uuidv4()}.bin`;
    }

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

  private buildDocumentSources(
    dto: QuickApplicationDto,
    uploadedDocumentFiles: Express.Multer.File[],
  ): DocumentSource[] {
    const normalizedDocuments = this.normalizeDocuments(dto);
    return [
      ...normalizedDocuments.map((document) => ({ fileUrl: document.fileUrl })),
      ...uploadedDocumentFiles.map((file) => ({
        fileUrl: this.toDataUrl(file),
        mimeType: file.mimetype,
      })),
    ];
  }

  private async extractPdfAutoFillFromDocuments(
    sources: DocumentSource[],
  ): Promise<PdfExtractionResult | null> {
    if (sources.length === 0) {
      return null;
    }

    const geminiApiKey = this.configService.get<string>('ai.geminiApiKey');
    const geminiModel = this.configService.get<string>('ai.geminiModel');
    const geminiBaseUrl = this.configService.get<string>('ai.geminiBaseUrl');
    const warnings: string[] = [];

    if (!geminiApiKey || !geminiModel || !geminiBaseUrl) {
      return {
        address: null,
        detectedAssetType: null,
        detectedAreaSqm: null,
        detectedFloorCount: null,
        hasYard: null,
        hasParking: null,
        summary: null,
        warnings: ['GEMINI_API_KEY가 설정되지 않아 PDF 자동분석을 건너뜁니다.'],
        sourceCount: 0,
      };
    }

    const inlineParts = (
      await Promise.all(
        sources.slice(0, 5).map((source) => this.toPdfInlineData(source.fileUrl, source.mimeType)),
      )
    ).filter((part): part is { inline_data: { mime_type: string; data: string } } => part !== null);

    if (inlineParts.length === 0) {
      return {
        address: null,
        detectedAssetType: null,
        detectedAreaSqm: null,
        detectedFloorCount: null,
        hasYard: null,
        hasParking: null,
        summary: null,
        warnings: ['PDF 형식 문서를 찾지 못해 자동분석을 건너뜁니다.'],
        sourceCount: 0,
      };
    }

    const prompt = [
      '다음 첨부 문서는 제주 빈집 신청 관련 PDF(등기부등본, 건축물대장, 토지대장 등)입니다.',
      '문서에서 신청 화면 자동입력에 필요한 항목을 추출하세요.',
      '반드시 JSON만 반환하고 markdown/code block을 사용하지 마세요.',
      'JSON schema:',
      '{"address":"string|null","detectedAssetType":"STONE_WALL_FIELD_HOUSE|STONE_WALL_HOUSE|DEMOLITION_HOUSE|NO_STONE_WALL_HOUSE|D_SHAPED_HOUSE|URBAN_HOUSE_VILLA|EMPTY_HOUSE|WAREHOUSE|FIELD|OTHER|null","detectedAreaSqm":number|null,"detectedFloorCount":number|null,"hasYard":true|false|null,"hasParking":true|false|null,"summary":"string|null"}',
      '규칙:',
      '- 값이 불확실하면 null',
      '- detectedAreaSqm는 제곱미터(m2) 기준 숫자',
      '- summary는 어르신도 이해하기 쉬운 1~2문장 요약',
      '- detectedAssetType은 실제 건물 특성으로 분류',
    ].join('\n');

    const endpoint = `${geminiBaseUrl}/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, ...inlineParts],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        return {
          address: null,
          detectedAssetType: null,
          detectedAreaSqm: null,
          detectedFloorCount: null,
          hasYard: null,
          hasParking: null,
          summary: null,
          warnings: ['Gemini PDF 분석 호출에 실패했습니다.'],
          sourceCount: inlineParts.length,
        };
      }

      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      const parsed = this.parseGeminiJson(text);

      if (!parsed) {
        warnings.push('PDF 분석 결과 JSON 파싱에 실패했습니다.');
      }

      return {
        address:
          parsed && typeof parsed.address === 'string' ? parsed.address.trim() || null : null,
        detectedAssetType: this.toAssetType(
          parsed && typeof parsed.detectedAssetType === 'string'
            ? parsed.detectedAssetType
            : undefined,
        ),
        detectedAreaSqm: this.toPositiveInt(parsed?.detectedAreaSqm),
        detectedFloorCount: this.toPositiveInt(parsed?.detectedFloorCount),
        hasYard: this.coerceBoolean(parsed?.hasYard),
        hasParking: this.coerceBoolean(parsed?.hasParking),
        summary:
          parsed && typeof parsed.summary === 'string' ? parsed.summary.trim() || null : null,
        warnings,
        sourceCount: inlineParts.length,
      };
    } catch {
      return {
        address: null,
        detectedAssetType: null,
        detectedAreaSqm: null,
        detectedFloorCount: null,
        hasYard: null,
        hasParking: null,
        summary: null,
        warnings: ['Gemini PDF 분석 중 네트워크 오류가 발생했습니다.'],
        sourceCount: inlineParts.length,
      };
    }
  }

  private async resolveAutoFillFromInput(dto: AutofillHouseDto): Promise<HouseAutoFillResult> {
    const result: HouseAutoFillResult = {
      address: dto.address ?? null,
      eupMyeonDong: this.extractEupMyeonDong(dto.address ?? null),
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      detectedAssetType: dto.assetType ?? null,
      detectedAreaSqm: dto.areaSqm ?? null,
      detectedFloorCount: dto.floorCount ?? null,
      hasYard: dto.hasYard ?? null,
      hasParking: dto.hasParking ?? null,
      nearbyAttractions: [],
      strengthSummary: null,
      recommendedDirections: [],
      recommendation: null,
      recommendationReason: null,
      warnings: [],
    };
    const addWarning = (message: string) => {
      if (!result.warnings.includes(message)) {
        result.warnings.push(message);
      }
    };

    const hasGpsKey = Boolean(this.configService.get<string>('ai.gpsApiKey'));
    const hasGeminiKey = Boolean(this.configService.get<string>('ai.geminiApiKey'));
    const hasTourKey = Boolean(this.configService.get<string>('ai.tourApiKey'));

    if (!result.address && result.latitude != null && result.longitude != null) {
      try {
        const reverseAddress = await this.reverseGeocode(result.latitude, result.longitude);
        if (reverseAddress) {
          result.address = reverseAddress;
          result.eupMyeonDong = this.extractEupMyeonDong(reverseAddress);
        } else if (!hasGpsKey) {
          addWarning('GPS_API_KEY가 설정되지 않아 주소 자동입력을 건너뜁니다.');
        }
      } catch {
        addWarning('GPS 역지오코딩에 실패했습니다. 주소를 직접 입력해주세요.');
      }
    }

    if ((!result.latitude || !result.longitude) && result.address) {
      try {
        const geocoded = await this.geocodeAddress(result.address);
        if (geocoded) {
          result.latitude = geocoded.latitude;
          result.longitude = geocoded.longitude;
          result.address = geocoded.address ?? result.address;
          result.eupMyeonDong = this.extractEupMyeonDong(result.address);
        } else if (!hasGpsKey) {
          addWarning('GPS_API_KEY가 설정되지 않아 좌표 자동입력을 건너뜁니다.');
        }
      } catch {
        addWarning('주소 기반 좌표 자동입력에 실패했습니다.');
      }
    }

    if (result.latitude != null && result.longitude != null) {
      try {
        const nearby = await this.findNearbyAttractions(result.latitude, result.longitude);
        if (nearby) {
          result.nearbyAttractions = nearby;
        } else if (!hasTourKey) {
          addWarning('TOUR_API_KEY가 설정되지 않아 주변 관광지 분석을 건너뜁니다.');
        }
      } catch {
        addWarning('주변 관광지 거리 분석에 실패했습니다.');
      }
    }

    if (dto.photoUrls?.length) {
      const aiRecommendation = await this.recommendByGemini(dto.photoUrls, result);
      if (aiRecommendation) {
        result.recommendation = aiRecommendation.recommendation;
        result.recommendationReason = aiRecommendation.reason;
        result.strengthSummary = aiRecommendation.strengthSummary;
        result.recommendedDirections = aiRecommendation.recommendedDirections;

        if (!result.detectedAssetType && aiRecommendation.detectedAssetType) {
          result.detectedAssetType = aiRecommendation.detectedAssetType;
        }
        if (!result.detectedAreaSqm && aiRecommendation.detectedAreaSqm) {
          result.detectedAreaSqm = aiRecommendation.detectedAreaSqm;
        }
        if (!result.detectedFloorCount && aiRecommendation.detectedFloorCount) {
          result.detectedFloorCount = aiRecommendation.detectedFloorCount;
        }
        if (result.hasYard == null && aiRecommendation.hasYard != null) {
          result.hasYard = aiRecommendation.hasYard;
        }
        if (result.hasParking == null && aiRecommendation.hasParking != null) {
          result.hasParking = aiRecommendation.hasParking;
        }
      } else {
        addWarning(
          hasGeminiKey
            ? '사진 기반 AI 추천 생성에 실패했습니다.'
            : 'GEMINI_API_KEY가 설정되지 않아 AI 추천을 건너뜁니다.',
        );
      }
    }

    const fallback = this.buildRuleBasedRecommendation(result);
    if (!result.strengthSummary) {
      result.strengthSummary = fallback.strengthSummary;
    }
    if (result.recommendedDirections.length === 0) {
      result.recommendedDirections = fallback.recommendedDirections;
    }
    if (!result.recommendation) {
      result.recommendation = fallback.recommendation;
    }
    if (!result.recommendationReason) {
      result.recommendationReason = fallback.recommendationReason;
    }

    return result;
  }

  private async geocodeAddress(address: string): Promise<{
    latitude: number;
    longitude: number;
    address: string | null;
  } | null> {
    const apiKey = this.configService.get<string>('ai.gpsApiKey');
    const baseUrl = this.configService.get<string>('ai.gpsGeocodeUrl');
    if (!apiKey || !baseUrl) {
      return null;
    }

    const url = `${baseUrl}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      status?: string;
      results?: Array<{
        formatted_address?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      }>;
    };
    if (data.status !== 'OK' || !data.results?.length) {
      return null;
    }

    const first = data.results[0];
    const lat = first.geometry?.location?.lat;
    const lng = first.geometry?.location?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return null;
    }

    return {
      latitude: lat,
      longitude: lng,
      address: first.formatted_address ?? null,
    };
  }

  private async reverseGeocode(latitude: number, longitude: number): Promise<string | null> {
    const apiKey = this.configService.get<string>('ai.gpsApiKey');
    const baseUrl = this.configService.get<string>('ai.gpsReverseGeocodeUrl');
    if (!apiKey || !baseUrl) {
      return null;
    }

    const url = `${baseUrl}?latlng=${latitude},${longitude}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string }>;
    };
    if (data.status !== 'OK' || !data.results?.length) {
      return null;
    }

    return data.results[0]?.formatted_address ?? null;
  }

  private async findNearbyAttractions(
    latitude: number,
    longitude: number,
  ): Promise<NearbyAttraction[] | null> {
    const apiKey = this.configService.get<string>('ai.tourApiKey');
    const baseUrl = this.configService.get<string>('ai.tourApiBaseUrl');
    const mobileOs = this.configService.get<string>('ai.tourMobileOs') ?? 'ETC';
    const mobileApp = this.configService.get<string>('ai.tourMobileApp') ?? 'JejuReVillage';
    const radius = this.configService.get<number>('ai.tourRadiusMeters') ?? 3000;
    const numRows = this.configService.get<number>('ai.tourNumRows') ?? 5;
    if (!apiKey || !baseUrl) {
      return null;
    }

    const serviceKey = apiKey.includes('%') ? apiKey : encodeURIComponent(apiKey);
    const url =
      `${baseUrl}?serviceKey=${serviceKey}` +
      `&numOfRows=${numRows}&pageNo=1&MobileOS=${encodeURIComponent(mobileOs)}` +
      `&MobileApp=${encodeURIComponent(mobileApp)}&_type=json&arrange=E&listYN=Y` +
      `&mapX=${longitude}&mapY=${latitude}&radius=${radius}`;

    const response = await fetch(url);
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      response?: {
        body?: {
          items?: {
            item?:
              | Array<{ title?: string; dist?: string | number }>
              | { title?: string; dist?: string | number };
          };
        };
      };
    };
    const raw = data.response?.body?.items?.item;
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return items
      .map((item) => {
        const name = item.title?.trim();
        if (!name) {
          return null;
        }
        const distanceRaw =
          typeof item.dist === 'number' ? item.dist : Number(item.dist ?? Number.NaN);
        const distanceMeters = Number.isFinite(distanceRaw) ? Math.round(distanceRaw) : null;
        return {
          name,
          distanceMeters,
          distanceText: this.formatDistance(distanceMeters),
        };
      })
      .filter((item): item is NearbyAttraction => item !== null)
      .slice(0, 5);
  }

  private async recommendByGemini(
    photoUrls: string[],
    context: {
      address: string | null;
      eupMyeonDong: string | null;
      detectedAssetType: AssetType | null;
      detectedAreaSqm: number | null;
      detectedFloorCount: number | null;
      hasYard: boolean | null;
      hasParking: boolean | null;
      nearbyAttractions: NearbyAttraction[];
    },
  ): Promise<{
    recommendation: string;
    reason: string | null;
    detectedAssetType: AssetType | null;
    detectedAreaSqm: number | null;
    detectedFloorCount: number | null;
    hasYard: boolean | null;
    hasParking: boolean | null;
    strengthSummary: string | null;
    recommendedDirections: string[];
  } | null> {
    const geminiApiKey = this.configService.get<string>('ai.geminiApiKey');
    const geminiModel = this.configService.get<string>('ai.geminiModel');
    const geminiBaseUrl = this.configService.get<string>('ai.geminiBaseUrl');
    if (!geminiApiKey || !geminiModel || !geminiBaseUrl) {
      return null;
    }

    const imageParts = (
      await Promise.all(photoUrls.slice(0, 3).map((url) => this.fetchImageInlineData(url)))
    ).filter((part): part is { inline_data: { mime_type: string; data: string } } => part !== null);

    if (imageParts.length === 0) {
      return null;
    }

    const prompt = [
      '다음은 제주 빈집/건물 사진과 위치 정보입니다.',
      '어르신이 이해하기 쉬운 한국어로 매물 분석을 작성하세요.',
      '반드시 JSON만 반환하고 markdown/code block을 사용하지 마세요.',
      'JSON schema:',
      '{"strengthSummary":"string","recommendedDirections":["string"],"recommendation":"string","recommendationReason":"string","detectedAssetType":"STONE_WALL_FIELD_HOUSE|STONE_WALL_HOUSE|DEMOLITION_HOUSE|NO_STONE_WALL_HOUSE|D_SHAPED_HOUSE|URBAN_HOUSE_VILLA|EMPTY_HOUSE|WAREHOUSE|FIELD|OTHER|null","detectedAreaSqm":number|null,"detectedFloorCount":number|null,"hasYard":true|false|null,"hasParking":true|false|null}',
      '출력 규칙:',
      '- strengthSummary: 한 줄 강점 요약(15~45자)',
      '- recommendedDirections: 2~4개 운영 방향',
      '- recommendation: 2~4문장 설명',
      '- recommendationReason: 추천 근거 한 줄',
      '입력 정보:',
      `- 주소: ${context.address ?? '미제공'}`,
      `- 읍면동: ${context.eupMyeonDong ?? '미제공'}`,
      `- 건물유형(기입값): ${context.detectedAssetType ?? '미제공'}`,
      `- 면적(기입값): ${context.detectedAreaSqm ?? '미제공'}`,
      `- 층수(기입값): ${context.detectedFloorCount ?? '미제공'}`,
      `- 마당(기입값): ${
        context.hasYard == null ? '미제공' : context.hasYard ? '있음' : '없음'
      }`,
      `- 주차(기입값): ${
        context.hasParking == null ? '미제공' : context.hasParking ? '가능' : '불가'
      }`,
      `- 주변 관광지: ${
        context.nearbyAttractions.length > 0
          ? context.nearbyAttractions
              .map((item) => `${item.name}(${item.distanceText ?? '거리확인필요'})`)
              .join(', ')
          : '미제공'
      }`,
    ].join('\n');

    const endpoint = `${geminiBaseUrl}/v1beta/models/${geminiModel}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    if (!text) {
      return null;
    }

    const parsed = this.parseGeminiJson(text);
    if (!parsed) {
      return {
        recommendation: text.slice(0, 500),
        reason: null,
        detectedAssetType: null,
        detectedAreaSqm: null,
        detectedFloorCount: null,
        hasYard: null,
        hasParking: null,
        strengthSummary: null,
        recommendedDirections: [],
      };
    }

    const recommendation =
      typeof parsed.recommendation === 'string' ? parsed.recommendation.trim() : '';
    if (!recommendation) {
      return null;
    }

    const directions =
      Array.isArray(parsed.recommendedDirections) && parsed.recommendedDirections.length > 0
        ? parsed.recommendedDirections
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .slice(0, 4)
        : [];

    return {
      recommendation,
      reason:
        typeof parsed.recommendationReason === 'string'
          ? parsed.recommendationReason.trim()
          : typeof parsed.reason === 'string'
            ? parsed.reason.trim()
            : null,
      detectedAssetType: this.toAssetType(
        typeof parsed.detectedAssetType === 'string' ? parsed.detectedAssetType : undefined,
      ),
      detectedAreaSqm: this.toPositiveInt(parsed.detectedAreaSqm),
      detectedFloorCount: this.toPositiveInt(parsed.detectedFloorCount),
      hasYard: this.coerceBoolean(parsed.hasYard),
      hasParking: this.coerceBoolean(parsed.hasParking),
      strengthSummary:
        typeof parsed.strengthSummary === 'string' ? parsed.strengthSummary.trim() : null,
      recommendedDirections: directions,
    };
  }

  private buildRuleBasedRecommendation(result: HouseAutoFillResult): {
    strengthSummary: string;
    recommendedDirections: string[];
    recommendation: string;
    recommendationReason: string;
  } {
    const directions = new Set<string>();
    const nearest = result.nearbyAttractions[0];
    const nearTourSpot =
      nearest?.distanceMeters != null ? nearest.distanceMeters <= 1500 : false;

    if (result.hasYard) {
      directions.add('게스트하우스/감성숙소 운영');
      directions.add('작가·창작자 작업실 임대');
    }

    if (result.detectedAreaSqm != null && result.detectedAreaSqm <= 66) {
      directions.add('1인 장기임대');
      directions.add('재택근무자 대상 한 달 살기');
      directions.add('소규모 공방 운영');
    }

    if (nearTourSpot) {
      directions.add('에어비앤비형 단기임대');
      directions.add('카페·소품샵 전환');
      directions.add('웰니스 프로그램 공간');
    }

    if (result.detectedAssetType === AssetType.FIELD) {
      directions.add('텃밭 체험형 농촌 프로그램');
    }

    if (directions.size === 0) {
      directions.add('장기 거주형 임대');
      directions.add('로컬 생활형 소규모 창업 공간');
    }

    const directionList = Array.from(directions).slice(0, 4);
    const location = result.eupMyeonDong ?? (result.address ? this.extractEupMyeonDong(result.address) : null);
    const locationLabel = location ?? '제주 지역';
    const attractionLabel =
      nearest && nearest.distanceText
        ? `${nearest.name} ${nearest.distanceText}`
        : nearest
          ? `${nearest.name} 인근`
          : null;

    const strengthSummary = attractionLabel
      ? `${locationLabel} ${attractionLabel}로 접근성 좋은 매물`
      : `${locationLabel} 조용한 생활권의 활용도 높은 매물`;

    const recommendation = [
      result.hasYard
        ? '마당이 있어 감성 숙소나 작업실 형태로 구성하기 좋은 구조입니다.'
        : '유지보수 부담이 비교적 적어 임대 운영을 시작하기 수월합니다.',
      nearTourSpot
        ? '관광지 접근성이 좋아 단기 체류 수요를 노린 운영이 유리합니다.'
        : '생활권 중심 수요를 겨냥한 장기임대 운영이 안정적입니다.',
      `추천 운영 방향은 ${directionList.join(', ')} 입니다.`,
      '직접 운영이 부담되면 임대 형태로 시작해도 꾸준한 수익화를 기대할 수 있습니다.',
    ].join(' ');

    const recommendationReason = attractionLabel
      ? `${attractionLabel} 접근성과 현장 특성을 기준으로 추천했습니다.`
      : '입력된 위치/면적/공간 특성을 기반으로 추천했습니다.';

    return {
      strengthSummary,
      recommendedDirections: directionList,
      recommendation,
      recommendationReason,
    };
  }

  private buildAnalysisNarrative(result: HouseAutoFillResult): string {
    const location = result.eupMyeonDong ?? result.address ?? '위치 확인 필요';
    const nearestAttraction = result.nearbyAttractions[0];
    const attractionText = nearestAttraction
      ? nearestAttraction.distanceText
        ? `${nearestAttraction.name} ${nearestAttraction.distanceText}`
        : `${nearestAttraction.name} 인근`
      : '주변 관광지 확인 필요';
    const areaText = result.detectedAreaSqm ? `${result.detectedAreaSqm}㎡` : '확인 필요';
    const floorText = result.detectedFloorCount ? `${result.detectedFloorCount}층` : '확인 필요';
    const yardText =
      result.hasYard == null ? '확인 필요' : result.hasYard ? '있음' : '없음';
    const parkingText =
      result.hasParking == null ? '확인 필요' : result.hasParking ? '가능' : '불가';
    const strength = result.strengthSummary ?? '생활권 접근성과 공간 활용성이 좋은 매물';
    const directions =
      result.recommendedDirections.length > 0
        ? result.recommendedDirections.join(', ')
        : '장기 임대 또는 소규모 창업 공간 활용';
    const recommendation =
      result.recommendation ??
      '직접 운영이 부담되면 임대 중심으로 시작해도 꾸준한 수익화를 기대할 수 있습니다.';

    return [
      `매물 분석`,
      `위치: ${location}`,
      `관광지 거리: ${attractionText}`,
      `면적: ${areaText}`,
      `층수: ${floorText}`,
      `마당: ${yardText}`,
      `주차: ${parkingText}`,
      `이 집의 강점: ${strength}`,
      `추천 방향: ${directions}`,
      recommendation,
    ].join('\n');
  }

  private extractEupMyeonDong(address: string | null): string | null {
    if (!address) {
      return null;
    }

    const tokens = address
      .replace(/,/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    const match = tokens.find((token) => /[가-힣0-9]+(읍|면|동|리|가)$/.test(token));
    return match ?? null;
  }

  private formatDistance(distanceMeters: number | null): string | null {
    if (distanceMeters == null || distanceMeters < 0) {
      return null;
    }
    if (distanceMeters < 1000) {
      return `${distanceMeters}m`;
    }
    return `${(distanceMeters / 1000).toFixed(1)}km`;
  }

  private toPositiveInt(value: unknown): number | null {
    const normalized =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(normalized) || normalized <= 0) {
      return null;
    }
    return Math.round(normalized);
  }

  private coerceBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
      return null;
    }
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (['true', 'yes', 'y', '1', '있음', '가능'].includes(lower)) return true;
      if (['false', 'no', 'n', '0', '없음', '불가'].includes(lower)) return false;
    }
    return null;
  }

  private parseGeminiJson(text: string): Record<string, unknown> | null {
    const tryParse = (raw: string): Record<string, unknown> | null => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
      return null;
    };

    const trimmed = text.trim();
    const parsedDirect = tryParse(trimmed);
    if (parsedDirect) {
      return parsedDirect;
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      const parsedFenced = tryParse(fenced.trim());
      if (parsedFenced) {
        return parsedFenced;
      }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return tryParse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    return null;
  }

  private async toPdfInlineData(
    url: string,
    mimeTypeHint?: string,
  ): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
    try {
      const dataUrlMatch = url.match(/^data:(.+?);base64,(.+)$/);
      if (dataUrlMatch) {
        const [, mimeType, base64] = dataUrlMatch;
        const normalizedMime = (mimeType || mimeTypeHint || '').toLowerCase();
        const isPdfMime = normalizedMime.includes('pdf');
        const isPdfBySignature = this.looksLikePdfBase64(base64);
        if (!isPdfMime && !isPdfBySignature) {
          return null;
        }
        if (!base64 || base64.length === 0) {
          return null;
        }
        return {
          inline_data: {
            mime_type: 'application/pdf',
            data: base64,
          },
        };
      }

      const hinted = (mimeTypeHint ?? '').toLowerCase();
      const isPdfByHint = hinted === 'application/pdf' || url.toLowerCase().includes('.pdf');
      if (!isPdfByHint) {
        return null;
      }

      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }

      const contentType = (response.headers.get('content-type') ?? hinted).toLowerCase();
      if (!contentType.includes('application/pdf')) {
        return null;
      }

      const data = Buffer.from(await response.arrayBuffer()).toString('base64');
      if (!data) {
        return null;
      }

      return {
        inline_data: {
          mime_type: 'application/pdf',
          data,
        },
      };
    } catch {
      return null;
    }
  }

  private looksLikePdfBase64(base64: string): boolean {
    if (!base64) {
      return false;
    }

    try {
      const head = Buffer.from(base64.slice(0, 64), 'base64');
      return head.subarray(0, 4).toString('ascii') === '%PDF';
    } catch {
      return false;
    }
  }

  private async fetchImageInlineData(
    url: string,
  ): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
    try {
      const dataUrlMatch = url.match(/^data:(.+?);base64,(.+)$/);
      if (dataUrlMatch) {
        const [, mimeType, base64] = dataUrlMatch;
        if (!base64 || base64.length === 0) {
          return null;
        }
        return {
          inline_data: {
            mime_type: mimeType || 'image/jpeg',
            data: base64,
          },
        };
      }

      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const contentType = response.headers.get('content-type') ?? 'image/jpeg';
      const bytes = Buffer.from(await response.arrayBuffer()).toString('base64');
      return {
        inline_data: {
          mime_type: contentType,
          data: bytes,
        },
      };
    } catch {
      return null;
    }
  }

  private toAssetType(value: string | undefined): AssetType | null {
    if (!value) return null;
    const upper = value.trim().toUpperCase();
    if (upper === AssetType.STONE_WALL_FIELD_HOUSE) return AssetType.STONE_WALL_FIELD_HOUSE;
    if (upper === AssetType.STONE_WALL_HOUSE) return AssetType.STONE_WALL_HOUSE;
    if (upper === AssetType.DEMOLITION_HOUSE) return AssetType.DEMOLITION_HOUSE;
    if (upper === AssetType.NO_STONE_WALL_HOUSE) return AssetType.NO_STONE_WALL_HOUSE;
    if (upper === AssetType.D_SHAPED_HOUSE) return AssetType.D_SHAPED_HOUSE;
    if (upper === AssetType.URBAN_HOUSE_VILLA) return AssetType.URBAN_HOUSE_VILLA;
    if (upper === AssetType.EMPTY_HOUSE) return AssetType.EMPTY_HOUSE;
    if (upper === AssetType.WAREHOUSE) return AssetType.WAREHOUSE;
    if (upper === AssetType.FIELD) return AssetType.FIELD;
    if (upper === AssetType.OTHER) return AssetType.OTHER;

    const normalized = value.replace(/\s+/g, '');
    if (normalized === '돌담+밭주택') return AssetType.STONE_WALL_FIELD_HOUSE;
    if (normalized === '돌담주택') return AssetType.STONE_WALL_HOUSE;
    if (normalized === '철거주택') return AssetType.DEMOLITION_HOUSE;
    if (normalized === '돌담없는주택') return AssetType.NO_STONE_WALL_HOUSE;
    if (normalized === 'ㄷ자주택') return AssetType.D_SHAPED_HOUSE;
    if (normalized === '도심형주택/빌라' || normalized === '도심형주택빌라') {
      return AssetType.URBAN_HOUSE_VILLA;
    }

    return null;
  }

  private pickRandomHouseAssetType(): AssetType {
    const index = Math.floor(Math.random() * RANDOM_HOUSE_TYPES.length);
    return RANDOM_HOUSE_TYPES[index] ?? AssetType.STONE_WALL_HOUSE;
  }

  private pickLegacyAssetType(): AssetType {
    const index = Math.floor(Math.random() * LEGACY_ASSET_TYPES.length);
    return LEGACY_ASSET_TYPES[index] ?? AssetType.OTHER;
  }

  private async resolvePersistableAssetType(preferred: AssetType): Promise<AssetType> {
    const supported = await this.getSupportedAssetTypesFromDatabase();

    if (supported.size === 0) {
      return LEGACY_ASSET_TYPES.includes(preferred) ? preferred : AssetType.OTHER;
    }

    if (supported.has(preferred)) {
      return preferred;
    }

    const randomSupported = RANDOM_HOUSE_TYPES.find((type) => supported.has(type));
    if (randomSupported) {
      return randomSupported;
    }

    const legacySupported = LEGACY_ASSET_TYPES.find((type) => supported.has(type));
    if (legacySupported) {
      return legacySupported;
    }

    return Array.from(supported)[0] ?? AssetType.OTHER;
  }

  private async getSupportedAssetTypesFromDatabase(): Promise<Set<AssetType>> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ value: string }>>(
        Prisma.sql`SELECT unnest(enum_range(NULL::"AssetType"))::text as value`,
      );

      const supported = new Set<AssetType>();
      for (const row of rows) {
        const parsed = this.toAssetType(row.value);
        if (parsed) {
          supported.add(parsed);
        }
      }
      return supported;
    } catch {
      return new Set<AssetType>();
    }
  }

  private isAssetTypeEnumMismatchError(error: unknown): boolean {
    const message =
      error instanceof Error
        ? error.message.toLowerCase()
        : typeof error === 'string'
          ? error.toLowerCase()
          : '';

    if (!message) {
      return false;
    }

    const hasEnumMismatch = message.includes('invalid input value for enum');
    const hasAssetType =
      message.includes('assettype') ||
      message.includes('"assettype"') ||
      message.includes("'assettype'");

    return hasEnumMismatch && hasAssetType;
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

  private async generateTokens(userId: string, email: string, role: UserRole) {
    const payload = { sub: userId, email, role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: this.configService.get<string>('jwt.accessExpiresIn') ?? '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private throwPrismaException(error: unknown, context: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('이미 사용 중인 이메일입니다.');
      }

      if (error.code === 'P2003') {
        throw new BadRequestException('신청 데이터 연결에 실패했습니다. 입력값을 확인해주세요.');
      }

      if (error.code === 'P2021') {
        throw new ServiceUnavailableException(
          '데이터베이스 스키마가 최신 상태가 아닙니다. 관리자에게 문의해주세요.',
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException('요청한 데이터를 찾을 수 없습니다.');
      }
    }

    if (error instanceof Prisma.PrismaClientUnknownRequestError) {
      const message = error.message.toLowerCase();
      if (message.includes('invalid input value for enum')) {
        throw new ServiceUnavailableException(
          '데이터베이스 enum 스키마가 최신 상태가 아닙니다. 관리자에게 문의해주세요.',
        );
      }
    }

    throw new InternalServerErrorException(
      `신청 처리 중 오류가 발생했습니다. (${context})`,
    );
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
