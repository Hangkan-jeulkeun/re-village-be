import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        profileImageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    await this.findMe(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.profileImageUrl !== undefined && { profileImageUrl: dto.profileImageUrl }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        profileImageUrl: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
