import { AssetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';

export class AssetImageInputDto {
  @ApiProperty({ example: 'https://cdn.example.com/assets/room-1.jpg' })
  @IsUrl()
  fileUrl!: string;

  @ApiPropertyOptional({ example: 0, description: '정렬 순서 (0부터 시작)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateAssetDto {
  @ApiProperty({ example: '한림읍 창고 임대' })
  @IsString()
  @Length(1, 120)
  title!: string;

  @ApiProperty({ enum: AssetType, example: AssetType.STONE_WALL_HOUSE })
  @IsEnum(AssetType)
  assetType!: AssetType;

  @ApiPropertyOptional({ example: '보수 완료된 창고입니다.' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  description?: string;

  @ApiProperty({ example: '제주특별자치도 제주시 한림읍 ...' })
  @IsString()
  @Length(1, 255)
  address!: string;

  @ApiProperty({ example: 'JEJU-JEJU' })
  @IsString()
  @Length(2, 50)
  regionCode!: string;

  @ApiPropertyOptional({ example: 33.4996 })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 126.5312 })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ example: 85 })
  @IsOptional()
  @IsInt()
  @Min(1)
  areaSqm?: number;

  @ApiPropertyOptional({ example: 500000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  desiredRent?: number;

  @ApiPropertyOptional({
    type: [AssetImageInputDto],
    description: '자산 이미지 목록 (최대 20장)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssetImageInputDto)
  images?: AssetImageInputDto[];
}
