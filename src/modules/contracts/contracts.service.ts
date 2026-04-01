import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateContractDto } from './dto/create-contract.dto';

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateContractDto) {
    const [asset, tenant, owner, application] = await Promise.all([
      this.prisma.asset.findUnique({ where: { id: dto.assetId } }),
      this.prisma.user.findUnique({ where: { id: dto.tenantId } }),
      this.prisma.user.findUnique({ where: { id: dto.ownerId } }),
      this.prisma.application.findUnique({ where: { id: dto.applicationId } }),
    ]);

    if (!asset) throw new NotFoundException('자산을 찾을 수 없습니다.');
    if (!tenant) throw new NotFoundException('임차인을 찾을 수 없습니다.');
    if (!owner) throw new NotFoundException('자산주를 찾을 수 없습니다.');
    if (!application) throw new NotFoundException('신청서를 찾을 수 없습니다.');

    if (dto.startDate >= dto.endDate) {
      throw new BadRequestException('startDate는 endDate보다 이전이어야 합니다.');
    }

    return this.prisma.contract.create({
      data: {
        assetId: dto.assetId,
        tenantId: dto.tenantId,
        ownerId: dto.ownerId,
        applicationId: dto.applicationId,
        startDate: dto.startDate,
        endDate: dto.endDate,
        monthlyRent: dto.monthlyRent,
      },
      include: {
        asset: true,
        tenant: { select: { id: true, email: true, name: true } },
        owner: { select: { id: true, email: true, name: true } },
      },
    });
  }

  findMyContracts(userId: string) {
    return this.prisma.contract.findMany({
      where: {
        OR: [{ tenantId: userId }, { ownerId: userId }],
      },
      include: {
        asset: true,
        settlements: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
