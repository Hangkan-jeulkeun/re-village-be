import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        this.logger.warn(
          'Prisma DB 연결에 실패했습니다. 개발 모드에서는 서버를 계속 실행합니다. (DATABASE_URL/DB 상태를 확인하세요.)',
        );
        this.logger.warn(String(error));
        return;
      }

      throw error;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
