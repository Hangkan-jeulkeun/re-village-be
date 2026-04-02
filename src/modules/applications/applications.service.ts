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
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminKanbanQueryDto } from './dto/admin-kanban-query.dto';
import { AdminListQueryDto } from './dto/admin-list-query.dto';
import { AdminSummaryQueryDto } from './dto/admin-summary-query.dto';
import { AutofillHouseDto } from './dto/autofill-house.dto';
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

export interface HouseAutoFillResult {
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  detectedAssetType: AssetType | null;
  detectedAreaSqm: number | null;
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
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createQuick(dto: QuickApplicationDto) {
    const applicantName = this.resolveApplicantName(dto);
    const applicant = await this.findOrCreateApplicant(dto);
    const autoFilled = await this.resolveAutoFillFromInput({
      address: dto.address ?? dto.detectedAddress,
      latitude: dto.latitude,
      longitude: dto.longitude,
      assetType: dto.assetType ?? dto.detectedAssetType,
      areaSqm: dto.areaSqm ?? dto.detectedAreaSqm,
      photoUrls: dto.photoUrls,
    });

    const assetId = await this.createAssetForQuickApplication(applicant.id, dto, autoFilled);

    const application = await this.createApplicationRecord(applicant.id, assetId, applicantName, dto);

    await this.attachDocuments(applicant.id, application.id, dto);
    const tokens = await this.generateTokens(
      application.applicant.id,
      application.applicant.email,
      application.applicant.role,
    );

    return {
      ...application,
      statusLabel: this.statusLabel(application.status),
      autoFilled,
      ...tokens,
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
      try {
        return await this.prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            ...(dto.email ? { email: dto.email } : {}),
          },
        });
      } catch (error) {
        this.throwPrismaException(error, 'APPLICANT_UPDATE');
      }
    }

    const email = dto.email ?? `phone-${phone.replace(/[^0-9]/g, '')}-${uuidv4()}@placeholder.local`;
    const passwordHash = await bcrypt.hash(uuidv4(), 10);

    try {
      return await this.prisma.user.create({
        data: {
          name,
          phone,
          email,
          passwordHash,
          role: UserRole.ELDER,
        },
      });
    } catch (error) {
      this.throwPrismaException(error, 'APPLICANT_CREATE');
    }
  }

  private async createAssetForQuickApplication(
    ownerId: string,
    dto: QuickApplicationDto,
    autoFilled: HouseAutoFillResult,
  ): Promise<string> {
    const name = this.resolveApplicantName(dto);
    const address = dto.address ?? dto.detectedAddress ?? autoFilled.address ?? '주소 미입력';
    const assetType =
      dto.assetType ??
      dto.detectedAssetType ??
      autoFilled.detectedAssetType ??
      AssetType.EMPTY_HOUSE;
    const areaSqm = dto.areaSqm ?? dto.detectedAreaSqm ?? autoFilled.detectedAreaSqm ?? undefined;
    const latitude = dto.latitude ?? autoFilled.latitude ?? undefined;
    const longitude = dto.longitude ?? autoFilled.longitude ?? undefined;
    const aiRecommendation = autoFilled.recommendation
      ? `\n\n[AI 추천]\n${autoFilled.recommendation}${
          autoFilled.recommendationReason ? `\n사유: ${autoFilled.recommendationReason}` : ''
        }`
      : '';
    let asset;
    try {
      asset = await this.prisma.asset.create({
        data: {
          ownerId,
          title: `${name} 신청 건`,
          assetType,
          address,
          regionCode: 'JEJU-UNKNOWN',
          areaSqm,
          latitude,
          longitude,
          description: `${dto.notes ?? ''}${aiRecommendation}`.trim() || null,
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
    } catch (error) {
      this.throwPrismaException(error, 'ASSET_CREATE');
    }

    return asset.id;
  }

  private async attachDocuments(userId: string, applicationId: string, dto: QuickApplicationDto) {
    const documents = this.normalizeDocuments(dto);

    if (documents.length === 0) {
      return;
    }

    try {
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
    } catch (error) {
      this.throwPrismaException(error, 'DOCUMENT_ATTACH');
    }
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

  private async resolveAutoFillFromInput(dto: AutofillHouseDto): Promise<HouseAutoFillResult> {
    const result: HouseAutoFillResult = {
      address: dto.address ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      detectedAssetType: dto.assetType ?? null,
      detectedAreaSqm: dto.areaSqm ?? null,
      recommendation: null,
      recommendationReason: null,
      warnings: [],
    };

    const hasGpsKey = Boolean(this.configService.get<string>('ai.gpsApiKey'));
    const hasGeminiKey = Boolean(this.configService.get<string>('ai.geminiApiKey'));

    if (!result.address && result.latitude != null && result.longitude != null) {
      try {
        const reverseAddress = await this.reverseGeocode(result.latitude, result.longitude);
        if (reverseAddress) {
          result.address = reverseAddress;
        } else if (!hasGpsKey) {
          result.warnings.push('GPS_API_KEY가 설정되지 않아 주소 자동입력을 건너뜁니다.');
        }
      } catch {
        result.warnings.push('GPS 역지오코딩에 실패했습니다. 주소를 직접 입력해주세요.');
      }
    }

    if ((!result.latitude || !result.longitude) && result.address) {
      try {
        const geocoded = await this.geocodeAddress(result.address);
        if (geocoded) {
          result.latitude = geocoded.latitude;
          result.longitude = geocoded.longitude;
          result.address = geocoded.address ?? result.address;
        } else if (!hasGpsKey) {
          result.warnings.push('GPS_API_KEY가 설정되지 않아 좌표 자동입력을 건너뜁니다.');
        }
      } catch {
        result.warnings.push('주소 기반 좌표 자동입력에 실패했습니다.');
      }
    }

    if (dto.photoUrls?.length) {
      const aiRecommendation = await this.recommendByGemini(dto.photoUrls, result.address);
      if (aiRecommendation) {
        result.recommendation = aiRecommendation.recommendation;
        result.recommendationReason = aiRecommendation.reason;

        if (!result.detectedAssetType && aiRecommendation.detectedAssetType) {
          result.detectedAssetType = aiRecommendation.detectedAssetType;
        }
        if (!result.detectedAreaSqm && aiRecommendation.detectedAreaSqm) {
          result.detectedAreaSqm = aiRecommendation.detectedAreaSqm;
        }
      } else {
        result.warnings.push(
          hasGeminiKey
            ? '사진 기반 AI 추천 생성에 실패했습니다.'
            : 'GEMINI_API_KEY가 설정되지 않아 AI 추천을 건너뜁니다.',
        );
      }
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

  private async recommendByGemini(
    photoUrls: string[],
    address: string | null,
  ): Promise<{
    recommendation: string;
    reason: string | null;
    detectedAssetType: AssetType | null;
    detectedAreaSqm: number | null;
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
      '다음은 제주 빈집/건물 사진입니다.',
      '어르신 자산주의 활용 추천을 JSON으로만 반환해주세요.',
      'JSON schema: {"recommendation":"string","reason":"string","detectedAssetType":"EMPTY_HOUSE|WAREHOUSE|FIELD|OTHER","detectedAreaSqm":number|null}',
      `주소 참고: ${address ?? '미제공'}`,
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

    try {
      const parsed = JSON.parse(text) as {
        recommendation?: string;
        reason?: string;
        detectedAssetType?: string;
        detectedAreaSqm?: number | null;
      };
      if (!parsed.recommendation) {
        return null;
      }

      return {
        recommendation: parsed.recommendation,
        reason: parsed.reason ?? null,
        detectedAssetType: this.toAssetType(parsed.detectedAssetType),
        detectedAreaSqm:
          typeof parsed.detectedAreaSqm === 'number' && parsed.detectedAreaSqm > 0
            ? Math.round(parsed.detectedAreaSqm)
            : null,
      };
    } catch {
      return {
        recommendation: text.slice(0, 500),
        reason: null,
        detectedAssetType: null,
        detectedAreaSqm: null,
      };
    }
  }

  private async fetchImageInlineData(
    url: string,
  ): Promise<{ inline_data: { mime_type: string; data: string } } | null> {
    try {
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
    if (value === AssetType.EMPTY_HOUSE) return AssetType.EMPTY_HOUSE;
    if (value === AssetType.WAREHOUSE) return AssetType.WAREHOUSE;
    if (value === AssetType.FIELD) return AssetType.FIELD;
    if (value === AssetType.OTHER) return AssetType.OTHER;
    return null;
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
