import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ApplicationStatus,
  AssetStatus,
  AssetType,
  NotificationType,
  Prisma,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetListingQueryDto } from './dto/asset-listing-query.dto';
import { CreateInquiryDto } from './dto/create-inquiry.dto';
import { AssetFilterDto } from './dto/asset-filter.dto';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateAssetDto) {
    return this.prisma.asset.create({
      data: {
        ownerId,
        title: dto.title,
        assetType: dto.assetType,
        description: dto.description,
        address: dto.address,
        regionCode: dto.regionCode,
        latitude: dto.latitude,
        longitude: dto.longitude,
        areaSqm: dto.areaSqm,
        desiredRent: dto.desiredRent,
        ...(dto.images && dto.images.length > 0
          ? {
              images: {
                create: dto.images.map((image, index) => ({
                  fileUrl: image.fileUrl,
                  sortOrder: image.sortOrder ?? index,
                })),
              },
            }
          : {}),
      },
      include: {
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  async findAll(filter: AssetFilterDto) {
    const where: Prisma.AssetWhereInput = {
      ...(filter.assetType && { assetType: filter.assetType }),
      ...(filter.status && { status: filter.status }),
      ...(filter.regionCode && { regionCode: filter.regionCode }),
      ...(filter.minRent !== undefined || filter.maxRent !== undefined
        ? {
            desiredRent: {
              ...(filter.minRent !== undefined && { gte: filter.minRent }),
              ...(filter.maxRent !== undefined && { lte: filter.maxRent }),
            },
          }
        : {}),
    };

    const page = filter.page ?? 1;
    const limit = filter.limit ?? 20;

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      }),
      this.prisma.asset.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
      },
    };
  }

  async findOne(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('자산을 찾을 수 없습니다.');
    }

    return asset;
  }

  async update(id: string, user: AuthUser, dto: UpdateAssetDto) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) {
      throw new NotFoundException('자산을 찾을 수 없습니다.');
    }

    if (asset.ownerId !== user.id && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('수정 권한이 없습니다.');
    }

    const { images, ...assetData } = dto;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.asset.update({
        where: { id },
        data: assetData,
      });

      if (images !== undefined) {
        await tx.assetImage.deleteMany({ where: { assetId: id } });
        if (images.length > 0) {
          await tx.assetImage.createMany({
            data: images.map((image, index) => ({
              assetId: id,
              fileUrl: image.fileUrl,
              sortOrder: image.sortOrder ?? index,
            })),
          });
        }
      }

      const fresh = await tx.asset.findUnique({
        where: { id: updated.id },
        include: {
          images: {
            orderBy: { sortOrder: 'asc' },
          },
        },
      });

      if (!fresh) {
        throw new NotFoundException('자산을 찾을 수 없습니다.');
      }

      return fresh;
    });
  }

  async listMarketplace(query: AssetListingQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AssetWhereInput = {
      ...(query.address
        ? {
            address: {
              contains: query.address,
              mode: 'insensitive',
            },
          }
        : {}),
      ...(query.ownerCategory === 'PUBLIC'
        ? {
            owner: {
              role: UserRole.ADMIN,
            },
          }
        : {}),
      ...(query.ownerCategory === 'PRIVATE'
        ? {
            owner: {
              role: {
                not: UserRole.ADMIN,
              },
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
          images: {
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.asset.count({ where }),
    ]);

    const mapped = items.map((item) => this.toListingCard(item));

    return {
      total,
      publicListings: mapped.filter((item) => item.ownerCategory === 'PUBLIC'),
      privateListings: mapped.filter((item) => item.ownerCategory === 'PRIVATE'),
      meta: { page, limit, total },
    };
  }

  async getListingDetail(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            role: true,
          },
        },
        images: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('매물을 찾을 수 없습니다.');
    }

    const card = this.toListingCard(asset);

    return {
      ...card,
      description: asset.description,
      inquiryEnabled: card.ownerCategory === 'PRIVATE',
    };
  }

  async createInquiry(assetId: string, dto: CreateInquiryDto) {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      include: {
        owner: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    if (!asset) {
      throw new NotFoundException('매물을 찾을 수 없습니다.');
    }

    const phone = this.normalizePhone(dto.phone);
    const user = await this.findOrCreateByPhone(dto, phone);

    const application = await this.prisma.application.create({
      data: {
        applicantId: user.id,
        assetId: asset.id,
        businessIdea: dto.message ?? `${dto.purpose} 문의`,
        businessType: `INQUIRY_${dto.purpose}`,
        desiredStartDate: dayjs().add(30, 'day').toDate(),
        status: ApplicationStatus.RECEIVED,
        residentAgeGroup: dto.householdType,
        leasePurpose: dto.purpose,
        occupantCount: dto.headCount,
      },
    });

    await this.prisma.notification.create({
      data: {
        userId: asset.owner.id,
        type: NotificationType.APPLICATION,
        title: '새 임대 문의가 접수되었습니다.',
        body: `${dto.name} 님이 "${asset.title}" 매물에 문의를 남겼습니다.`,
        refType: 'APPLICATION',
        refId: application.id,
      },
    });

    return {
      inquiryId: application.id,
      assetId: asset.id,
      ownerId: asset.owner.id,
      status: application.status,
      statusLabel: '접수됨',
    };
  }

  private toListingCard(
    asset: Prisma.AssetGetPayload<{
      include: { owner: { select: { id: true; name: true; role: true } }; images: true };
    }>,
  ) {
    const ownerCategory = asset.owner.role === UserRole.ADMIN ? 'PUBLIC' : 'PRIVATE';
    const recommendationTags = this.recommendationByType(asset.assetType);

    return {
      id: asset.id,
      ownerCategory,
      title: asset.title,
      price: asset.desiredRent,
      address: asset.address,
      areaSqm: asset.areaSqm,
      assetType: asset.assetType,
      keywords: [asset.assetType, ...recommendationTags],
      recommendationTags,
      isRemodelingCompleted:
        asset.status === AssetStatus.AVAILABLE || asset.status === AssetStatus.RENTED,
      thumbnailUrl: asset.images[0]?.fileUrl ?? null,
      owner: {
        id: asset.owner.id,
        name: asset.owner.name,
      },
    };
  }

  private recommendationByType(assetType: AssetType): string[] {
    if (assetType === AssetType.EMPTY_HOUSE) return ['주거', '게스트하우스', '카페'];
    if (assetType === AssetType.WAREHOUSE) return ['공방', '창고형 카페'];
    if (assetType === AssetType.FIELD) return ['농업', '텃밭', '체험농장'];
    return ['주거', '카페', '공방'];
  }

  private normalizePhone(phone: string): string {
    const compact = phone.trim().replace(/[^0-9+]/g, '');
    if (compact.startsWith('+')) return compact;
    if (compact.startsWith('0')) return `+82${compact.slice(1)}`;
    if (compact.startsWith('82')) return `+${compact}`;
    return `+${compact}`;
  }

  private async findOrCreateByPhone(dto: CreateInquiryDto, normalizedPhone: string) {
    const existing = await this.prisma.user.findFirst({
      where: { phone: normalizedPhone },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: dto.name,
          ...(dto.email ? { email: dto.email } : {}),
        },
      });
    }

    const email =
      dto.email ?? `inquiry-${normalizedPhone.replace(/[^0-9]/g, '')}-${uuidv4()}@placeholder.local`;
    const passwordHash = await bcrypt.hash(uuidv4(), 10);

    return this.prisma.user.create({
      data: {
        name: dto.name,
        phone: normalizedPhone,
        email,
        passwordHash,
        role: UserRole.YOUTH,
      },
    });
  }
}
