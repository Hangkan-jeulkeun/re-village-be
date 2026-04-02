import { ApplicationStatus } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminListQueryDto {
  @ApiPropertyOptional({ enum: ApplicationStatus })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({ example: '홍길동 또는 0101234' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 'latest', enum: ['latest', 'oldest'] })
  @IsOptional()
  @IsIn(['latest', 'oldest'])
  sort?: 'latest' | 'oldest' = 'latest';

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
