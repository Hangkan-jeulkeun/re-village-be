import { AssetType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEmail,
  IsEnum,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class QuickApplicationDto {
  @ApiProperty({ example: '홍길동' })
  @IsString()
  @Length(1, 50)
  applicantName!: string;

  @ApiProperty({ example: '+821012341234', description: 'E.164 권장 (+82...)' })
  @Matches(/^\+?\d{9,15}$/)
  phone!: string;

  @ApiPropertyOptional({ example: 'owner@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ enum: AssetType, example: AssetType.EMPTY_HOUSE })
  @IsOptional()
  @IsEnum(AssetType)
  assetType?: AssetType;

  @ApiProperty({ example: '제주특별자치도 제주시 한림읍 ...' })
  @IsString()
  @Length(1, 255)
  address!: string;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  areaSqm?: number;

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

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/building-1.jpg'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  photoUrls?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['https://cdn.example.com/registry.pdf'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  documentUrls?: string[];

  @ApiPropertyOptional({ example: '건물 관련 추가 설명' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '기존 자산에 연결할 경우 전달 (없으면 신규 자산 생성)',
  })
  @IsOptional()
  @IsUUID(4)
  assetId?: string;

  @ApiPropertyOptional({ example: '2026-05-01', type: String, format: 'date' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  desiredStartDate?: Date;
}
