import { AssetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreateAssetDto {
  @ApiProperty({ example: '한림읍 창고 임대' })
  @IsString()
  @Length(1, 120)
  title!: string;

  @ApiProperty({ enum: AssetType, example: AssetType.WAREHOUSE })
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
}
