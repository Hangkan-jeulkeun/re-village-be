import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AssetListingQueryDto {
  @ApiPropertyOptional({ example: '제주시 한림읍', description: '주소 키워드 검색' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    example: 'ALL',
    enum: ['ALL', 'PUBLIC', 'PRIVATE'],
  })
  @IsOptional()
  @IsIn(['ALL', 'PUBLIC', 'PRIVATE'])
  ownerCategory?: 'ALL' | 'PUBLIC' | 'PRIVATE' = 'ALL';

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
