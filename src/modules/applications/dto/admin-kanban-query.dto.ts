import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AdminKanbanQueryDto {
  @ApiPropertyOptional({ example: '홍길동 또는 010-1234' })
  @IsOptional()
  @IsString()
  search?: string;
}
