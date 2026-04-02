import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AssetStatus,
  AssetType,
  Prisma,
  UserRole,
} from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetListingQueryDto } from './dto/asset-listing-query.dto';
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
      inquiryEnabled: false,
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
    if (assetType === AssetType.STONE_WALL_FIELD_HOUSE) return ['감성숙소', '텃밭 체험', '한 달 살기'];
    if (assetType === AssetType.STONE_WALL_HOUSE) return ['게스트하우스', '주거', '공방'];
    if (assetType === AssetType.DEMOLITION_HOUSE) return ['재건축 검토', '리모델링', '장기 임대'];
    if (assetType === AssetType.NO_STONE_WALL_HOUSE) return ['주거', '카페', '소형 창업'];
    if (assetType === AssetType.D_SHAPED_HOUSE) return ['중정형 숙소', '복합공간', '공유주택'];
    if (assetType === AssetType.URBAN_HOUSE_VILLA) return ['도심 임대', '원룸/투룸', '소형 오피스'];
    return ['주거', '카페', '공방'];
  }

}
