import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './config/app.config';
import jwtConfig from './config/jwt.config';
import s3Config from './config/s3.config';
import { PrismaModule } from './prisma/prisma.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AuthModule } from './modules/auth/auth.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { FilesModule } from './modules/files/files.module';
import { MapModule } from './modules/map/map.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, jwtConfig, s3Config],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AssetsModule,
    ApplicationsModule,
    ContractsModule,
    MapModule,
    NotificationsModule,
    FilesModule,
  ],
})
export class AppModule {}
