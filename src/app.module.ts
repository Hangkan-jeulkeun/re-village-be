import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import aiConfig from './config/ai.config';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import s3Config from './config/s3.config';
import { PrismaModule } from './prisma/prisma.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig, s3Config, aiConfig],
    }),
    PrismaModule,
    AuthModule,
    ApplicationsModule,
    AssetsModule,
    FilesModule,
  ],
})
export class AppModule {}
