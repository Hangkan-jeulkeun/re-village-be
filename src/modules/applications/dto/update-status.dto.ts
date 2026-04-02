import { ApplicationStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({ enum: ApplicationStatus, example: ApplicationStatus.REVIEWING })
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @ApiPropertyOptional({ example: '사업계획 보완 필요' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  rejectReason?: string;

  @ApiPropertyOptional({ example: '20대, 30대' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  residentAgeGroup?: string;

  @ApiPropertyOptional({ example: '카페 창업' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  leasePurpose?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  occupantCount?: number;

  @ApiPropertyOptional({ example: '주방/전기 배선/화장실 리모델링 완료' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  remodelSummary?: string;

  @ApiPropertyOptional({ example: '제주시 건축과 064-000-0000' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  managerContact?: string;
}
