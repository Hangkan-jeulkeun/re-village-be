import { AssetType } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
  IsInt,
} from 'class-validator';

export class AutofillHouseDto {
  private static toBoolean(value: unknown): boolean | undefined {
    if (value == null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
    if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y', '있음', '가능'].includes(lower)) return true;
      if (['false', '0', 'no', 'n', '없음', '불가'].includes(lower)) return false;
    }
    return undefined;
  }

  private static toStringArray(value: unknown): string[] | undefined {
    if (value == null || value === '') return undefined;
    if (Array.isArray(value)) return value as string[];
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (Array.isArray(parsed)) return parsed as string[];
      } catch {
        return value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);
      }
    }
    return undefined;
  }

  @ApiPropertyOptional({ example: '제주특별자치도 제주시 한림읍 ...' })
  @IsOptional()
  @IsString()
  @Length(1, 255)
  address?: string;

  @ApiPropertyOptional({ example: 33.4996 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 126.5312 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ enum: AssetType, example: AssetType.STONE_WALL_HOUSE })
  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  areaSqm?: number;

  @ApiPropertyOptional({ example: 1, description: '층수(단층=1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  floorCount?: number;

  @ApiPropertyOptional({ example: true, description: '마당 유무' })
  @IsOptional()
  @Transform(({ value }) => AutofillHouseDto.toBoolean(value))
  @IsBoolean()
  hasYard?: boolean;

  @ApiPropertyOptional({ example: true, description: '주차 가능 여부' })
  @IsOptional()
  @Transform(({ value }) => AutofillHouseDto.toBoolean(value))
  @IsBoolean()
  hasParking?: boolean;

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/building-1.jpg'],
  })
  @IsOptional()
  @Transform(({ value }) => AutofillHouseDto.toStringArray(value))
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  photoUrls?: string[];
}
