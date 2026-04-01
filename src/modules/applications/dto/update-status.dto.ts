import { ApplicationStatus } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class UpdateStatusDto {
  @ApiProperty({ enum: ApplicationStatus, example: ApplicationStatus.APPROVED })
  @IsEnum(ApplicationStatus)
  status!: ApplicationStatus;

  @ApiPropertyOptional({ example: '사업계획 보완 필요' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  rejectReason?: string;
}
