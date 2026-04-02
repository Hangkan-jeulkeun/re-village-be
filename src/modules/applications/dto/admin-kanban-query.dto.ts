import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class AdminKanbanQueryDto {
  @ApiPropertyOptional({ example: '홍길동 또는 010-1234' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: '2026-04', description: 'YYYY-MM 형식 (기본값: 현재 월)' })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}
