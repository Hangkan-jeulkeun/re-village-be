import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
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
        images: true,
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

    return this.prisma.asset.update({
      where: { id },
      data: dto,
    });
  }
}
