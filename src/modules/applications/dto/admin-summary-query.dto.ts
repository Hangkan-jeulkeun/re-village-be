import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

export class AdminSummaryQueryDto {
  @ApiPropertyOptional({ example: '2026-04', description: 'YYYY-MM 형식' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}
